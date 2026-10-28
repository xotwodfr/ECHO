import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { audit } from '../audit.ts';
import { type AuthEnv, body } from '../auth/routes.ts';
import type { SessionUser } from '../auth/sessions.ts';
import type { Sealer } from '../crypto.ts';
import type { Db } from '../db/db.ts';
import { type Credentials, createClient, type SubsonicClient, SubsonicError } from './client.ts';
import { checkUrl, type Resolver, UrlRejected } from './url.ts';

// Each user's own Navidrome (PLAYBACK_ARCHITECTURE.md §5; SETTINGS_AND_SECURITY.md §6.1): the
// connection (URL rules, a test, the secret sealed at rest and never returned), the allow-listed
// Subsonic proxy signed with that user's credentials, streams with Range passed through unbuffered,
// covers, and signed stream URLs for clients that cannot send a cookie or header (§6.5).

export interface NavidromeDeps {
  db: Db;
  sealer: Sealer;
  now: () => number;
  defaultUrl: string | null; // ECHO_NAVIDROME_URL
  streamKey: Buffer; // HKDF subkey 'stream-url'
  resolve?: Resolver;
}

/** The methods the proxy forwards (§5.2); everything else is 403. */
const READ = new Set([
  'ping',
  'getOpenSubsonicExtensions',
  'getLicense',
  'getScanStatus',
  'getArtists',
  'getArtist',
  'getAlbum',
  'getAlbumList2',
  'getSong',
  'getPlaylists',
  'getPlaylist',
  'getStarred2',
  'search3',
  'getLyrics',
  'getLyricsBySongId',
]);
/**
 * Subsonic changes state over GET. ECHO's proxy takes these as POST only, so the Origin check
 * applies and a link on another site cannot star or scrobble for a signed-in user.
 */
const WRITE = new Set(['star', 'unstar', 'scrobble']);
const STREAM_PARAMS = ['format', 'maxBitRate', 'timeOffset', 'estimateContentLength'];
const STREAM_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
];
const SIGNED_TTL_MS = 6 * 3_600_000;
/** What a stream and a cover may be served as. SVG is not a raster image: it can carry script. */
const AUDIO = /^(audio\/[\w.+-]+|application\/ogg)$/i;
const RASTER = /^image\/(png|jpeg|webp|gif|avif)$/i;

interface Stored {
  url: string;
  username: string;
  auth: 'password' | 'apiKey';
  serverVersion?: string;
  extensions?: string[];
}

type Problem = { code: string; userMessage: string };

function problemOf(err: unknown): Problem {
  if (err instanceof UrlRejected) {
    const msg = {
      bad_url: 'That is not a valid server address.',
      https_required: 'Use an https:// address for servers outside this machine.',
      private_address: 'That address is on a private network. Ask your admin to allow it.',
      unresolvable: 'That server name could not be found.',
    }[err.code];
    return { code: `navidrome.url.${err.code}`, userMessage: msg };
  }
  if (err instanceof SubsonicError) {
    if (err.auth)
      return {
        code: 'navidrome.auth',
        userMessage: 'Navidrome rejected the username or password.',
      };
    if (err.status === 0)
      return {
        code: 'navidrome.unreachable',
        userMessage: 'The Navidrome server could not be reached.',
      };
    if (err.message === 'not a Subsonic server' || err.status === 404)
      return {
        code: 'navidrome.not_subsonic',
        userMessage: 'That address does not answer like a Navidrome server.',
      };
    return { code: 'navidrome.failed', userMessage: `Navidrome answered: ${err.message}` };
  }
  return { code: 'navidrome.failed', userMessage: 'Something went wrong talking to Navidrome.' };
}

/** The user's Navidrome URL (the palette cache's scope), or 'none'. */
export function navidromeUrlOf(db: Db, userId: number) {
  const row = db
    .prepare("SELECT config_json FROM connections WHERE user_id = ? AND provider = 'navidrome'")
    .get(userId) as { config_json: string } | undefined;
  return row ? (JSON.parse(row.config_json) as Stored).url.replace(/\/+$/, '') : 'none';
}

/**
 * A cover's bytes from the user's own Navidrome, for palette extraction (VISUALIZER_SPEC.md §6.1);
 * null when the user has no connection or the answer is not a raster image.
 */
/**
 * A signed client for the user's own Navidrome (the URL re-checked and its address pinned), or
 * null when the user has no connection. For server-side lookups: covers, lyrics.
 */
