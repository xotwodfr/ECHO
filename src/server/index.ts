import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { accountRoutes } from './account.ts';
import { adminRoutes, matchLibrary, spicyKey } from './admin.ts';
import { nightlyBackup } from './admin-cli.ts';
import { createLoginLimiter } from './auth/ratelimit.ts';
import { type AuthDeps, authRoutes, hasAdmin, requireUser, startSetup } from './auth/routes.ts';
import { DEVICE_BEARER, pruneSessions, resolveSession, SESSION_COOKIE } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { createSealer, loadMasterKey, subkey } from './crypto.ts';
import { openDb } from './db/db.ts';
import { BODY_LIMIT, type HttpConfig, hardening, type Vars } from './http.ts';
import { accessLog, createLogger, createSecretSet, type Log } from './log.ts';
import { createLyricsCache } from './lyrics/cache.ts';
import { createResolver } from './lyrics/resolve.ts';
import { type LyricsDeps, lyricsRoutes } from './lyrics/routes.ts';
import {
  lrclibSource,
  navidromePlainSource,
  navidromeSource,
  neteaseSource,
  spicySource,
} from './lyrics/sources.ts';
import { createSpotifyMatcher } from './lyrics/spotifyMatch.ts';
import {
  type NavidromeDeps,
  navidromeClientFor,
  navidromeCovers,
  navidromeRoutes,
  navidromeUrlOf,
} from './navidrome/routes.ts';
import { fixtureCover, libraryCover } from './palette/covers.ts';
import { createPaletteService, type PaletteService } from './palette/service.ts';
import { playsRoutes } from './plays.ts';
import { queueRoutes } from './queue.ts';
import { settingsRoutes, userSettings } from './settings.ts';
import { checkWanted, wantedRoutes, wantedScope } from './wanted.ts';

// Album keys are opaque, but never paths or markup: letters, digits and `:_.-`.
const ALBUM_KEY = /^[\w:.-]{1,200}$/;

