import { Hono, type MiddlewareHandler } from 'hono';
import type { Mix, TrackRef, Wrapped } from '../shared/types.ts';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';
import type { SubsonicClient } from './navidrome/client.ts';

// What the user played, and the mixes made from it (docs/superpowers/specs/2026-10-29-spotify-
// redesign-design.md, project 2): every Navidrome song played past its scrobble point is a row in
// `plays`, and from those rows (plus the user's own Navidrome for songs not played yet) come
// Spotify's Made For You mixes, "Jump back in", and a yearly Wrapped. Nothing leaves the server.

const DAY = 86_400_000;
const MIX_SIZE = 30;
const DAILY_MIXES = 6;
const KEEP_MS = 2 * 365 * DAY; // plays older than two years are let go

export interface Play extends TrackRef {
  playedAt: number;
  contextKind?: string;
  contextId?: string;
  contextTitle?: string;
}

// ---- pure: from plays to mixes ------------------------------------------------------------------

/** A small seeded generator (mulberry32): a mix keeps its order for its day or week. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const r = rng(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Tracks by how often they were played, most first; ties by the latest play. */
export function topTracks(plays: readonly Play[]): TrackRef[] {
  const by = new Map<string, { t: TrackRef; n: number; last: number }>();
  for (const p of plays) {
    const e = by.get(p.id);
    if (e) {
      e.n++;
      e.last = Math.max(e.last, p.playedAt);
    } else by.set(p.id, { t: refOf(p), n: 1, last: p.playedAt });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.last - a.last).map((e) => e.t);
}

/** Artists by plays, most first, with their own most played songs. */
export function topArtists(plays: readonly Play[]) {
  const by = new Map<string, { name: string; id?: string; n: number; plays: Play[] }>();
  for (const p of plays) {
    const key = p.artistId ?? `name:${p.artist.toLowerCase()}`;
    const e = by.get(key);
    if (e) {
      e.n++;
      e.plays.push(p);
    } else by.set(key, { name: p.artist, id: p.artistId, n: 1, plays: [p] });
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

const refOf = (p: Play): TrackRef => ({
  id: p.id,
  title: p.title,
  artist: p.artist,
  ...(p.artistId && { artistId: p.artistId }),
  album: p.album,
  ...(p.albumId && { albumId: p.albumId }),
  durationMs: p.durationMs,
  ...(p.cover && { cover: p.cover }),
});

/** The part of the day a time falls in, as Spotify's daylist names it. */
export function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** On Repeat: the songs played most in the last 30 days (two plays at least). */
export function onRepeat(plays: readonly Play[], now: number): Mix | null {
  const counts = new Map<string, number>();
  const recent = plays.filter((p) => p.playedAt > now - 30 * DAY);
  for (const p of recent) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const tracks = topTracks(recent).filter((t) => (counts.get(t.id) ?? 0) >= 2);
  if (tracks.length < 5) return null;
  return {
    id: 'on-repeat',
    kind: 'onRepeat',
    title: 'On Repeat',
    subtitle: 'The songs you can’t get enough of right now',
    tracks: tracks.slice(0, MIX_SIZE),
  };
}

/** Repeat Rewind: old favourites, played most between a month and two years ago, not lately. */
export function rewind(plays: readonly Play[], now: number): Mix | null {
  const lately = new Set(plays.filter((p) => p.playedAt > now - 30 * DAY).map((p) => p.id));
  const older = plays.filter((p) => p.playedAt <= now - 30 * DAY && !lately.has(p.id));
  const tracks = topTracks(older);
  if (tracks.length < 5) return null;
  return {
    id: 'rewind',
    kind: 'rewind',
    title: 'Repeat Rewind',
    subtitle: 'Past favourites, back for another listen',
    tracks: tracks.slice(0, MIX_SIZE),
  };
}

/** Daylist: what is played at this part of the day, on this day's seed. */
export function daylist(plays: readonly Play[], now: number, offsetMin = 0): Mix | null {
  const local = (t: number) => new Date(t - offsetMin * 60_000);
  const at = local(now);
  const part = partOfDay(at.getUTCHours());
  const same = plays.filter(
    (p) => p.playedAt > now - 60 * DAY && partOfDay(local(p.playedAt).getUTCHours()) === part,
  );
  const tracks = shuffled(topTracks(same).slice(0, 60), Math.floor(now / DAY));
  if (tracks.length < 5) return null;
  return {
    id: 'daylist',
    kind: 'daylist',
    title: `daylist: ${WEEKDAYS[at.getUTCDay()]} ${part}`.toLowerCase(),
    subtitle: `What you play on ${WEEKDAYS[at.getUTCDay()]} ${part}s`,
    tracks: tracks.slice(0, MIX_SIZE),
  };
}

/**
 * Daily Mixes, seeded by the top artists of the last 90 days: each mix is that artist's songs the
 * user plays, and the `extra` songs the library knows (their top songs and their similar artists'),
 * mixed so neither runs in a block.
 */
export function dailyMixes(
  plays: readonly Play[],
  now: number,
  extra: (artist: { id?: string; name: string }) => TrackRef[] = () => [],
): Mix[] {
  const recent = plays.filter((p) => p.playedAt > now - 90 * DAY);
  return topArtists(recent)
    .filter((a) => a.n >= 3)
    .slice(0, DAILY_MIXES)
    .map((a, i) => {
      const own = topTracks(a.plays);
      const more = extra(a).filter((t) => !own.some((o) => o.id === t.id));
      const seed = Math.floor(now / DAY) + i;
      const mixed = interleave(shuffled(own, seed), shuffled(more, seed + 99));
      const names = [...new Set([a.name, ...more.map((t) => t.artist)])].slice(0, 3);
      return {
        id: `daily-${i + 1}`,
        kind: 'daily' as const,
        title: `Daily Mix ${i + 1}`,
        subtitle: `${names.join(', ')} and more`,
        tracks: unique(mixed).slice(0, MIX_SIZE),
      };
    });
}

/** Discover Weekly: songs not played yet, from `candidates`, the same all week. */
export function discover(plays: readonly Play[], now: number, candidates: TrackRef[]): Mix | null {
  const heard = new Set(plays.map((p) => p.id));
  const week = Math.floor((now + 3 * DAY) / (7 * DAY)); // the epoch was a Thursday: Mondays
  const fresh = shuffled(unique(candidates.filter((t) => !heard.has(t.id))), week);
  if (fresh.length < 5) return null;
  return {
    id: 'discover',
    kind: 'discover',
    title: 'Discover Weekly',
    subtitle: 'Your weekly mix of music you haven’t played yet',
    tracks: fresh.slice(0, MIX_SIZE),
  };
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i] as T);
    if (i < b.length) out.push(b[i] as T);
  }
  return out;
}

