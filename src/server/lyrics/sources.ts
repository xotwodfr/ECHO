import type { Attribution, LyricsDoc } from '../../shared/types.ts';
import { type SubsonicClient, SubsonicError } from '../navidrome/client.ts';
import {
  CREDIT,
  LyricsInvalid,
  type OsStructured,
  type Parsed,
  parseLrc,
  parseOpenSubsonic,
  parsePlain,
  parseSpicy,
  parseYrc,
  type SpicyBody,
} from './parse.ts';
import { jaroWinkler, normalise } from './resolve.ts';

// The lyric sources (LYRICS_INTEGRATION.md §1, §6, §8): S1 the user's Navidrome (structured,
// enhanced), S2 Spicy Lyrics (the admin's secret key, server-side only), S3 LRCLIB, S4 Navidrome's
// legacy plain text, S5 NetEase Cloud Music (word-timed YRC, keyless). Each answers found / not found / error, with its own timeout and retry policy;
// the resolver (resolve.ts) runs them in parallel and picks.

export type SourceId = 'navidrome' | 'spicy' | 'netease' | 'lrclib' | 'navidrome-plain';

export interface LookupInput {
  trackKey: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  spotifyId?: string;
  /** Other Spotify ids the same Navidrome track matched (other releases), tried after spotifyId. */
  spotifyAlt?: string[];
  navidromeId?: string;
}

export interface Candidate extends Parsed {
  source: LyricsDoc['source'];
  attribution: Attribution;
  /** What the source says the track lasts (match validation, §4.2). */
  reportedDurationMs?: number;
  /** For metadata-keyed sources: what the source matched (§4.2 text check). */
  matched?: { title: string; artist: string };
}

export type Outcome =
  | { kind: 'found'; candidate: Candidate }
  | { kind: 'notFound'; instrumental?: true }
  | { kind: 'error'; retriable: boolean; retryAfterMs?: number; detail: string };

export interface Source {
  id: SourceId;
  timeoutMs: number;
  /** One retry after this many ms (± 30% jitter) on a network error or 5xx; null: none. */
  retryAfterMs: number | null;
  /** Keyed by metadata, so the text check of §4.2 applies. */
  metadataKeyed: boolean;
  eligible(input: LookupInput): boolean;
  fetch(input: LookupInput, signal: AbortSignal): Promise<Outcome>;
}

const notFound: Outcome = { kind: 'notFound' };
/** The source says the track has no words (LYRICS_EXPERIENCE.md §9.4: the cover, no message). */
const instrumental: Outcome = { kind: 'notFound', instrumental: true };
/** Retry-After in seconds or as an HTTP date, at most an hour; a 429 without one cools a minute. */
function cooling(status: number, header?: string | null) {
  const s = Number(header);
  const ms = header
    ? Number.isFinite(s)
      ? s * 1000
      : Date.parse(header) - Date.now()
    : Number.NaN;
  if (Number.isFinite(ms)) return Math.min(3_600_000, Math.max(0, ms));
  return status === 429 ? 60_000 : undefined;
}
const httpError = (status: number, retryAfter?: string | null): Outcome => {
  const wait = cooling(status, retryAfter);
  return {
    kind: 'error',
    retriable: status >= 500,
    ...(wait !== undefined && { retryAfterMs: wait }),
    detail: `HTTP ${status}`,
  };
};

// ---- S1 / S4: the user's own Navidrome --------------------------------------------------------

/** Subsonic error 70 is "not found": an answer, not a failure. */
const notFoundOn70 = (err: unknown) => {
  if (err instanceof SubsonicError && err.code === 70) return null;
  throw err;
};

export function navidromeSource(client: () => Promise<SubsonicClient | null>): Source {
  return {
    id: 'navidrome',
    timeoutMs: 1500,
    retryAfterMs: 300,
    metadataKeyed: false,
    eligible: (i) => !!i.navidromeId,
    async fetch(i) {
      const c = await client();
      if (!c) return notFound;
      const r = await c
        .call('getLyricsBySongId', { id: i.navidromeId as string, enhanced: 'true' })
        .catch(notFoundOn70);
      if (!r) return notFound;
      const entries =
        (r.lyricsList as { structuredLyrics?: OsStructured[] } | undefined)?.structuredLyrics ?? [];
      if (!entries.some((e) => e.line?.length)) return notFound;
      return {
        kind: 'found',
        candidate: {
          ...parseOpenSubsonic(entries),
          source: 'navidrome',
          attribution: { text: 'Lyrics from your library' },
        },
      };
    },
  };
}

