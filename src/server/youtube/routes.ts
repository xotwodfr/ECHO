import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { YT_TABS, type YtTab } from '../../shared/youtube.ts';
import { requireAdmin, youtubeEnabled } from '../admin.ts';
import { audit } from '../audit.ts';
import { type AuthEnv, jsonObject } from '../auth/routes.ts';
import type { Sealer } from '../crypto.ts';
import type { Db } from '../db/db.ts';
import type { Log } from '../log.ts';
import { type Catalogue, YtSignedOut } from './catalogue.ts';
import { proxyImage, streamAudio } from './proxy.ts';
import { type Resolver, VIDEO_ID } from './ytdlp.ts';

// YouTube Music mode's API (spec calls 3, 6, 7). Each user browses with their own catalogue: their
// sealed cookie, or anonymous. The cookie is write-only (never returned) and sealed with
// rowId = the user id (admin-cli.ts SEALED re-seals it on key rotation). With the admin switch off,
// every /youtube route answers 404 `youtube.disabled`. Signed out (or a cookie Google rotated) is
// 409 `youtube.signed_out`: 401 would end the ECHO session in the client.

export interface YoutubeDeps {
  db: Db;
  sealer: Sealer;
  now: () => number;
  log?: Log;
  /** A catalogue for this cookie, or an anonymous one. */
  catalogue: (cookie?: string) => Catalogue;
  resolver: Resolver;
  /** The proxies' upstream fetch (tests). */
  fetch?: typeof fetch;
}

const BROWSE_ID = /^[\w-]{2,64}$/;
const MAX_COOKIE = 8192;
const MAX_PREPARE = 3;
const where = (userId: number) => ({
  table: 'youtube_accounts',
  rowId: userId,
  column: 'cookie_enc',
});

/** Whether the user has a saved sign-in (readable or not). */
export const youtubeSignedIn = (db: Db, userId: number) =>
  !!db.prepare('SELECT 1 FROM youtube_accounts WHERE user_id = ?').get(userId);