export async function navidromeClientFor(
  deps: NavidromeDeps,
  userId: number,
): Promise<SubsonicClient | null> {
  const row = deps.db
    .prepare(
      "SELECT config_json, secret_enc FROM connections WHERE user_id = ? AND provider = 'navidrome'",
    )
    .get(userId) as { config_json: string; secret_enc: string } | undefined;
  if (!row) return null;
  const cfg = JSON.parse(row.config_json) as Stored;
  const secret = deps.sealer.tryOpen(row.secret_enc, {
    table: 'connections',
    rowId: `${userId}|navidrome`,
    column: 'secret_enc',
  });
  if (secret === null) return null; // sealed with another master key: needs re-entry
  const creds: Credentials =
    cfg.auth === 'apiKey' ? { apiKey: secret } : { username: cfg.username, password: secret };
  const allow = deps.db
    .prepare("SELECT value_json FROM server_settings WHERE key = 'navidrome.allowList'")
    .get() as { value_json: string } | undefined;
  const target = await checkUrl(cfg.url, {
    defaultUrl: deps.defaultUrl,
    allowList: allow ? (JSON.parse(allow.value_json) as string[]) : [],
    resolve: deps.resolve,
  });
  return createClient(target, creds);
}

export function navidromeCovers(deps: NavidromeDeps) {
  return async (userId: number, coverId: string, size = 256): Promise<Buffer | null> => {
    try {
      const client = await navidromeClientFor(deps, userId);
      if (!client) return null;
      const res = await client.request('getCoverArt', {
        id: coverId,
        size: String(size),
      });
      if (
        res.statusCode !== 200 ||
        !RASTER.test(
          String(res.headers['content-type'] ?? '')
            .split(';')[0]
            ?.trim() ?? '',
        )
      ) {
        res.resume();
        return null;
      }
      const chunks: Buffer[] = [];
      let n = 0;
      for await (const c of res) {
        n += (c as Buffer).length;
        if (n > 8 * 1024 * 1024) {
          res.destroy();
          return null;
        }
        chunks.push(c as Buffer);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  };
}

export function navidromeRoutes(deps: NavidromeDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const { db, sealer, now } = deps;
  const app = new Hono<AuthEnv>();
  const where = (userId: number) => ({
    table: 'connections',
    rowId: `${userId}|navidrome`,
    column: 'secret_enc',
  });
  const allowList = () => {
    const row = db
      .prepare("SELECT value_json FROM server_settings WHERE key = 'navidrome.allowList'")
      .get() as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as string[]) : [];
  };
  const clientFor = async (url: string, creds: Credentials) =>
    createClient(
      await checkUrl(url, {
        defaultUrl: deps.defaultUrl,
        allowList: allowList(),
        resolve: deps.resolve,
      }),
      creds,
    );

  function stored(userId: number): { cfg: Stored; creds: Credentials } | null {
    const row = db
      .prepare(
        "SELECT config_json, secret_enc FROM connections WHERE user_id = ? AND provider = 'navidrome'",
      )
      .get(userId) as { config_json: string; secret_enc: string } | undefined;
    if (!row) return null;
    const cfg = JSON.parse(row.config_json) as Stored;
    const secret = sealer.tryOpen(row.secret_enc, where(userId));
    if (secret === null) return null; // sealed with another master key: needs re-entry
    return {
      cfg,
      creds:
        cfg.auth === 'apiKey' ? { apiKey: secret } : { username: cfg.username, password: secret },
    };
  }

  /** §5.3: ping, capabilities, track count. */
  async function test(client: SubsonicClient) {
    const ping = await client.call('ping');
    const ext = await client
      .call('getOpenSubsonicExtensions')
      .catch(() => ({}) as Record<string, unknown>);
    const scan = await client.call('getScanStatus').catch(() => ({}) as Record<string, unknown>);
    const extensions = ((ext.openSubsonicExtensions as { name: string }[] | undefined) ?? []).map(
      (e) => e.name,
    );
    return {
      type: String(ping.type ?? 'subsonic'),
      serverVersion: String(ping.serverVersion ?? ping.version ?? ''),
      tracks: Number((scan.scanStatus as { count?: number } | undefined)?.count ?? 0),
      extensions,
    };
  }

  async function input(c: Context) {
    const b = await body(c);
    const s = (k: string, max = 512) =>
      typeof b[k] === 'string' && (b[k] as string).length <= max ? (b[k] as string) : '';
    return {
      url: s('url') || deps.defaultUrl || '',
      username: s('username', 128).trim(),
      password: s('password', 1024),
      apiKey: s('apiKey', 1024),
    };
  }

  const user = (c: Context) => (c as Context<AuthEnv>).var.user;

  // ---- the connection ----

  app.get('/me/connections/navidrome', requireUser, (c) => {
    const row = db
      .prepare(
        "SELECT config_json, status, updated_at FROM connections WHERE user_id = ? AND provider = 'navidrome'",
      )
      .get(user(c).id) as { config_json: string; status: string; updated_at: number } | undefined;
    if (!row) return c.json({ connected: false, defaultUrl: deps.defaultUrl });
    const { url, username, auth, serverVersion, extensions } = JSON.parse(
      row.config_json,
    ) as Stored;
    // Restored without the master key: the saved secret is unreadable, so ask for it again.
    if (!stored(user(c).id))
      return c.json({
        connected: false,
        needsReentry: true,
        url,
        username,
        defaultUrl: deps.defaultUrl,
      });
    // The secret is write-only: only that one is saved, never what it is.
    return c.json({
      connected: true,
      url,
      username,
      auth,
      serverVersion,
      extensions,
      status: row.status,
      secretSaved: true,
    });
  });

  app.put('/me/connections/navidrome', requireUser, async (c) => {
    const u = user(c);
    const i = await input(c);
    if (!i.username && !i.apiKey)
      return c.json({ code: 'navidrome.input', userMessage: 'Enter a username.' }, 400);
    if (!i.password && !i.apiKey)
      return c.json(
        { code: 'navidrome.input', userMessage: 'Enter a password or an API key.' },
        400,
      );
    const creds: Credentials = i.apiKey
      ? { apiKey: i.apiKey }
      : { username: i.username, password: i.password };
    let info: Awaited<ReturnType<typeof test>>;
    try {
      info = await test(await clientFor(i.url, creds));
    } catch (err) {
      audit(db, now(), u.id, 'navidrome.connect_failed', { code: problemOf(err).code });
      return c.json(problemOf(err), 400); // nothing stored
    }
    const cfg: Stored = {
      url: i.url,
      username: i.username,
      auth: i.apiKey ? 'apiKey' : 'password',
      serverVersion: info.serverVersion,
      extensions: info.extensions,
    };
    db.prepare(
      `INSERT INTO connections (user_id, provider, config_json, secret_enc, status, updated_at)
       VALUES (?, 'navidrome', ?, ?, 'ok', ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET config_json = excluded.config_json,
         secret_enc = excluded.secret_enc, status = 'ok', updated_at = excluded.updated_at`,
    ).run(u.id, JSON.stringify(cfg), sealer.seal(i.apiKey || i.password, where(u.id)), now());
    audit(db, now(), u.id, 'navidrome.connected', { url: i.url, auth: cfg.auth });
    return c.json({ serverInfo: info });
  });

  app.post('/me/connections/navidrome/test', requireUser, async (c) => {
    const s = stored(user(c).id);
    if (!s)
      return c.json(
        { code: 'navidrome.not_connected', userMessage: 'Navidrome is not connected.' },
        404,
      );
    try {
      return c.json({ serverInfo: await test(await clientFor(s.cfg.url, s.creds)) });
    } catch (err) {
      return c.json(problemOf(err), 400);
    }
  });

  app.delete('/me/connections/navidrome', requireUser, (c) => {
    const u = user(c);
    db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'navidrome'").run(u.id);
    audit(db, now(), u.id, 'navidrome.disconnected');
    return c.json({ ok: true });
  });

  // ---- the proxy ----

  async function forward(c: Context, method: string): Promise<Response> {
    const s = stored(user(c).id);
    if (!s) return c.json({ code: 'navidrome.not_connected' }, 409);
    try {
      const client = await clientFor(s.cfg.url, s.creds);
      return c.json({ 'subsonic-response': await client.call(method, c.req.query()) });
    } catch (err) {
      if (err instanceof SubsonicError && err.status === 200 && !err.auth && err.code !== null)
        return c.json({
          'subsonic-response': {
            status: 'failed',
            error: { code: err.code, message: err.message },
          },
        });
      return c.json(problemOf(err), 502);
    }
  }

  app.get('/navidrome/rest/:method', requireUser, async (c) => {
    const m = c.req.param('method');
    return READ.has(m) ? await forward(c, m) : c.json({ error: 'method_not_allowed' }, 403);
  });
  app.post('/navidrome/rest/:method', requireUser, async (c) => {
    const m = c.req.param('method');
    return WRITE.has(m) ? await forward(c, m) : c.json({ error: 'method_not_allowed' }, 403);
  });

  /** Upstream bytes as they come: no buffering, Range and its headers passed through. */
  async function pipe(
    c: Context,
    u: { id: number },
    method: string,
    params: Record<string, string>,
    extra: Record<string, string>,
    safe: RegExp,
  ): Promise<Response> {
    const s = stored(u.id);
    if (!s) return c.json({ code: 'navidrome.not_connected' }, 409);
    try {
      const client = await clientFor(s.cfg.url, s.creds);
      const range = c.req.header('range');
      const res = await client.request(method, params, range ? { range } : {});
      const status = res.statusCode ?? 502;
      const type = String(res.headers['content-type'] ?? '');
      // An error arrives as JSON with status 200; never pass that off as media.
      if (status >= 400 || type.includes('json')) {
        res.resume();
        return c.json({ code: 'navidrome.stream_failed' }, 502);
      }
      const headers = new Headers(extra);
      for (const h of STREAM_HEADERS) {
        const v = res.headers[h];
        if (typeof v === 'string') headers.set(h, v);
      }
      // The upstream server decides the bytes, not what our origin serves them as: only media
      // types pass (no HTML, no SVG), and the response is sandboxed in case it is opened directly.
      headers.set(
        'content-type',
        safe.test(type.split(';')[0]?.trim() ?? '') ? type : 'application/octet-stream',
      );
      headers.set('content-security-policy', "sandbox; default-src 'none'");
      return new Response(Readable.toWeb(res) as ReadableStream, { status, headers });
    } catch (err) {
      return c.json(problemOf(err), 502);
    }
  }

  // Bound to the account (its id and creation time), not the id alone: ids are reused after a delete.
  const sign = (u: { id: number; created_at: number }, id: string, exp: number) =>
    createHmac('sha256', deps.streamKey)
      .update(`${u.id}|${u.created_at}|${id}|${exp}`)
      .digest('base64url');
  const account = (uid: number) =>
    db
      .prepare('SELECT id, username, role, created_at FROM users WHERE id = ? AND disabled = 0')
      .get(uid) as
      | (Pick<SessionUser, 'id' | 'username' | 'role'> & { created_at: number })
      | undefined;

  /** The session user, or the user a valid signed URL is bound to (§6.5). */
  const streamUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const { uid, exp, sig } = c.req.query();
    if (!sig) return requireUser(c, next);
    const id = c.req.param('id') ?? '';
    const e = Number(exp);
    const row = account(Number(uid));
    if (!row) return c.json({ error: 'unauthenticated' }, 401);
    const want = Buffer.from(sign(row, id, e));
    const got = Buffer.from(sig);
    const t = now();
    if (
      !(e > t && e <= t + SIGNED_TTL_MS) ||
      want.length !== got.length ||
      !timingSafeEqual(want, got)
    )
      return c.json({ error: 'unauthenticated' }, 401);
    const { created_at: _, ...who } = row;
    c.set('user', { ...who, sessionHash: '', kind: 'device', totpEnabled: true });
    await next();
  };

  app.get('/navidrome/stream/:id', streamUser, (c) => {
    const q = c.req.query();
    const params: Record<string, string> = { id: c.req.param('id') };
    for (const k of STREAM_PARAMS) if (q[k]) params[k] = q[k];
    return pipe(c, user(c), 'stream', params, { 'cache-control': 'private, no-store' }, AUDIO);
  });

  /** A stream URL for a client that can neither send a cookie nor a header: 6 h, one track. */
  app.get('/navidrome/stream-url/:id', requireUser, (c) => {
    const id = c.req.param('id');
    const exp = now() + SIGNED_TTL_MS;
    const u = user(c).id;
    // Signed only for a user with a Navidrome: the URL plays from their own server.
    const acc = account(u);
    if (!stored(u) || !acc) return c.json({ code: 'navidrome.not_connected' }, 409);
    return c.json({
      url: `/api/v1/navidrome/stream/${encodeURIComponent(id)}?uid=${u}&exp=${exp}&sig=${sign(acc, id, exp)}`,
      expiresAt: exp,
    });
  });

  app.get('/navidrome/cover/:id', requireUser, (c) => {
    const size = Math.min(2048, Math.max(16, Number(c.req.query('size') ?? 600) || 600));
    return pipe(
      c,
      user(c),
      'getCoverArt',
      { id: c.req.param('id'), size: String(size) },
      { 'cache-control': 'private, max-age=604800' },
      RASTER,
    );
  });

  return app;
}
