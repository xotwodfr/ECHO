import type { Db } from '../db/db.ts';
import { jaroWinkler, normalise } from './resolve.ts';
import type { LookupInput } from './sources.ts';

// Spotify IDs for Navidrome tracks, so Spicy Lyrics can serve them (LYRICS_INTEGRATION.md §4.3):
// by ISRC when the track has one, else by title and primary artist (duration within 2 s, title
// similarity ≥ 0.9). Only with the requesting user's own Spotify connection and their opt-in
// (LI-08); the mappings are shared, so everyone on the server benefits from those already found.
// Found: 30 days; none: 7 days.

const DAY = 86_400_000;
export const MAPPING_TTL = { found: 30 * DAY, none: 7 * DAY };
const LOOKUP_TIMEOUT_MS = 1500; // inside the resolver's 4.5 s

interface SpTrack {
  id: string;
  name: string;
  duration_ms: number;
}

export function createSpotifyIds(opts: {
  db: Db;
  now: () => number;
  apiUrl: string;
  /** The user's access token when they are connected and opted in, else null (no lookup). */
  tokenFor: (userId: number) => Promise<string | null>;
  fetch?: typeof fetch;
}) {
  const f: typeof fetch = (u, i) => (opts.fetch ?? fetch)(u, i);
  const inflight = new Map<string, Promise<string | null>>();

  /** The cached mapping: a Spotify id, null ("none"), or undefined (not known). */
  function cached(key: string): string | null | undefined {
    const row = opts.db
      .prepare('SELECT spotify_id, expires_at FROM spotify_ids WHERE key = ?')
      .get(key) as { spotify_id: string | null; expires_at: number } | undefined;
    if (!row || row.expires_at <= opts.now()) return undefined;
    return row.spotify_id;
  }

  async function search(token: string, q: string, limit: number) {
    const url = new URL('/v1/search', opts.apiUrl);
    url.search = new URLSearchParams({ q, type: 'track', limit: String(limit) }).toString();
    const res = await f(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`spotify search ${res.status}`);
    return ((await res.json()) as { tracks?: { items?: SpTrack[] } }).tracks?.items ?? [];
  }

  async function lookup(token: string, input: LookupInput): Promise<string | null> {
    if (input.isrc) return (await search(token, `isrc:${input.isrc}`, 1))[0]?.id ?? null;
    const primary = input.artist.split(/,|&| and | x /i)[0]?.trim() ?? input.artist;
    const q = `track:"${input.title.replace(/"/g, '')}" artist:"${primary.replace(/"/g, '')}"`;
    const items = await search(token, q, 5);
    const want = normalise(input.title);
    const ok = items
      .filter(
        (t) => input.durationMs === undefined || Math.abs(t.duration_ms - input.durationMs) <= 2000,
      )
      .map((t) => ({ t, score: jaroWinkler(normalise(t.name), want) }))
      .filter((x) => x.score >= 0.9)
      .sort((a, b) => b.score - a.score);
    return ok[0]?.t.id ?? null;
  }

  return {
    /**
     * The Spotify id for a Navidrome track on `scope` (its server): from the shared cache, or looked
     * up with this user's connection when they allow it. Errors and timeouts cache nothing.
     */
    async idFor(userId: number, scope: string, input: LookupInput): Promise<string | undefined> {
      if (!input.navidromeId) return undefined;
      const key = `${scope}|${input.navidromeId}`;
      const known = cached(key);
      if (known !== undefined) return known ?? undefined;
      let p = inflight.get(key);
      if (!p) {
        p = (async () => {
          const token = await opts.tokenFor(userId);
          if (!token) return null; // LI-08: no connection or no opt-in, no lookup
          const id = await lookup(token, input);
          opts.db
            .prepare(
              `INSERT INTO spotify_ids (key, spotify_id, expires_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET spotify_id = excluded.spotify_id, expires_at = excluded.expires_at`,
            )
            .run(key, id, opts.now() + (id ? MAPPING_TTL.found : MAPPING_TTL.none));
          return id;
        })()
          .catch(() => null)
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      return (await p) ?? undefined;
    },
  };
}

export type SpotifyIds = ReturnType<typeof createSpotifyIds>;
