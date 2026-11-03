import type { Db } from '../db/db.ts';
import type { SubsonicClient } from '../navidrome/client.ts';

// Spotify IDs for Navidrome tracks, so Spicy Lyrics can serve them (LYRICS_INTEGRATION.md §4.3).
// Matches live in `spotify_matches`, one row per track per Navidrome server, kept until corrected.
// The track's metadata always comes from Navidrome itself, never from a request, so nobody can pin
// a wrong ID on a track for everyone. Matchers, most precise first:
//   manual   an admin's correction; never overwritten
//   spotify  Spotify's own search (ISRC, else metadata): matches kept from before it was removed;
//            nothing asks Spotify any more
//   lb-mbid  ISRC → MusicBrainz recording → ListenBrainz's Spotify mapper (MusicBrainz: 1 req/s)
//   lb-meta  ListenBrainz's metadata mapper, batched (artist, release, title)
// A playing track is matched at once with the fast matchers; a background sweep walks the whole
// library, fast matchers first, then the slow MusicBrainz pass for what is left.

export type Matcher = 'spotify' | 'lb-mbid' | 'lb-meta';
type Method = Matcher | 'manual';
const RANK: Record<Method, number> = { manual: 4, spotify: 3, 'lb-mbid': 2, 'lb-meta': 1 };
const RETRY_NONE_MS = 30 * 86_400_000;
const PAGE = 500; // songs per search3 page
const MAX_PAGES = 400; // 200,000 tracks per Navidrome server
const LB_BATCH = 100;
const LB_GAP_MS = 1000;
const MB_GAP_MS = 1100; // MusicBrainz asks for at most one request a second
const MB_GIVE_UP = 20; // refusals in a row that end the MusicBrainz pass
const RETRIES = 4;
const ON_PLAY_TIMEOUT_MS = 1500; // inside the resolver's 4.5 s
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;

export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  mbid?: string;
}

interface Row {
  navidrome_id: string;
  spotify_ids: string | null;
  method: Method | null;
  tried: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  isrc: string | null;
  mbid: string | null;
}

/** Bracketed credits and tags that name the same recording. */
const SAME_RECORDING =
  /\s*[([](?:feat\.?|ft\.?|featuring|with|prod\.?) [^)\]]*[)\]]|\s*[([](?:(?:\d{4} )?remaster(?:ed)?(?: \d{4})?(?: version)?|album version|explicit|clean|original mix)[)\]]/gi;
export const plainTitle = (title: string) => title.replace(SAME_RECORDING, '').trim();

/** A Spotify track id from an id, a `spotify:track:` URI or an open.spotify.com link. */
export function parseSpotifyId(s: string): string | null {
  const t = s.trim();
  const m =
    /(?:spotify:track:|open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/)([0-9A-Za-z]{22})/.exec(t);
  const id = m?.[1] ?? t;
  return SPOTIFY_ID.test(id) ? id : null;
}

/** A Subsonic song as the metadata a match is made from. */
export function metaOf(s: Record<string, unknown>): TrackMeta {
  const isrc = Array.isArray(s.isrc) ? s.isrc[0] : s.isrc;
  return {
    id: String(s.id),
    title: String(s.title ?? ''),
    artist: String(s.artist ?? ''),
    ...(s.album ? { album: String(s.album) } : {}),
    ...(typeof s.duration === 'number' && s.duration > 0 && { durationMs: s.duration * 1000 }),
    ...(typeof isrc === 'string' && isrc && { isrc: isrc.toUpperCase() }),
    ...(typeof s.musicBrainzId === 'string' && s.musicBrainzId && { mbid: s.musicBrainzId }),
  };
}