export function navidromePlainSource(client: () => Promise<SubsonicClient | null>): Source {
  return {
    id: 'navidrome-plain',
    timeoutMs: 1500,
    retryAfterMs: null,
    metadataKeyed: true,
    eligible: (i) => !!i.navidromeId && !!i.title && !!i.artist,
    async fetch(i) {
      const c = await client();
      if (!c) return notFound;
      const r = await c.call('getLyrics', { artist: i.artist, title: i.title }).catch(notFoundOn70);
      if (!r) return notFound;
      const l = r.lyrics as { value?: string; artist?: string; title?: string } | undefined;
      if (!l?.value?.trim()) return notFound;
      return {
        kind: 'found',
        candidate: {
          ...parsePlain(l.value),
          source: 'navidrome-plain',
          attribution: { text: 'Lyrics from your library' },
          matched: { title: l.title ?? i.title, artist: l.artist ?? i.artist },
        },
      };
    },
  };
}

// ---- S3: LRCLIB --------------------------------------------------------------------------------

export function lrclibSource(opts: {
  baseUrl: string;
  userAgent: string;
  fetch?: typeof fetch;
}): Source {
  const f = opts.fetch ?? fetch;
  return {
    id: 'lrclib',
    timeoutMs: 4000,
    retryAfterMs: 500,
    metadataKeyed: true,
    eligible: (i) => !!i.title && !!i.artist,
    async fetch(i, signal) {
      const q = new URLSearchParams({ track_name: i.title, artist_name: i.artist });
      if (i.album) q.set('album_name', i.album);
      if (i.durationMs) q.set('duration', String(Math.round(i.durationMs / 1000)));
      const res = await f(`${opts.baseUrl}/api/get?${q}`, {
        headers: { 'User-Agent': opts.userAgent },
        signal,
      });
      let b: LrclibRecord | undefined;
      if (res.status === 404) {
        const hit = await lrclibSearch(f, opts, i, signal);
        if (hit && 'kind' in hit) return hit; // the search failed: an error, not "not found"
        b = hit;
      } else if (!res.ok) return httpError(res.status, res.headers.get('retry-after'));
      else b = (await res.json()) as LrclibRecord;
      if (b?.instrumental) return instrumental;
      if (!b) return notFound;
      const parsed = b.syncedLyrics
        ? parseLrc(b.syncedLyrics)
        : b.plainLyrics
          ? parsePlain(b.plainLyrics)
          : null;
      if (!parsed) return notFound;
      return {
        kind: 'found',
        candidate: {
          ...parsed,
          source: 'lrclib',
          attribution: {
            text: 'Lyrics from LRCLIB',
            links: [{ label: 'LRCLIB', href: 'https://lrclib.net' }],
          },
          ...(b.duration && { reportedDurationMs: Math.round(b.duration * 1000) }),
          matched: { title: b.trackName ?? '', artist: b.artistName ?? '' },
        },
      };
    },
  };
}

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** The exact lookup missed: LRCLIB's search, nearest duration within 3 s, synced first. */
async function lrclibSearch(
  f: typeof fetch,
  opts: { baseUrl: string; userAgent: string },
  i: LookupInput,
  signal: AbortSignal,
): Promise<LrclibRecord | Outcome | undefined> {
  const q = new URLSearchParams({ track_name: i.title, artist_name: i.artist });
  const res = await f(`${opts.baseUrl}/api/search?${q}`, {
    headers: { 'User-Agent': opts.userAgent },
    signal,
  });
  if (res.status === 404) return undefined;
  if (!res.ok) return httpError(res.status, res.headers.get('retry-after'));
  const list = (await res.json()) as LrclibRecord[];
  const off = (r: LrclibRecord) =>
    i.durationMs && r.duration ? Math.abs(r.duration * 1000 - i.durationMs) : 0;
  return (Array.isArray(list) ? list : [])
    .filter((r) => !r.instrumental && off(r) <= 3000 && (r.syncedLyrics || r.plainLyrics))
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || off(a) - off(b))[0];
}

// ---- S5: NetEase Cloud Music -------------------------------------------------------------------

interface NeteaseSong {
  id: number;
  name: string;
  duration?: number;
  artists?: { name: string }[];
}

