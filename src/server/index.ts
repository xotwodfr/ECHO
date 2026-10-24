import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createLoginLimiter } from './auth/ratelimit.ts';
import { type AuthDeps, authRoutes, hasAdmin, startSetup } from './auth/routes.ts';
import { LOG_LEVELS, type LogLevel, loadConfig } from './config.ts';
import { createSealer, loadMasterKey } from './crypto.ts';
import { openDb } from './db/db.ts';
import { BODY_LIMIT, type HttpConfig, hardening, type Vars } from './http.ts';
import { fixtureCover, libraryCover } from './palette/covers.ts';
import { createPaletteService, type PaletteService } from './palette/service.ts';

// Album keys are opaque, but never paths or markup: letters, digits and `:_.-`.
const ALBUM_KEY = /^[\w:.-]{1,200}$/;

export interface AppDeps {
  palette: PaletteService;
  auth: AuthDeps;
  http: HttpConfig;
  /** The TCP peer; tests stand in for the Node socket. */
  socketAddress?: (c: Context) => string;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Vars }>();
  app.use(
    '*',
    hardening(deps.http, deps.socketAddress ?? ((c) => getConnInfo(c).remote.address ?? '')),
  );
  app.use(
    '/api/*',
    bodyLimit({ maxSize: BODY_LIMIT, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  );

  // Liveness only: unauthenticated and minimal (docs/TECHNICAL_ARCHITECTURE.md §6.2).
  app.get('/api/v1/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  // The album's palette (VISUALIZER_SPEC.md §6.3), computed on a miss. Unauthenticated until
  // accounts arrive (M5): the only covers it can load until then are the generated fixtures.
  app.get('/api/v1/palette/:albumKey', async (c) => {
    const key = c.req.param('albumKey');
    if (!ALBUM_KEY.test(key)) return c.json({ error: 'bad_album_key' }, 400);
    c.header('Cache-Control', 'private, max-age=3600');
    return c.json(await deps.palette.get(key));
  });

  app.route('/api/v1', authRoutes(deps.auth));
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // The built web client (vite build → dist/client), relative to the working directory.
  app.use('*', serveStatic({ root: './dist/client' }));
  // Deep links (`/library/album/…`) load the client, which reads the view from the URL. Only
  // extension-less paths fall back, so a missing file (or `/specimen.html` in the image) stays 404.
  app.get('*', async (c, next) => {
    if (c.req.path.split('/').pop()?.includes('.')) return next();
    // The setup page exists only while there is no admin (SETTINGS_AND_SECURITY.md §4.1).
    if (c.req.path === '/setup' && hasAdmin(deps.auth.db)) return next();
    return serveStatic({ path: './dist/client/index.html' })(c, next);
  });
  return app;
}

function logger(min: LogLevel) {
  return (level: LogLevel, msg: string, extra: Record<string, unknown> = {}) => {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(min)) return;
    console.log(JSON.stringify({ at: new Date().toISOString(), level, msg, ...extra }));
  };
}

if (import.meta.main) {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    logger('error')('error', 'invalid configuration', { detail: (err as Error).message });
    process.exit(1);
  }
  const log = logger(config.logLevel);
  let master: Buffer;
  try {
    master = loadMasterKey(config.masterKeyFile);
  } catch (err) {
    log('error', 'refusing to start', { detail: (err as Error).message });
    process.exit(1);
  }
  const auth: AuthDeps = {
    db: openDb(join(config.dataDir, 'echo.db')),
    sealer: createSealer(master),
    limiter: createLoginLimiter(),
    now: Date.now,
    setup: { token: null, expiresAt: 0, pending: null },
  };
  const setupToken = startSetup(auth);
  if (setupToken)
    log('warn', 'no admin yet: open the setup URL within 30 minutes', {
      url: `${config.publicOrigin ?? `http://localhost:${config.port}`}/setup#${setupToken}`,
    });
  const palette = createPaletteService({
    dir: join(config.dataDir, 'cache', 'palette'),
    // Navidrome covers arrive with accounts (M5).
    load: async (key) =>
      key.startsWith('fixture:') ? fixtureCover(key.slice(8)) : libraryCover(key),
  });
  const app = createApp({
    palette,
    auth,
    http: { publicOrigin: config.publicOrigin, trustedProxy: config.trustedProxy },
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) =>
    log('info', 'listening', { port: info.port, publicOrigin: config.publicOrigin }),
  );
  // Node as PID 1 ignores SIGTERM by default; close cleanly so `docker stop` is fast.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log('info', 'shutting down', { signal });
      server.close(() => process.exit(0));
    });
  }
}