export function youtubeRoutes(deps: YoutubeDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const { db, sealer, now } = deps;
  const log: Log = deps.log ?? (() => {});
  const app = new Hono<AuthEnv>();

  const row = (userId: number) =>
    db.prepare('SELECT cookie_enc, name FROM youtube_accounts WHERE user_id = ?').get(userId) as
      | { cookie_enc: string; name: string }
      | undefined;
  /** The saved cookie, or null (none, or unreadable after a restore without the master key). */
  const cookieOf = (userId: number) => {
    const r = row(userId);
    if (!r) return null;
    try {
      return sealer.open(r.cookie_enc, where(userId));
    } catch {
      return null;
    }
  };

  // One catalogue per sign-in (a youtubei.js session each). The cache is checked against the stored
  // row on every request (its sealed value), never trusted by user id alone: ids are reused after a
  // delete, and a new account must not browse with the old one's cookie.
  const anonymous = deps.catalogue();
  const mine = new Map<number, { sealed: string; cat: Catalogue }>();
  const catalogueFor = (userId: number) => {
    const r = row(userId);
    if (!r) {
      mine.delete(userId);
      return anonymous;
    }
    const hit = mine.get(userId);
    if (hit?.sealed === r.cookie_enc) return hit.cat;
    const cookie = cookieOf(userId);
    if (!cookie) return anonymous;
    const cat = deps.catalogue(cookie);
    mine.set(userId, { sealed: r.cookie_enc, cat });
    return cat;
  };

  // ---- the sign-in ----

  app.get('/me/connections/youtube', requireUser, (c) => {
    const r = row(c.var.user.id);
    if (!r) return c.json({ connected: false });
    if (cookieOf(c.var.user.id) === null) return c.json({ connected: false, needsReentry: true });
    return c.json({ connected: true, name: r.name });
  });

  app.put('/me/connections/youtube', requireUser, async (c) => {
    const b = await jsonObject(c);
    const raw = typeof b?.cookie === 'string' ? b.cookie.trim().replace(/^cookie:\s*/i, '') : '';
    if (!raw || raw.length > MAX_COOKIE || !/(^|;\s*)(SAPISID|__Secure-3PAPISID)=/.test(raw))
      return c.json(
        {
          code: 'youtube.input',
          userMessage: 'Paste the whole Cookie header from a signed-in music.youtube.com tab.',
        },
        400,
      );
    const u = c.var.user;
    let name: string;
    try {
      ({ name } = await deps.catalogue(raw).account());
    } catch (err) {
      audit(db, now(), u.id, 'youtube.connect_failed', {
        code: err instanceof YtSignedOut ? 'signed_out' : 'failed',
      });
      return err instanceof YtSignedOut
        ? c.json(
            {
              code: 'youtube.signed_out',
              userMessage:
                'YouTube did not accept this cookie. Copy it again from a signed-in tab.',
            },
            400,
          )
        : c.json({ code: 'youtube.failed', userMessage: 'YouTube Music did not answer.' }, 502);
    }
    db.prepare(
      `INSERT INTO youtube_accounts (user_id, cookie_enc, name, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET cookie_enc = excluded.cookie_enc, name = excluded.name,
         updated_at = excluded.updated_at`,
    ).run(u.id, sealer.seal(raw, where(u.id)), name, now());
    mine.delete(u.id);
    audit(db, now(), u.id, 'youtube.connected');
    return c.json({ name });
  });

  app.delete('/me/connections/youtube', requireUser, (c) => {
    const u = c.var.user;
    db.prepare('DELETE FROM youtube_accounts WHERE user_id = ?').run(u.id);
    mine.delete(u.id);
    audit(db, now(), u.id, 'youtube.disconnected');
    return c.json({ ok: true });
  });

  // ---- yt-dlp, for admins ----

  app.get('/admin/youtube', requireUser, requireAdmin, (c) => c.json(deps.resolver.status()));

  // ---- browsing ----

  app.use('/youtube/*', requireUser, async (c, next) => {
    if (!youtubeEnabled(db)) return c.json({ code: 'youtube.disabled' }, 404);
    await next();
  });

  /** A catalogue call for the signed-in user, its failures as answers. */
  async function answer<T>(c: Context<AuthEnv>, fn: (cat: Catalogue) => Promise<T>) {
    const u = c.var.user;
    try {
      return c.json((await fn(catalogueFor(u.id))) as object);
    } catch (err) {
      if (err instanceof YtSignedOut) {
        const stale = youtubeSignedIn(db, u.id);
        return c.json(
          {
            code: 'youtube.signed_out',
            stale,
            userMessage: stale
              ? 'Sign in to YouTube Music again.'
              : 'Sign in to YouTube Music to see this.',
          },
          409,
        );
      }
      const message = (err as Error)?.message ?? String(err);
      if (/not found|status code (400|404)/i.test(message))
        return c.json({ code: 'youtube.not_found' }, 404);
      log('warn', 'youtube music failed', { route: c.req.routePath, detail: message });
      return c.json({ code: 'youtube.failed', userMessage: 'YouTube Music did not answer.' }, 502);
    }
  }

  const id = (c: Context<AuthEnv>, re: RegExp) => {
    const v = c.req.param('id') ?? '';
    return re.test(v) ? v : null;
  };
  const bad = (c: Context<AuthEnv>) => c.json({ error: 'bad_id' }, 400);

  app.get('/youtube/home', (c) => answer(c, (cat) => cat.home()));
  app.get('/youtube/explore', (c) => answer(c, (cat) => cat.explore()));
  app.get('/youtube/library', (c) => answer(c, (cat) => cat.library()));

  app.get('/youtube/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const tab = c.req.query('tab') ?? 'all';
    if (!q || q.length > 200 || !(YT_TABS as readonly string[]).includes(tab))
      return c.json({ error: 'bad_search' }, 400);
    return answer(c, (cat) => cat.search(q, tab as YtTab));
  });

  app.get('/youtube/suggest', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q || q.length > 200) return c.json({ items: [] });
    return answer(c, async (cat) => ({ items: await cat.suggest(q) }));
  });

  for (const kind of ['album', 'artist', 'playlist'] as const)
    app.get(`/youtube/${kind}/:id`, async (c) => {
      const v = id(c, BROWSE_ID);
      return v ? answer(c, (cat) => cat[kind](v)) : bad(c);
    });

  app.get('/youtube/up-next/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    return v ? answer(c, (cat) => cat.upNext(v)) : bad(c);
  });
  app.get('/youtube/related/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    return v ? answer(c, (cat) => cat.related(v)) : bad(c);
  });
  app.get('/youtube/lyrics/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    if (!v) return bad(c);
    const lyrics = await catalogueFor(c.var.user.id)
      .lyrics(v)
      .catch(() => null);
    return lyrics ? c.json(lyrics) : c.json({ error: 'no_lyrics' }, 404);
  });

  app.get('/youtube/like/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    return v ? answer(c, async (cat) => ({ like: await cat.liked(v) })) : bad(c);
  });

  app.put('/youtube/like/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    if (!v) return bad(c);
    const b = await jsonObject(c);
    if (typeof b?.like !== 'boolean') return c.json({ error: 'bad_like' }, 400);
    const on = b.like;
    return answer(c, async (cat) => {
      await cat.like(v, on);
      return { like: on };
    });
  });

  /** A play, for the user's YouTube history; never fails the player. */
  app.post('/youtube/played/:id', (c) => {
    const v = id(c, VIDEO_ID);
    if (!v) return bad(c);
    void catalogueFor(c.var.user.id)
      .played(v)
      .catch((err: unknown) => log('info', 'youtube history ping failed', { detail: String(err) }));
    return c.body(null, 204);
  });

  /** Resolve the next few songs ahead, so they start without yt-dlp's wait. */
  app.post('/youtube/prepare', async (c) => {
    const b = await jsonObject(c);
    const ids = b?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_PREPARE ||
      !ids.every((x) => typeof x === 'string' && VIDEO_ID.test(x))
    )
      return c.json({ error: 'bad_ids' }, 400);
    for (const x of ids as string[]) deps.resolver.prefetch(x);
    return c.body(null, 202);
  });

  // ---- media ----

  app.get('/youtube/stream/:id', async (c) => {
    const v = id(c, VIDEO_ID);
    return v ? streamAudio(c, v, deps.resolver, deps.fetch) : bad(c);
  });
  app.get('/youtube/image', (c) => proxyImage(c, c.req.query('u') ?? '', deps.fetch));

  return app;
}