/** NetEase answers a keyless search and word-timed YRC for much of the Western catalogue too. */
export function neteaseSource(opts: { baseUrl: string; fetch?: typeof fetch }): Source {
  const f = opts.fetch ?? fetch;
  const headers = { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' };
  return {
    id: 'netease',
    timeoutMs: 4000,
    retryAfterMs: 500,
    metadataKeyed: true,
    eligible: (i) => !!i.title && !!i.artist,
    async fetch(i, signal) {
      const q = new URLSearchParams({ s: `${i.title} ${i.artist}`, type: '1', limit: '10' });
      const res = await f(`${opts.baseUrl}/api/search/get?${q}`, { headers, signal });
      if (!res.ok) return httpError(res.status, res.headers.get('retry-after'));
      const songs = ((await res.json()) as { result?: { songs?: NeteaseSong[] } }).result?.songs;
      // The best title match whose length agrees; the resolver checks title and artist again.
      const title = normalise(i.title);
      const song = (songs ?? [])
        .filter((s) => !i.durationMs || !s.duration || Math.abs(s.duration - i.durationMs) <= 3000)
        .map((s) => ({ s, score: jaroWinkler(normalise(s.name), title) }))
        .filter((x) => x.score >= 0.85)
        .sort((a, b) => b.score - a.score)[0]?.s;
      if (!song) return notFound;
      const lr = await f(`${opts.baseUrl}/api/song/lyric/v1?id=${song.id}&lv=1&yv=1`, {
        headers,
        signal,
      });
      if (!lr.ok) return httpError(lr.status, lr.headers.get('retry-after'));
      const b = (await lr.json()) as { yrc?: { lyric?: string }; lrc?: { lyric?: string } };
      let parsed: Parsed | null = null;
      if (b.yrc?.lyric?.trim())
        try {
          parsed = parseYrc(b.yrc.lyric);
        } catch (err) {
          if (!(err instanceof LyricsInvalid)) throw err;
        }
      if (!parsed && b.lrc?.lyric?.trim()) {
        const lrc = parseLrc(
          b.lrc.lyric
            .split('\n')
            .filter((l) => !CREDIT.test(l.replace(/^(\[[^\]]*\])+/, '')))
            .join('\n'),
        );
        if (lrc.sync !== 'none') parsed = lrc;
      }
      // NetEase marks instrumentals with a single line ("纯音乐，请欣赏").
      if (parsed && parsed.lines.length <= 1 && /纯音乐/.test(parsed.lines[0]?.text ?? ''))
        return instrumental;
      if (!parsed) return notFound;
      return {
        kind: 'found',
        candidate: {
          ...parsed,
          source: 'netease',
          attribution: {
            text: 'Lyrics from NetEase Cloud Music',
            links: [{ label: 'NetEase Cloud Music', href: 'https://music.163.com' }],
          },
          ...(song.duration && { reportedDurationMs: song.duration }),
          matched: { title: song.name, artist: song.artists?.map((a) => a.name).join(', ') ?? '' },
        },
      };
    },
  };
}

// ---- S2: Spicy Lyrics --------------------------------------------------------------------------

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const CATALOGUE: Record<string, string> = { apple_music: 'Apple Music', spotify: 'Spotify' };

/** A third-party URL as a link only when it is http(s): never `javascript:` or `data:`. */
const webUrl = (u: unknown) => {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
};

/** §8 and the API's attribution rule: the catalogue always; uploader and maker for community syncs. */
export function spicyAttribution(b: SpicyBody): Attribution {
  const spicy = { label: 'Spicy Lyrics', href: 'https://spicylyrics.org' };
  const via = CATALOGUE[b.source ?? ''];
  if (via) return { text: `Lyrics from ${via} via Spicy Lyrics`, links: [spicy] };
  const up = b.UploadAttribution;
  const parts = ['Lyrics from Spicy Lyrics'];
  const links = [spicy];
  if (up?.Maker) {
    parts.push(`synced by ${up.Maker.username}`);
    const href = webUrl(up.Maker.url);
    if (href) links.push({ label: up.Maker.username, href });
  }
  if (up?.Uploader) {
    parts.push(`uploaded by ${up.Uploader.username}`);
    const href = webUrl(up.Uploader.url);
    if (href) links.push({ label: up.Uploader.username, href });
  }
  if (b.SongWriters?.length) parts.push(`Written by ${b.SongWriters.join(', ')}`);
  return { text: parts.join(' · '), links };
}

export function spicySource(opts: {
  baseUrl: string;
  key: () => string | null;
  fetch?: typeof fetch;
}): Source {
  const f = opts.fetch ?? fetch;
  return {
    id: 'spicy',
    timeoutMs: 4000,
    retryAfterMs: 500,
    metadataKeyed: false,
    eligible: (i) => !!i.spotifyId && SPOTIFY_ID.test(i.spotifyId) && !!opts.key(),
    async fetch(i, signal) {
      // A matched Navidrome track may carry ids of several releases: the first one Spicy knows.
      const ids = [i.spotifyId, ...(i.spotifyAlt ?? [])].filter((x) => SPOTIFY_ID.test(x ?? ''));
      let res: Response | undefined;
      for (const id of ids.slice(0, 3)) {
        res = await f(`${opts.baseUrl}/v1/lyrics/${id}`, {
          headers: { Authorization: `Bearer ${opts.key()}` },
          signal,
        });
        if (res.status !== 404) break;
      }
      if (!res || res.status === 404) return notFound;
      if (!res.ok) return httpError(res.status, res.headers.get('retry-after'));
      const env = (await res.json()) as { Body?: SpicyBody };
      if (!env.Body?.Type)
        return { kind: 'error', retriable: false, detail: 'not a lyrics envelope' };
      const parsed = parseSpicy(env.Body);
      return {
        kind: 'found',
        candidate: {
          ...parsed,
          source: 'spicy',
          attribution: spicyAttribution(env.Body),
          ...(parsed.durationMs && { reportedDurationMs: parsed.durationMs }),
        },
      };
    },
  };
}
