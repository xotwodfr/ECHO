import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { LOG_LEVELS, type LogLevel, loadConfig } from './config.ts';

export const app = new Hono();

// Liveness only: unauthenticated and minimal (docs/TECHNICAL_ARCHITECTURE.md §6.2).
app.get('/api/v1/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'ok' });
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
