import type { Attribution, LyricsDoc } from '../../shared/types.ts';
import { type SubsonicClient, SubsonicError } from '../navidrome/client.ts';
import {
  type OsStructured,
  type Parsed,
  parseLrc,
  parseOpenSubsonic,
  parsePlain,
  parseSpicy,
  type SpicyBody,
} from './parse.ts';

// The lyric sources (LYRICS_INTEGRATION.md §1, §6, §8): S1 the user's Navidrome (structured,
// enhanced), S2 Spicy Lyrics (the admin's secret key, server-side only), S3 LRCLIB, S4 Navidrome's
// legacy plain text. Each answers found / not found / error, with its own timeout and retry policy;
// the resolver (resolve.ts) runs them in parallel and picks.

export type SourceId = 'navidrome' | 'spicy' | 'lrclib' | 'navidrome-plain';

export interface LookupInput {
  trackKey: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  spotifyId?: string;
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
  | { kind: 'notFound' }
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
const httpError = (status: number, retryAfter?: string | null): Outcome => ({
  kind: 'error',
  retriable: status >= 500,
  ...(retryAfter && { retryAfterMs: Number(retryAfter) * 1000 }),
  detail: `HTTP ${status}`,
});

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
      if (res.status === 404) return notFound;
      if (!res.ok) return httpError(res.status, res.headers.get('retry-after'));
      const b = (await res.json()) as {
        trackName?: string;
        artistName?: string;
        duration?: number;
        instrumental?: boolean;
        plainLyrics?: string | null;
        syncedLyrics?: string | null;
      };
      if (b.instrumental) return notFound;
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

// ---- S2: Spicy Lyrics --------------------------------------------------------------------------

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const CATALOGUE: Record<string, string> = { apple_music: 'Apple Music', spotify: 'Spotify' };

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
    links.push({ label: up.Maker.username, href: up.Maker.url });
  }
  if (up?.Uploader) {
    parts.push(`uploaded by ${up.Uploader.username}`);
    links.push({ label: up.Uploader.username, href: up.Uploader.url });
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
      const res = await f(`${opts.baseUrl}/v1/lyrics/${i.spotifyId}`, {
        headers: { Authorization: `Bearer ${opts.key()}` },
        signal,
      });
      if (res.status === 404) return notFound;
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