export interface MatchDeps {
  db: Db;
  now: () => number;
  log?: (level: 'info' | 'warn', msg: string, extra?: Record<string, unknown>) => void;
  listenbrainzUrl: string;
  musicbrainzUrl: string;
  userAgent: string;
  /** The Navidrome servers to sweep: each scope once, with one user's client for it. */
  libraries: () => Promise<{ scope: string; client: SubsonicClient }[]>;
  /** Admin → Server → "Match the library in the background". */
  sweepEnabled: () => boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createSpotifyMatcher(deps: MatchDeps) {
  const f: typeof fetch = (u, i) => (deps.fetch ?? fetch)(u, i);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const db = deps.db;
  const inflight = new Map<string, Promise<string[]>>();

  // ---- storage ----

  const getRow = (scope: string, id: string) =>
    db
      .prepare('SELECT * FROM spotify_matches WHERE scope = ? AND navidrome_id = ?')
      .get(scope, id) as Row | undefined;
  const idsOf = (r: Row | undefined): string[] =>
    r?.spotify_ids ? (JSON.parse(r.spotify_ids) as string[]) : [];
  const triedOf = (r: Row | undefined) => new Set((r?.tried ?? '').split(',').filter(Boolean));

  function saveMeta(scope: string, t: TrackMeta) {
    db.prepare(
      `INSERT INTO spotify_matches (scope, navidrome_id, tried, title, artist, album, duration_ms, isrc, mbid, checked_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope, navidrome_id) DO UPDATE SET title = excluded.title, artist = excluded.artist,
         album = excluded.album, duration_ms = excluded.duration_ms, isrc = excluded.isrc, mbid = excluded.mbid`,
    ).run(
      scope,
      t.id,
      t.title,
      t.artist,
      t.album ?? null,
      t.durationMs ?? null,
      t.isrc ?? null,
      t.mbid ?? null,
      deps.now(),
    );
  }

  /** A matcher's answer: always remembered as tried; kept when it beats the match there is. */
  function record(scope: string, id: string, m: Matcher, ids: string[] | null) {
    const r = getRow(scope, id);
    if (!r) return;
    const tried = triedOf(r).add(m);
    const better = !!ids?.length && (!r.method || RANK[m] > RANK[r.method]);
    db.prepare(
      `UPDATE spotify_matches SET tried = ?, checked_at = ?${better ? ', spotify_ids = ?, method = ?' : ''}
       WHERE scope = ? AND navidrome_id = ?`,
    ).run(
      ...([[...tried].join(','), deps.now()] as unknown[]),
      ...(better ? [JSON.stringify(ids?.slice(0, 5)), m] : []),
      scope,
      id,
    );
  }

  // ---- matchers ----

  /**
   * A request to a rate-limited service: a 429 or 5xx is retried after its Retry-After, else 2, 4,
   * 8 then 16 s (MusicBrainz answers 503 when it is busy, even to polite clients).
   */
  async function polite(url: string, init: RequestInit, timeoutMs: number) {
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!(res.status === 429 || res.status >= 500) || attempt >= RETRIES) return res;
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 && after < 120 ? after * 1000 : 2000 * 2 ** attempt);
    }
  }

  async function lbPost(path: string, body: unknown[]) {
    const res = await polite(
      `${deps.listenbrainzUrl}${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': deps.userAgent },
        body: JSON.stringify(body),
      },
      30_000,
    );
    if (!res.ok) throw new Error(`listenbrainz ${res.status}`);
    return (await res.json()) as { spotify_track_ids?: string[] }[];
  }
  const validIds = (xs: string[] | undefined) => (xs ?? []).filter((x) => SPOTIFY_ID.test(x));

  /**
   * ListenBrainz by metadata; the answers come back in the order asked. A miss whose title carries
   * a credit or a tag that does not change the recording ("feat. …", "Album Version", "Remastered")
   * is asked once more without it. Remix, live, demo and edit tags stay: those are other timings.
   */
  async function lbMeta(tracks: TrackMeta[]) {
    const ask = async (ts: TrackMeta[], title: (t: TrackMeta) => string) =>
      (
        await lbPost(
          '/spotify-id-from-metadata/json',
          ts.map((t) => ({
            artist_name: t.artist,
            release_name: t.album ?? '',
            track_name: title(t),
          })),
        )
      ).map((x) => validIds(x?.spotify_track_ids));
    const out = await ask(tracks, (t) => t.title);
    const again = tracks
      .map((t, i) => ({ t, i, title: plainTitle(t.title) }))
      .filter((x) => !out[x.i]?.length && x.title && x.title !== x.t.title);
    if (again.length) {
      const r = await ask(
        again.map((x) => x.t),
        (t) => plainTitle(t.title),
      );
      again.forEach((x, k) => {
        out[x.i] = r[k] ?? [];
      });
    }
    return out;
  }

  async function lbMbid(mbids: string[]) {
    const r = await lbPost(
      '/spotify-id-from-mbid/json',
      mbids.map((m) => ({ recording_mbid: m })),
    );
    return mbids.map((_, i) => validIds(r[i]?.spotify_track_ids));
  }

  /** The first MusicBrainz recording with this ISRC, or null. */
  async function mbRecording(isrc: string): Promise<string | null> {
    const res = await polite(
      `${deps.musicbrainzUrl}/ws/2/isrc/${encodeURIComponent(isrc)}?fmt=json`,
      { headers: { 'user-agent': deps.userAgent, accept: 'application/json' } },
      15_000,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
    const b = (await res.json()) as { recordings?: { id: string }[] };
    return b.recordings?.[0]?.id ?? null;
  }

  /** The fast matchers for one track, best first; stops at the first that finds it. */
  async function matchNow(scope: string, t: TrackMeta) {
    const tried = triedOf(getRow(scope, t.id));
    if (!tried.has('lb-meta')) record(scope, t.id, 'lb-meta', (await lbMeta([t]))[0] ?? []);
  }

  // ---- the sweep ----

  const status = {
    running: false,
    phase: null as null | 'scan' | 'musicbrainz',
    scanned: 0,
    startedAt: null as number | null,
    finishedAt: null as number | null,
    error: null as string | null,
  };
  let stop = false;

  async function sweepScope(scope: string, client: SubsonicClient) {
    // Pass 1: every song, the fast matchers.
    status.phase = 'scan';
    // A user may connect any allowed server: one that pages forever, or repeats itself, ends the
    // pass instead of holding the sweep (security review).
    let firstOfLast = '';
    for (let offset = 0; !stop && offset < MAX_PAGES * PAGE; offset += PAGE) {
      const r = await client.call('search3', {
        query: '',
        songCount: String(PAGE),
        songOffset: String(offset),
        artistCount: '0',
        albumCount: '0',
      });
      const songs = ((r.searchResult3 as { song?: Record<string, unknown>[] } | undefined)?.song ??
        []) as Record<string, unknown>[];
      if (!songs.length || String(songs[0]?.id) === firstOfLast) break;
      firstOfLast = String(songs[0]?.id);
      const metas = songs.map(metaOf).filter((t) => t.title && t.artist);
      for (const t of metas) saveMeta(scope, t);
      status.scanned += songs.length;
      const pending = metas.filter((t) => getRow(scope, t.id)?.method !== 'manual');
      const lb = pending.filter((t) => {
        const row = getRow(scope, t.id);
        return !idsOf(row).length && !triedOf(row).has('lb-meta');
      });
      for (let i = 0; i < lb.length && !stop; i += LB_BATCH) {
        const batch = lb.slice(i, i + LB_BATCH);
        const ids = await lbMeta(batch);
        batch.forEach((t, k) => {
          record(scope, t.id, 'lb-meta', ids[k] ?? []);
        });
        await sleep(LB_GAP_MS);
      }
      if (songs.length < PAGE) break;
    }
    // Pass 2: what is still unmatched and has an ISRC or recording id, through MusicBrainz.
    status.phase = 'musicbrainz';
    const left = db
      .prepare(
        `SELECT * FROM spotify_matches WHERE scope = ? AND spotify_ids IS NULL
         AND (isrc IS NOT NULL OR mbid IS NOT NULL) AND (',' || tried || ',') NOT LIKE '%,lb-mbid,%'`,
      )
      .all(scope) as Row[];
    // A track MusicBrainz keeps refusing is left for the next run; many in a row end the pass.
    let failures = 0;
    for (let i = 0; i < left.length && !stop; i += 50) {
      const batch: { row: Row; mbid: string | null }[] = [];
      for (const row of left.slice(i, i + 50)) {
        if (stop) return;
        let mbid: string | null = row.mbid;
        if (!mbid && row.isrc) {
          try {
            mbid = await mbRecording(row.isrc);
            failures = 0;
          } catch (err) {
            if (++failures >= MB_GIVE_UP) throw err;
            await sleep(MB_GAP_MS);
            continue;
          }
          await sleep(MB_GAP_MS);
        }
        batch.push({ row, mbid });
      }
      const found = batch.filter((b) => b.mbid);
      const ids = found.length ? await lbMbid(found.map((b) => b.mbid as string)) : [];
      for (const b of batch)
        record(scope, b.row.navidrome_id, 'lb-mbid', b.mbid ? (ids[found.indexOf(b)] ?? []) : []);
    }
  }

  async function sweep() {
    if (status.running || !deps.sweepEnabled()) return;
    Object.assign(status, {
      running: true,
      scanned: 0,
      startedAt: deps.now(),
      finishedAt: null,
      error: null,
    });
    stop = false;
    try {
      // "None found" is asked again after 30 days: the catalogues grow. Inside the try: a failure
      // here must still end the run (`running`), and never reject unhandled.
      db.prepare(
        "UPDATE spotify_matches SET tried = '' WHERE spotify_ids IS NULL AND checked_at < ?",
      ).run(deps.now() - RETRY_NONE_MS);
      for (const { scope, client } of await deps.libraries()) {
        if (stop) break;
        await sweepScope(scope, client);
      }
    } catch (err) {
      status.error = String(err instanceof Error ? err.message : err);
      deps.log?.('warn', 'spotify matching stopped', { detail: status.error });
    } finally {
      Object.assign(status, { running: false, phase: null, finishedAt: deps.now() });
      deps.log?.('info', 'spotify matching done', counts());
    }
  }

  function counts(scope?: string) {
    const where = scope ? 'WHERE scope = ?' : '';
    const r = db
      .prepare(
        `SELECT COUNT(*) AS tracks,
           SUM(spotify_ids IS NOT NULL) AS matched,
           SUM(method = 'manual') AS manual,
           SUM(spotify_ids IS NULL AND tried != '') AS none,
           SUM(spotify_ids IS NULL AND tried = '') AS pending
         FROM spotify_matches ${where}`,
      )
      .get(...(scope ? [scope] : [])) as Record<string, number | null>;
    return {
      tracks: r.tracks ?? 0,
      matched: r.matched ?? 0,
      manual: r.manual ?? 0,
      none: r.none ?? 0,
      pending: r.pending ?? 0,
    };
  }

  return {
    /**
     * The Spotify ids for a Navidrome track (best first): stored, or matched now with the fast
     * matchers from Navidrome's own metadata. Empty when none is known; errors match nothing.
     */
    async idsFor(scope: string, navidromeId: string, client: () => Promise<SubsonicClient | null>) {
      const row = getRow(scope, navidromeId);
      // Done once ListenBrainz has had its turn.
      const tried = triedOf(row);
      if (idsOf(row).length || tried.has('lb-meta')) return idsOf(row);
      const key = `${scope}|${navidromeId}`;
      let p = inflight.get(key);
      if (!p) {
        p = (async () => {
          let t: TrackMeta | null = row
            ? {
                id: navidromeId,
                title: row.title,
                artist: row.artist,
                ...(row.album && { album: row.album }),
                ...(row.duration_ms && { durationMs: row.duration_ms }),
                ...(row.isrc && { isrc: row.isrc }),
              }
            : null;
          if (!t) {
            const c = await client();
            if (!c) return [];
            const r = await c.call('getSong', { id: navidromeId });
            t = metaOf((r.song ?? {}) as Record<string, unknown>);
            if (!t.title || !t.artist) return [];
            saveMeta(scope, t);
          }
          await matchNow(scope, t);
          return idsOf(getRow(scope, navidromeId));
        })()
          .catch(() => [])
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const timeout = new Promise<string[]>((r) => setTimeout(() => r([]), ON_PLAY_TIMEOUT_MS));
      return Promise.race([p, timeout]);
    },

    /** An admin's correction: the id, or null to forget it and match again. */
    setManual(scope: string, navidromeId: string, spotifyId: string | null) {
      if (!getRow(scope, navidromeId))
        db.prepare(
          `INSERT INTO spotify_matches (scope, navidrome_id, tried, title, artist, checked_at)
           VALUES (?, ?, '', '', '', ?)`,
        ).run(scope, navidromeId, deps.now());
      db.prepare(
        `UPDATE spotify_matches SET spotify_ids = ?, method = ?, tried = '', checked_at = ?
         WHERE scope = ? AND navidrome_id = ?`,
      ).run(
        spotifyId ? JSON.stringify([spotifyId]) : null,
        spotifyId ? 'manual' : null,
        deps.now(),
        scope,
        navidromeId,
      );
    },

    /** Tracks with no match after trying, for Admin → Server (newest checks first). */
    misses(scope: string, offset: number, limit: number) {
      return (
        db
          .prepare(
            `SELECT navidrome_id, title, artist, album, isrc FROM spotify_matches
             WHERE scope = ? AND spotify_ids IS NULL AND tried != '' AND title != ''
             ORDER BY artist, album, title LIMIT ? OFFSET ?`,
          )
          .all(scope, limit, offset) as {
          navidrome_id: string;
          title: string;
          artist: string;
          album: string | null;
          isrc: string | null;
        }[]
      ).map((r) => ({
        id: r.navidrome_id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        isrc: r.isrc,
      }));
    },

    match: (scope: string, navidromeId: string) => {
      const r = getRow(scope, navidromeId);
      return r ? { ids: idsOf(r), method: r.method, tried: [...triedOf(r)] } : null;
    },
    counts,
    status: () => ({ ...status }),
    sweep,
    stop() {
      stop = true;
    },
  };
}

export type SpotifyMatcher = ReturnType<typeof createSpotifyMatcher>;
