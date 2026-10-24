import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoginLimiter } from './auth/ratelimit.ts';
import type { AuthDeps } from './auth/routes.ts';
import { createSealer, subkey } from './crypto.ts';
import { openDb } from './db/db.ts';
import { type AppDeps, createApp } from './index.ts';
import { createLyricsCache } from './lyrics/cache.ts';
import { createResolver } from './lyrics/resolve.ts';
import { fallbackPalette } from './palette/extract.ts';
import type { PaletteService } from './palette/service.ts';

// Test wiring for the server: an in-memory database, a random master key, a settable clock and a
// fixed client address. Requests go through `app.request` with our own Host and Origin.

export function testDeps(over: Partial<AppDeps> = {}) {
  const clock = { t: 1_800_000_000_000 };
  const auth: AuthDeps = {
    db: openDb(':memory:'),
    sealer: createSealer(randomBytes(32)),
    limiter: createLoginLimiter(),
    now: () => clock.t,
    setup: { token: null, expiresAt: 0, pending: null },
  };
  const palette: PaletteService = { get: async () => fallbackPalette() };
  const deps: AppDeps = {
    palette,
    auth,
    navidrome: {
      db: auth.db,
      sealer: auth.sealer,
      now: auth.now,
      defaultUrl: null,
      streamKey: subkey(randomBytes(32), 'stream-url'),
    },
    lyrics: {
      db: auth.db,
      cache: createLyricsCache({ dir: mkdtempSync(join(tmpdir(), 'echo-lyrics-')), now: auth.now }),
      resolver: createResolver({
        clock: { now: auth.now, setTimeout, clearTimeout: (h) => clearTimeout(h as never) },
      }),
      sourcesFor: () => [],
      scopeFor: () => 'none',
    },
    http: { publicOrigin: null, trustedProxy: [] },
    devFixtures: true,
    socketAddress: () => '203.0.113.7',
    ...over,
  };
  return { deps, clock, app: createApp(deps) };
}

export type TestApp = ReturnType<typeof createApp>;

/** A request as the browser on http://localhost would send it, carrying `cookie` if given. */
export function call(app: TestApp, method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { host: 'localhost', origin: 'http://localhost' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return app.request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The session cookie a response set, as a Cookie header value. */
export const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
