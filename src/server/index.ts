import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { LOG_LEVELS, type LogLevel, loadConfig } from './config.ts';
import { fixtureCover, libraryCover } from './palette/covers.ts';
import { createPaletteService, type PaletteService } from './palette/service.ts';

// Album keys are opaque, but never paths or markup: letters, digits and `:_.-`.
const ALBUM_KEY = /^[\w:.-]{1,200}$/;

export function createApp(deps: { palette: PaletteService }) {
  const app = new Hono();

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

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // The built web client (vite build → dist/client), relative to the working directory.
  app.use('*', serveStatic({ root: './dist/client' }));
  // Deep links (`/library/album/…`) load the client, which reads the view from the URL. Only
  // extension-less paths fall back, so a missing file (or `/specimen.html` in the image) stays 404.
  app.get('*', async (c, next) => {
    if (c.req.path.split('/').pop()?.includes('.')) return next();
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
  const palette = createPaletteService({
    dir: join(config.dataDir, 'cache', 'palette'),
    // Navidrome covers arrive with accounts (M5).
    load: async (key) =>
      key.startsWith('fixture:') ? fixtureCover(key.slice(8)) : libraryCover(key),
  });
  const app = createApp({ palette });
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
