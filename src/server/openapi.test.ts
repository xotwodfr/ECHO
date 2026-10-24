import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { testDeps } from './testing.ts';

// docs/api/openapi.yaml and the server's routes stay in step (IMPLEMENTATION_PLAN.md M5 task 13):
// every /api/v1 route is documented, and nothing is documented that does not exist.

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

function documented() {
  // Parsed as YAML: a duplicated path key fails here instead of merging silently.
  const doc = parse(readFileSync('docs/api/openapi.yaml', 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const out = new Set<string>();
  for (const [path, ops] of Object.entries(doc.paths))
    for (const m of Object.keys(ops))
      if (METHODS.includes(m)) out.add(`${m.toUpperCase()} ${path}`);
  return out;
}

function served() {
  const { app } = testDeps();
  const out = new Set<string>();
  for (const r of app.routes) {
    if (!r.path.startsWith('/api/v1/') || !METHODS.includes(r.method.toLowerCase())) continue;
    out.add(`${r.method} ${r.path.slice('/api/v1'.length).replace(/:(\w+)/g, '{$1}')}`);
  }
  return out;
}

describe('the OpenAPI document', () => {
  it('lists exactly the routes the server serves', () => {
    const doc = documented();
    const real = served();
    expect(doc.size).toBeGreaterThan(20);
    expect([...real].filter((r) => !doc.has(r)).sort()).toEqual([]); // undocumented routes
    expect([...doc].filter((r) => !real.has(r)).sort()).toEqual([]); // documented, not served
  });
});

describe('the unauthenticated surface (SEC-02, SETTINGS_AND_SECURITY.md §5.5)', () => {
  // The documented list; GET /palette answers without a session only on development servers.
  const OPEN = new Set([
    'GET /health',
    'GET /session',
    'GET /setup',
    'POST /setup',
    'POST /setup/totp',
    'POST /auth/login',
    'POST /auth/totp',
    'POST /auth/device',
    'POST /csp-report',
    'GET /invite',
    'POST /invite',
    'POST /invite/totp',
    'GET /navidrome/stream/{id}', // a signed URL; without one it is 401 too (below)
  ]);

  it('every other route answers 401 without a session or device token', async () => {
    const { deps } = testDeps();
    const app = (await import('./index.ts')).createApp({ ...deps, devFixtures: false });
    const sample = (p: string) => p.replace(/\{\w+\}/g, 'x');
    let checked = 0;
    for (const route of served()) {
      const [method, path] = route.split(' ') as [string, string];
      if (OPEN.has(route) && route !== 'GET /navidrome/stream/{id}') continue;
      const res = await app.request(`http://localhost/api/v1${sample(path)}`, {
        method,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body: method === 'GET' ? undefined : '{}',
      });
      expect(res.status, route).toBe(401);
      checked++;
    }
    expect(checked).toBeGreaterThan(12);
  });
});
