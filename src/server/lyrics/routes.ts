import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthEnv } from '../auth/routes.ts';
import type { Db } from '../db/db.ts';
import type { LyricsCache } from './cache.ts';
import { PRECEDENCE, type Resolver, type Tried } from './resolve.ts';
import type { LookupInput, Source, SourceId } from './sources.ts';

// GET /api/v1/lyrics (LYRICS_INTEGRATION.md §3): cache first, then the resolver; a late improvement
// replaces the cache entry for next time. The user's per-track override (timing offset and source
// pin, LYRICS_EXPERIENCE.md §9.13) comes with the answer; PUT /me/tracks/:trackKey/override sets it.

export interface LyricsDeps {
  db: Db;
  cache: LyricsCache;
  resolver: Resolver;
  /** The sources for this user (S1/S4 use their own Navidrome). */
  sourcesFor: (userId: number) => Source[];
  /** The user's Navidrome URL: a Navidrome track key means something only on its own server. */
  scopeFor: (userId: number) => string;
}

const KEY = /^[\w:.-]{1,200}$/;
const OFFSET_MAX = 10_000;
const str = (v: string | undefined, max = 500) => (v && v.length <= max ? v : undefined);

interface Override {
  offsetMs: number;
  pinnedSource: SourceId | null;
}

export function lyricsRoutes(deps: LyricsDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();
  const inflight = new Map<
    string,
    Promise<{ doc: import('../../shared/types.ts').LyricsDoc | null; tried: Tried[] }>
  >();

  const override = (userId: number, trackKey: string): Override => {
    const row = deps.db
      .prepare(
        'SELECT offset_ms, pinned_source FROM track_overrides WHERE user_id = ? AND track_key = ?',
      )
      .get(userId, trackKey) as { offset_ms: number; pinned_source: string | null } | undefined;
    return {
      offsetMs: row?.offset_ms ?? 0,
      pinnedSource: (row?.pinned_source as SourceId | null) ?? null,
    };
  };

  app.get('/lyrics', requireUser, async (c) => {
    const q = c.req.query();
    const trackKey = q.trackKey ?? '';
    if (!KEY.test(trackKey)) return c.json({ error: 'bad_track_key' }, 400);
    const duration = Number(q.durationMs);
    const input: LookupInput = {
      trackKey,
      title: str(q.title) ?? '',
      artist: str(q.artist) ?? '',
      ...(str(q.album) && { album: str(q.album) }),
      ...(Number.isFinite(duration) && duration > 0 && { durationMs: Math.round(duration) }),
      ...(str(q.isrc, 20) && { isrc: str(q.isrc, 20) }),
      ...(str(q.spotifyId, 30) && { spotifyId: str(q.spotifyId, 30) }),
      ...(str(q.navidromeId, 200) && { navidromeId: str(q.navidromeId, 200) }),
    };
    const user = c.var.user;
    const ov = override(user.id, trackKey);
    c.header('Cache-Control', 'private, no-store');
    const scope = trackKey.startsWith('navidrome:') ? `${deps.scopeFor(user.id)}|` : '';
    const key = `${scope}${trackKey}${ov.pinnedSource ? `|${ov.pinnedSource}` : ''}`;

    const hit = await deps.cache.get(key);
    if (hit && 'doc' in hit) return c.json({ doc: hit.doc, override: ov });
    if (hit) return c.json({ error: 'not_found', tried: hit.negative, override: ov }, 404);

    // Listeners of the same track at the same moment share one lookup.
    let p = inflight.get(key);
    if (!p) {
      p = deps.resolver
        .resolve(input, deps.sourcesFor(user.id), {
          ...(ov.pinnedSource && { pin: ov.pinnedSource }),
          onLate: (doc) => void deps.cache.put(key, doc),
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const { doc, tried } = await p;
    if (doc) {
      await deps.cache.put(key, doc);
      return c.json({ doc, override: ov });
    }
    // A miss is remembered only when every source answered; errors and timeouts may pass.
    if (tried.length && tried.every((t) => ['notFound', 'mismatch', 'invalid'].includes(t.outcome)))
      await deps.cache.putNegative(key, tried);
    return c.json({ error: 'not_found', tried, override: ov }, 404);
  });

  app.get('/me/tracks/:trackKey/override', requireUser, (c) => {
    const trackKey = c.req.param('trackKey');
    if (!KEY.test(trackKey)) return c.json({ error: 'bad_track_key' }, 400);
    return c.json(override(c.var.user.id, trackKey));
  });

  app.put('/me/tracks/:trackKey/override', requireUser, async (c) => {
    const trackKey = c.req.param('trackKey');
    if (!KEY.test(trackKey)) return c.json({ error: 'bad_track_key' }, 400);
    let b: { offsetMs?: unknown; pinnedSource?: unknown };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ error: 'bad_override' }, 400);
    }
    const now = override(c.var.user.id, trackKey);
    if (b.offsetMs !== undefined) {
      if (
        typeof b.offsetMs !== 'number' ||
        !Number.isInteger(b.offsetMs) ||
        Math.abs(b.offsetMs) > OFFSET_MAX
      )
        return c.json({ error: 'bad_offset', detail: `whole ms within ±${OFFSET_MAX}` }, 400);
      now.offsetMs = b.offsetMs;
    }
    if (b.pinnedSource !== undefined) {
      if (b.pinnedSource !== null && !PRECEDENCE.includes(b.pinnedSource as SourceId))
        return c.json({ error: 'bad_source' }, 400);
      now.pinnedSource = b.pinnedSource as SourceId | null;
    }
    deps.db
      .prepare(
        `INSERT INTO track_overrides (user_id, track_key, offset_ms, pinned_source) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, track_key) DO UPDATE SET offset_ms = excluded.offset_ms, pinned_source = excluded.pinned_source`,
      )
      .run(c.var.user.id, trackKey, now.offsetMs, now.pinnedSource);
    return c.json(now);
  });

  return app;
}