export interface AppDeps {
  palette: PaletteService;
  auth: AuthDeps;
  navidrome: NavidromeDeps;
  lyrics: LyricsDeps;
  http: HttpConfig;
  /** Development and E2E: palettes of the generated covers without a session (ECHO_DEV_FIXTURES). */
  devFixtures?: boolean;
  /** The redacting logger (log.ts); silent when absent (tests). */
  log?: Log;
  /** E2E: CSP violation reports are also appended here, for the run's final check (SEC-08). */
  cspReportFile?: string;
  /** The TCP peer; tests stand in for the Node socket. */
  socketAddress?: (c: Context) => string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use(
    '*',
    hardening(deps.http, deps.socketAddress ?? ((c) => getConnInfo(c).remote.address ?? '')),
  );
  const log: Log = deps.log ?? (() => {});
  app.use('/api/*', accessLog(log));
  // API answers are personal (a TOTP secret, recovery codes, sessions): never stored by a browser
  // or proxy, unless the route says otherwise (covers, palettes, streams set their own).
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  });
  // Errors go through the redactor too (Hono's default prints them raw).
  app.onError((err, c) => {
    log('error', 'unhandled', { route: c.req.routePath, error: err });
    return c.json({ error: 'internal' }, 500);
  });
  app.use(
    '/api/*',
    bodyLimit({ maxSize: BODY_LIMIT, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  );

  // Liveness only: unauthenticated and minimal (docs/TECHNICAL_ARCHITECTURE.md §6.2).
  // CSP violation reports from browsers (report-uri): unauthenticated, small, and only ever
  // logged (SEC-08). Per minute: 10 per address (so one source cannot crowd out the rest), in a
  // map of at most 1000 addresses cleared every minute (bounded memory), 300 in all as a
  // backstop; what is dropped is counted and logged (security review).
  const csp = { windowStart: 0, total: 0, dropped: 0, perIp: new Map<string, number>() };
  app.post('/api/v1/csp-report', async (c) => {
    const t = Date.now();
    if (t - csp.windowStart >= 60_000) {
      if (csp.dropped) log('warn', 'csp reports dropped', { count: csp.dropped });
      Object.assign(csp, { windowStart: t, total: 0, dropped: 0 });
      csp.perIp.clear();
    }
    const mine = csp.perIp.get(c.var.ip) ?? 0;
    const room = csp.perIp.has(c.var.ip) || csp.perIp.size < 1000;
    if (!room || mine >= 10 || csp.total >= 300) {
      csp.dropped++;
      return c.body(null, 204);
    }
    csp.perIp.set(c.var.ip, mine + 1);
    csp.total++;
    const text = (await c.req.text()).slice(0, 8192);
    let report: unknown = text;
    try {
      report = (JSON.parse(text) as { 'csp-report'?: unknown })['csp-report'] ?? JSON.parse(text);
    } catch {}
    log('warn', 'csp violation', { report });
    if (deps.cspReportFile) appendFileSync(deps.cspReportFile, `${JSON.stringify(report)}\n`);
    return c.body(null, 204);
  });

  app.get('/api/v1/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  // The album's palette (VISUALIZER_SPEC.md §6.3), computed on a miss, for a session or a device
  // token (the Android client, SETTINGS_AND_SECURITY.md §4.6) like every signed-in route.
  app.get('/api/v1/palette/:albumKey', async (c) => {
    const key = c.req.param('albumKey');
    if (!ALBUM_KEY.test(key)) return c.json({ error: 'bad_album_key' }, 400);
    const bearer = c.req.header('authorization')?.match(DEVICE_BEARER)?.[1];
    const token = bearer ?? getCookie(c, SESSION_COOKIE);
    const user = token ? resolveSession(deps.auth.db, token, deps.auth.now()) : null;
    // Signed in, or a development server answering for its generated covers (E2E).
    if (!user && !deps.devFixtures) return c.json({ error: 'unauthenticated' }, 401);
    // A Navidrome album id means something only on its own server: scope it to the user's.
    const scope = key.startsWith('navidrome:')
      ? user
        ? navidromeUrlOf(deps.auth.db, user.id)
        : 'none'
      : null;
    c.header('Cache-Control', 'private, max-age=3600');
    return c.json(await deps.palette.get(key, { userId: user?.id ?? null, scope }));
  });

  app.route('/api/v1', authRoutes(deps.auth));
  app.route('/api/v1', navidromeRoutes(deps.navidrome, requireUser(deps.auth)));
  app.route('/api/v1', queueRoutes(deps.auth, requireUser(deps.auth)));
  app.route('/api/v1', adminRoutes(deps.auth, requireUser(deps.auth)));
  app.route('/api/v1', lyricsRoutes(deps.lyrics, requireUser(deps.auth)));
  app.route('/api/v1', settingsRoutes(deps.auth.db, requireUser(deps.auth)));
  app.route('/api/v1', accountRoutes(deps.auth, requireUser(deps.auth)));
  app.route(
    '/api/v1',
    playsRoutes(
      {
        db: deps.auth.db,
        now: deps.auth.now,
        navidrome: (id) => navidromeClientFor(deps.navidrome, id),
      },
      requireUser(deps.auth),
    ),
  );
  app.route(
    '/api/v1',
    wantedRoutes(
      {
        db: deps.auth.db,
        now: deps.auth.now,
        navidrome: (id) => navidromeClientFor(deps.navidrome, id),
        defaultUrl: () => deps.navidrome.defaultUrl,
      },
      requireUser(deps.auth),
    ),
  );
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // The built web client (vite build → dist/client), relative to the working directory.
  app.use('*', serveStatic({ root: './dist/client' }));
  // Deep links (`/library/album/…`) load the client, which reads the view from the URL. Only
  // extension-less paths fall back, so a missing file stays 404.
  app.get('*', async (c, next) => {
    if (c.req.path.split('/').pop()?.includes('.')) return next();
    // The setup page exists only while there is no admin (SETTINGS_AND_SECURITY.md §4.1).
    if (c.req.path === '/setup' && hasAdmin(deps.auth.db)) return next();
    return serveStatic({ path: './dist/client/index.html' })(c, next);
  });
  return app;
}

if (import.meta.main) {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    createLogger('error')('error', 'invalid configuration', { detail: (err as Error).message });
    process.exit(1);
  }
  // Every secret the server decrypts is remembered, so the logger masks it word for word (§9).
  const secrets = createSecretSet();
  const log = createLogger(config.logLevel, { secrets: secrets.values });
  let master: Buffer;
  try {
    master = loadMasterKey(config.masterKeyFile);
  } catch (err) {
    log('error', 'refusing to start', { detail: (err as Error).message });
    process.exit(1);
  }
  const auth: AuthDeps = {
    db: openDb(join(config.dataDir, 'echo.db')),
    sealer: createSealer(master, { remember: (p) => secrets.add(p) }),
    limiter: createLoginLimiter(),
    now: Date.now,
    setup: { token: null, expiresAt: 0, pending: null },
  };
  const setupToken = startSetup(auth);
  if (setupToken)
    log('warn', 'no admin yet: open the setup URL within 30 minutes', {
      url: `${config.publicOrigin ?? `http://localhost:${config.port}`}/setup#${setupToken}`,
    });
  const navidrome: NavidromeDeps = {
    db: auth.db,
    sealer: auth.sealer,
    now: Date.now,
    defaultUrl: config.navidromeUrl,
    streamKey: subkey(master, 'stream-url'),
  };
  const cover = navidromeCovers(navidrome);
  const palette = createPaletteService({
    dir: join(config.dataDir, 'cache', 'palette'),
    // The user's own Navidrome; generated covers for fixtures and, in development, the fixture
    // library's drawings.
    load: async (key, ctx) => {
      const { userId } = ctx;
      if (key.startsWith('fixture:')) return fixtureCover(key.slice(8));
      const fromNavidrome =
        userId !== null && key.startsWith('navidrome:') ? await cover(userId, key.slice(10)) : null;
      return fromNavidrome ?? (config.devFixtures ? libraryCover(key) : null);
    },
  });
  const lyricsCache = createLyricsCache({
    dir: join(config.dataDir, 'cache', 'lyrics'),
    now: Date.now,
  });
  // The daily sweep: expired entries out (Spicy's 30 days are hard), the cache under 200 MB.
  const sweep = () =>
    void lyricsCache.sweep().then(
      (r) => r.deleted && log('info', 'lyrics cache swept', r),
      (err: unknown) => log('warn', 'lyrics cache sweep failed', { detail: String(err) }),
    );
  sweep();
  setInterval(sweep, 86_400_000).unref();
  // The daily database backup (admin-cli.ts nightlyBackup): checked hourly, written once a day.
  const backupDaily = () => {
    try {
      const r = nightlyBackup(auth.db, join(config.dataDir, 'backups'));
      if (r.made) log('info', 'database backed up', { file: r.made, pruned: r.pruned.length });
    } catch (err) {
      log('warn', 'database backup failed', { detail: String(err) });
    }
  };
  setTimeout(backupDaily, 300_000).unref();
  setInterval(backupDaily, 3_600_000).unref();
  // Hourly: sessions that can no longer sign in, and login-limiter addresses quiet for a day.
  setInterval(() => {
    const sessions = pruneSessions(auth.db, Date.now());
    const addresses = auth.limiter.sweep(Date.now());
    if (sessions || addresses) log('info', 'pruned', { sessions, addresses });
  }, 3_600_000).unref();
  const userAgent = 'ECHO/0.1 (+https://github.com/folkes/echo)';
  // Each Navidrome server once, through the first user connected to it (admins first).
  const libraries = async () => {
    const users = auth.db
      .prepare(
        `SELECT c.user_id FROM connections c JOIN users u ON u.id = c.user_id
         WHERE c.provider = 'navidrome' AND c.status = 'ok' AND u.disabled = 0
         ORDER BY u.role = 'admin' DESC, u.id`,
      )
      .pluck()
      .all() as number[];
    const seen = new Set<string>();
    const out = [];
    for (const id of users) {
      const scope = navidromeUrlOf(auth.db, id);
      if (seen.has(scope)) continue;
      const client = await navidromeClientFor(navidrome, id).catch(() => null);
      if (!client) continue;
      seen.add(scope);
      out.push({ scope, client });
    }
    return out;
  };
  const matcher = createSpotifyMatcher({
    db: auth.db,
    now: Date.now,
    log,
    listenbrainzUrl: config.listenbrainzUrl,
    musicbrainzUrl: config.musicbrainzUrl,
    userAgent,
    sweepEnabled: () => matchLibrary(auth.db),
    libraries,
  });
  // The library sweep: a minute after start (let the server settle), then daily.
  setTimeout(() => void matcher.sweep(), 60_000).unref();
  setInterval(() => void matcher.sweep(), 86_400_000).unref();
  // The Wanted list: what is still missing is looked for daily too, not only when the list is opened.
  const checkWantedDaily = async () => {
    const scope = wantedScope(auth.db, navidrome.defaultUrl); // the server's own library only
    for (const lib of await libraries().catch(() => []))
      if (lib.scope === scope) await checkWanted(auth.db, lib.client, Date.now());
  };
  setTimeout(() => void checkWantedDaily(), 90_000).unref();
  setInterval(() => void checkWantedDaily(), 86_400_000).unref();
  const lyrics: LyricsDeps = {
    db: auth.db,
    log,
    cache: lyricsCache,
    resolver: createResolver(),
    scopeFor: (userId) => navidromeUrlOf(auth.db, userId),
    spotifyIdsFor: (userId, scope, navidromeId) =>
      matcher.idsFor(scope, navidromeId, () => navidromeClientFor(navidrome, userId)),
    matcher,
    sourcesFor: (userId) => {
      const client = () => navidromeClientFor(navidrome, userId);
      const off: string[] = userSettings(auth.db, userId).lyrics.disabledSources;
      return [
        navidromeSource(client),
        spicySource({ baseUrl: config.spicyUrl, key: () => spicyKey(auth.db, auth.sealer) }),
        neteaseSource({ baseUrl: config.neteaseUrl }),
        lrclibSource({ baseUrl: config.lrclibUrl, userAgent }),
        navidromePlainSource(client),
      ].filter((s) => !off.includes(s.id)); // Settings → Lyrics → Sources
    },
  };
  const app = createApp({
    palette,
    auth,
    navidrome,
    lyrics,
    devFixtures: config.devFixtures,
    log,
    ...(process.env.ECHO_CSP_REPORT_FILE && { cspReportFile: process.env.ECHO_CSP_REPORT_FILE }),
    http: { publicOrigin: config.publicOrigin, trustedProxy: config.trustedProxy },
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) =>
    log('info', 'listening', { port: info.port, publicOrigin: config.publicOrigin }),
  );
  // Without it the Host, https and HSTS checks are off, as they must be in development only.
  if (!config.publicOrigin)
    log(
      'warn',
      'ECHO_PUBLIC_ORIGIN is not set: Host, https and HSTS checks are off (development only)',
    );
  // Node as PID 1 ignores SIGTERM by default; close cleanly so `docker stop` is fast. An audio
  // stream would hold `close()` open past Docker's 10 s grace (then SIGKILL): requests still open
  // after 5 s are cut, and the database is closed before exiting.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log('info', 'shutting down', { signal });
      server.close(() => {
        auth.db.close();
        process.exit(0);
      });
      if ('closeAllConnections' in server)
        setTimeout(() => server.closeAllConnections(), 5000).unref();
    });
  }
}