const unique = (list: TrackRef[]) => [...new Map(list.map((t) => [t.id, t])).values()];

/** A year in review: minutes, top artists, songs and albums, the biggest day. */
export function wrapped(plays: readonly Play[], year: number): Wrapped {
  const inYear = plays.filter((p) => new Date(p.playedAt).getUTCFullYear() === year);
  const counts = new Map<string, number>();
  for (const p of inYear) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const albums = new Map<string, Wrapped['albums'][number]>();
  const days = new Map<string, number>();
  for (const p of inYear) {
    const key = p.albumId ?? p.album;
    const a = albums.get(key);
    if (a) a.plays++;
    else
      albums.set(key, {
        title: p.album,
        ...(p.albumId && { id: p.albumId }),
        artist: p.artist,
        ...(p.cover && { cover: p.cover }),
        plays: 1,
      });
    const day = new Date(p.playedAt).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const top = [...days].sort((a, b) => b[1] - a[1])[0];
  const artists = topArtists(inYear);
  return {
    year,
    minutes: Math.round(inYear.reduce((m, p) => m + p.durationMs, 0) / 60_000),
    plays: inYear.length,
    artists: artists
      .slice(0, 5)
      .map((a) => ({ name: a.name, ...(a.id && { id: a.id }), plays: a.n })),
    tracks: topTracks(inYear)
      .slice(0, 50)
      .map((t) => ({ ...t, plays: counts.get(t.id) ?? 0 })),
    albums: [...albums.values()].sort((a, b) => b.plays - a.plays).slice(0, 5),
    topDay: top ? { date: top[0], plays: top[1] } : null,
    distinctArtists: artists.length,
  };
}

// ---- the routes -----------------------------------------------------------------------------------

type Song = {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
};

/** A Navidrome song as a TrackRef, its cover through ECHO's proxy (library-navidrome.ts's size). */
export const songRef = (s: Song): TrackRef => ({
  id: s.id,
  title: s.title,
  artist: s.artist ?? '',
  ...(s.artistId && { artistId: s.artistId }),
  album: s.album ?? '',
  ...(s.albumId && { albumId: s.albumId }),
  durationMs: (s.duration ?? 0) * 1000,
  ...(s.coverArt && {
    cover: `/api/v1/navidrome/cover/${encodeURIComponent(s.coverArt)}?size=600`,
  }),
});

const text = (v: unknown, max = 500) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
const COVER = /^\/api\/v1\/navidrome\/cover\/[^?#\s]+(\?size=\d+)?$/;

/** A play from the client, checked field by field; null when it is not one. */
export function playOf(b: Record<string, unknown>, now: number): Play | null {
  const t = b.track as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return null;
  const artists = Array.isArray(t.artists) ? (t.artists as Record<string, unknown>[]) : [];
  const album = (t.album ?? {}) as Record<string, unknown>;
  const artwork = Array.isArray(t.artwork) ? (t.artwork as Record<string, unknown>[]) : [];
  const ctx = (b.context ?? {}) as Record<string, unknown>;
  const id = text(t.id, 200);
  const title = text(t.title);
  const artist = text(artists[0]?.name);
  const albumTitle = text(album.title) ?? '';
  const ms = typeof t.durationMs === 'number' && t.durationMs >= 0 ? Math.round(t.durationMs) : 0;
  if (!id || !title || !artist || t.provider !== 'navidrome') return null;
  const cover = text(artwork[0]?.url);
  const contextKind = text(ctx.kind, 20);
  const contextId = text(ctx.id, 200);
  const contextTitle = text(ctx.title);
  return {
    id,
    title,
    artist,
    ...(text(artists[0]?.id, 200) && { artistId: artists[0]?.id as string }),
    album: albumTitle,
    ...(text(album.id, 200) && { albumId: album.id as string }),
    durationMs: Math.min(ms, 24 * 3_600_000),
    ...(cover && COVER.test(cover) && { cover }),
    playedAt: now,
    ...(contextKind && { contextKind }),
    ...(contextId && { contextId }),
    ...(contextTitle && { contextTitle }),
  };
}

const COLUMNS = `track_id AS id, title, artist, artist_id AS artistId, album, album_id AS albumId,
  duration_ms AS durationMs, cover, played_at AS playedAt, context_kind AS contextKind,
  context_id AS contextId, context_title AS contextTitle`;

/** SQLite gives NULL for missing optional columns: drop them, as the JSON elsewhere does. */
const clean = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as T;

export function playsRoutes(
  deps: {
    db: Db;
    now: () => number;
    navidrome: (userId: number) => Promise<SubsonicClient | null>;
  },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const { db, now } = deps;
  const app = new Hono<AuthEnv>();
  const playsOf = (userId: number, since = 0) =>
    (
      db
        .prepare(
          `SELECT ${COLUMNS} FROM plays WHERE user_id = ? AND played_at > ? ORDER BY played_at`,
        )
        .all(userId, since) as Play[]
    ).map(clean);

  app.post('/me/plays', requireUser, async (c) => {
    const b = await jsonObject(c);
    const t = now();
    const p = b && playOf(b, t);
    if (!p) return c.json({ error: 'bad_play' }, 400);
    const id = c.var.user.id;
    db.prepare(
      `INSERT INTO plays (user_id, played_at, track_id, title, artist, artist_id, album, album_id,
        duration_ms, cover, context_kind, context_id, context_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      p.playedAt,
      p.id,
      p.title,
      p.artist,
      p.artistId ?? null,
      p.album,
      p.albumId ?? null,
      p.durationMs,
      p.cover ?? null,
      p.contextKind ?? null,
      p.contextId ?? null,
      p.contextTitle ?? null,
    );
    db.prepare('DELETE FROM plays WHERE user_id = ? AND played_at < ?').run(id, t - KEEP_MS);
    return c.json({ ok: true });
  });

  /** Recently played songs, each once, latest first. */
  app.get('/me/plays/recent', requireUser, (c) => {
    c.header('Cache-Control', 'no-store');
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20));
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM plays p WHERE user_id = ? AND played_at = (
           SELECT MAX(played_at) FROM plays WHERE user_id = p.user_id AND track_id = p.track_id)
         ORDER BY played_at DESC LIMIT ?`,
      )
      .all(c.var.user.id, limit) as Play[];
    return c.json({ tracks: rows.map(clean).map(refOf) });
  });

  /** "Jump back in": the albums and playlists played from lately, each once, latest first. */
  app.get('/me/plays/contexts', requireUser, (c) => {
    c.header('Cache-Control', 'no-store');
    const rows = db
      .prepare(
        `SELECT context_kind AS kind, context_id AS id, context_title AS title,
           MAX(played_at) AS at, MAX(cover) AS cover
         FROM plays WHERE user_id = ? AND context_kind IN ('album', 'playlist', 'artist', 'mix')
           AND context_id IS NOT NULL
         GROUP BY context_kind, context_id ORDER BY at DESC LIMIT 12`,
      )
      .all(c.var.user.id) as { kind: string; id: string; title: string | null; at: number }[];
    return c.json({ contexts: rows.map(clean) });
  });

  // Mixes ask the user's Navidrome for songs beyond their plays (some 30 calls): once a day per
  // user, or sooner while a short history is still growing into its first mixes.
  // ponytail: in memory, per process; a restart rebuilds them.
  const mixCache = new Map<number, { day: number; count: number; mixes: Mix[] }>();

  async function libraryExtras(userId: number, plays: Play[], t: number) {
    const extras = new Map<string, TrackRef[]>();
    const candidates: TrackRef[] = [];
    const client = await deps.navidrome(userId).catch(() => null);
    if (!client) return { extras, candidates };
    type R = Record<string, Record<string, unknown>> | null;
    const ask = (method: string, params: Record<string, string>) =>
      client.call(method, params).catch(() => null) as Promise<R>;
    const top = async (artist: string, count: number) =>
      ((await ask('getTopSongs', { artist, count: String(count) }))?.topSongs?.song ??
        []) as Song[];
    const artists = topArtists(plays.filter((p) => p.playedAt > t - 90 * DAY)).slice(
      0,
      DAILY_MIXES,
    );
    const known = new Set(artists.map((a) => a.name.toLowerCase()));
    await Promise.all(
      artists.map(async (a) => {
        const info = a.id ? await ask('getArtistInfo2', { id: a.id, count: '3' }) : null;
        const similar = ((info?.artistInfo2?.similarArtist ?? []) as { name: string }[]).slice(
          0,
          3,
        );
        const [own, ...theirs] = await Promise.all([
          top(a.name, 15),
          ...similar.map((s) => top(s.name, 6)),
        ]);
        extras.set(a.name, [own, ...theirs].flat().map(songRef));
        // Discover Weekly takes the similar artists the user does not play yet.
        theirs.forEach((list, i) => {
          if (!known.has((similar[i]?.name ?? '').toLowerCase()))
            candidates.push(...list.map(songRef));
        });
      }),
    );
    // Without Last.fm's similar artists: unplayed songs from anywhere in the library.
    if (candidates.length < MIX_SIZE) {
      const random = await ask('getRandomSongs', { size: '120' });
      candidates.push(...((random?.randomSongs?.song ?? []) as Song[]).map(songRef));
    }
    return { extras, candidates };
  }

  app.get('/me/mixes', requireUser, async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.var.user.id;
    const t = now();
    const day = Math.floor(t / DAY);
    // The daylist follows the hour (the client's UTC offset, as getTimezoneOffset gives it).
    const offset = Math.max(-840, Math.min(840, Number(c.req.query('tz')) || 0));
    const plays = playsOf(id, t - KEEP_MS);
    const today = daylist(plays, t, offset);
    let cached = mixCache.get(id);
    if (!cached || cached.day !== day || plays.length >= cached.count * 1.25 + 3) {
      const { extras, candidates } = await libraryExtras(id, plays, t);
      const mixes = [
        ...dailyMixes(plays, t, (a) => extras.get(a.name) ?? []),
        discover(plays, t, candidates),
        onRepeat(plays, t),
        rewind(plays, t),
      ].filter((m): m is Mix => m !== null);
      cached = { day, count: plays.length, mixes };
      mixCache.set(id, cached);
    }
    return c.json({ mixes: today ? [...cached.mixes, today] : cached.mixes });
  });

  app.get('/me/wrapped', requireUser, (c) => {
    c.header('Cache-Control', 'no-store');
    const year = Number(c.req.query('year')) || new Date(now()).getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 3000)
      return c.json({ error: 'bad_year' }, 400);
    const start = Date.UTC(year, 0, 1);
    return c.json(wrapped(playsOf(c.var.user.id, start - 1), year));
  });

  return app;
}
