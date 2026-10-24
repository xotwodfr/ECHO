import { createHash } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import type { LyricsDoc } from '../../shared/types.ts';
import { requireAdmin } from '../admin.ts';
import { audit } from '../audit.ts';
import type { AuthEnv } from '../auth/routes.ts';
import type { Db } from '../db/db.ts';
import type { LyricsCache } from './cache.ts';
import { normalise, PRECEDENCE, type Resolver, type Tried } from './resolve.ts';
import type { LookupInput, Source, SourceId } from './sources.ts';
import { parseSpotifyId, type SpotifyMatcher } from './spotifyMatch.ts';

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
  /** A Navidrome track's Spotify ids, best first, so Spicy can serve it (§4.3, spotifyMatch.ts). */
  spotifyIdsFor?: (userId: number, scope: string, navidromeId: string) => Promise<string[]>;
  /** Admin → Server → Spotify matching; absent in tests that do not need it. */
  matcher?: SpotifyMatcher;
  /** Gate G2 (PLAYBACK_ARCHITECTURE.md §4.6): timed lyrics for Spotify tracks. Default on. */
  spotifySyncAllowed?: () => boolean;
}

/** G2 off: the words without their times (LYRICS_INTEGRATION.md §4.4), an untimed sheet. */
export function untimed(doc: LyricsDoc): LyricsDoc {
  return {
    ...doc,
    sync: 'none',
    lines: doc.lines.map((l) => ({
      text: l.text,
      start: 0,
      ...(l.agent && { agent: l.agent }),
      ...(l.oppositeAligned && { oppositeAligned: true }),
      ...(l.background && { background: l.background.map((b) => ({ text: b.text })) }),
    })),
  };
}

const KEY = /^[\w:.-]{1,200}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;
const OFFSET_MAX = 10_000;
const str = (v: string | undefined, max = 500) => (v && v.length <= max ? v : undefined);

interface Override {
  offsetMs: number;
  pinnedSource: SourceId | null;
}

export function lyricsRoutes(deps: LyricsDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();
  const inflight = new Map<string, Promise<{ doc: LyricsDoc | null; tried: Tried[] }>>();

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
    // Provider ids come from the track key itself, never from free-form parameters, and the
    // metadata used for the lookup is part of the cache key: a request cannot fill another
    // track's shared entry with a different song.
    const [provider, providerId] = [
      trackKey.slice(0, trackKey.indexOf(':')),
      trackKey.slice(trackKey.indexOf(':') + 1),
    ];
    const input: LookupInput = {
      trackKey,
      title: str(q.title) ?? '',
      artist: str(q.artist) ?? '',
      ...(str(q.album) && { album: str(q.album) }),
      ...(Number.isFinite(duration) && duration > 0 && { durationMs: Math.round(duration) }),
      ...(provider === 'navidrome' && providerId && { navidromeId: providerId }),
      ...(provider === 'spotify' && providerId && { spotifyId: providerId }),
      ...(q.isrc && ISRC.test(q.isrc) && { isrc: q.isrc.toUpperCase() }),
    };
    const user = c.var.user;
    const ov = override(user.id, trackKey);
    c.header('Cache-Control', 'private, no-store');
    const scope = provider === 'navidrome' ? `${deps.scopeFor(user.id)}|` : '';
    const meta = createHash('sha1')
      .update(
        [
          normalise(input.title),
          normalise(input.artist),
          normalise(input.album ?? ''),
          Math.round((input.durationMs ?? 0) / 1000),
          input.isrc ?? '',
        ].join('\u0000'),
      )
      .digest('hex')
      .slice(0, 16);
    // The Navidrome track's Spotify match picks the Spicy answer, so it is part of the key: a new
    // or corrected match is looked up afresh.
    if (provider === 'navidrome' && providerId && deps.spotifyIdsFor) {
      const ids = await deps.spotifyIdsFor(user.id, deps.scopeFor(user.id), providerId);
      if (ids[0]) {
        input.spotifyId = ids[0];
        input.spotifyAlt = ids.slice(1);
      }
    }
    // Sources the user turned off: their answers must not come back from the shared cache.
    const sources = deps.sourcesFor(user.id);
    const off = PRECEDENCE.filter((id) => !sources.some((s) => s.id === id));
    const key = `${scope}${trackKey}|${meta}${provider === 'navidrome' && input.spotifyId ? `|sp:${input.spotifyId}` : ''}${ov.pinnedSource ? `|${ov.pinnedSource}` : ''}${off.length ? `|-${off.join(',')}` : ''}`;

    // The cache keeps the full document; G2 applies on the way out, so switching it takes effect
    // on the next request (SP-04).
    const deliver = (doc: LyricsDoc) =>
      provider === 'spotify' && !(deps.spotifySyncAllowed?.() ?? true) ? untimed(doc) : doc;
    const hit = await deps.cache.get(key);
    if (hit && 'doc' in hit) return c.json({ doc: deliver(hit.doc), override: ov });
    if (hit) return c.json({ error: 'not_found', tried: hit.negative, override: ov }, 404);

    // Listeners of the same track at the same moment share one lookup.
    let p = inflight.get(key);
    if (!p) {
      p = deps.resolver
        .resolve(input, sources, {
          ...(ov.pinnedSource && { pin: ov.pinnedSource }),
          onLate: (doc) => void deps.cache.put(key, doc),
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const { doc, tried } = await p;
    if (doc) {
      await deps.cache.put(key, doc);
      return c.json({ doc: deliver(doc), override: ov });
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

  // ---- Admin → Server → Spotify matching (§4.3) ----
  const m = deps.matcher;
  if (m) {
    const admin = [requireUser, requireAdmin] as const;
    const view = (userId: number) => ({
      status: m.status(),
      counts: m.counts(deps.scopeFor(userId)),
    });
    app.get('/admin/spotify-matching', ...admin, (c) => c.json(view(c.var.user.id)));
    app.post('/admin/spotify-matching/run', ...admin, (c) => {
      void m.sweep();
      return c.json(view(c.var.user.id), 202);
    });
    app.get('/admin/spotify-matching/misses', ...admin, (c) => {
      const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
      const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
      return c.json(m.misses(deps.scopeFor(c.var.user.id), offset, limit));
    });
    app.get('/admin/spotify-matching/tracks/:id', ...admin, (c) => {
      const id = c.req.param('id');
      if (!KEY.test(id)) return c.json({ error: 'bad_track_key' }, 400);
      return c.json({ match: m.match(deps.scopeFor(c.var.user.id), id) });
    });
    // A correction holds for everyone on this Navidrome server, so only an admin makes it.
    app.put('/admin/spotify-matching/tracks/:id', ...admin, async (c) => {
      const id = c.req.param('id');
      if (!KEY.test(id)) return c.json({ error: 'bad_track_key' }, 400);
      let b: { spotify?: unknown };
      try {
        b = await c.req.json();
      } catch {
        return c.json({ error: 'bad_spotify_id' }, 400);
      }
      const sid = typeof b.spotify === 'string' ? parseSpotifyId(b.spotify) : null;
      if (b.spotify !== null && !sid)
        return c.json({ error: 'bad_spotify_id', detail: 'A Spotify track link, URI or id' }, 400);
      const scope = deps.scopeFor(c.var.user.id);
      m.setManual(scope, id, sid);
      audit(deps.db, Date.now(), c.var.user.id, 'admin.spotify_match', { track: id, set: !!sid });
      return c.json({ match: m.match(scope, id) });
    });
  }

  return app;
}
