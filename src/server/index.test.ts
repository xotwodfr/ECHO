import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './index.ts';
import { fixtureCover, libraryCover } from './palette/covers.ts';
import { fallbackPalette } from './palette/extract.ts';
import { createPaletteService } from './palette/service.ts';
import { testDeps } from './testing.ts';

const base = testDeps().deps;
const app = createApp({
  ...base,
  palette: createPaletteService({ dir: '/nonexistent', load: async () => null }),
});

describe('GET /api/v1/health', () => {
  it('answers ok without authentication and is not cached', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('exposes nothing else under /api', async () => {
    const res = await app.request('/api/v1/anything');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /api/v1/palette/:albumKey (VISUALIZER_SPEC.md §6.3)', () => {
  async function withCache() {
    const dir = await mkdtemp(join(tmpdir(), 'echo-palette-'));
    let loads = 0;
    const palette = createPaletteService({
      dir,
      load: async (key) => {
        loads++;
        return key.startsWith('fixture:') ? fixtureCover(key.slice(8)) : null;
      },
    });
    return { dir, app: createApp({ ...base, palette }), loads: () => loads };
  }

  // ON-DB-2: a cache that cannot be written (a full disk) still answers with the palette.
  it('a cache write that fails still answers with the computed palette', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'echo-palette-'));
    await writeFile(join(dir, 'file'), '');
    const palette = createPaletteService({
      dir: join(dir, 'file', 'cache'), // under a file: mkdir fails (ENOTDIR)
      load: async (key) => fixtureCover(key.slice(8)),
    });
    const res = await createApp({ ...base, palette }).request('/api/v1/palette/fixture:night-sun');
    expect(res.status).toBe(200);
    expect(await res.json()).not.toEqual(fallbackPalette());
  });

  it('computes on a miss, caches to a file, and serves the file afterwards', async () => {
    const t = await withCache();
    const first = await (await t.app.request('/api/v1/palette/fixture:night-sun')).json();
    expect(first.source).toBe('art');
    expect(await readdir(t.dir)).toHaveLength(1);
    const again = await (await t.app.request('/api/v1/palette/fixture:night-sun')).json();
    expect(again).toEqual(first);
    expect(t.loads()).toBe(1);
  });

  it('a palette cached by an older algorithm version is recomputed', async () => {
    const t = await withCache();
    await t.app.request('/api/v1/palette/fixture:fire');
    const [name] = await readdir(t.dir);
    const path = join(t.dir, name as string);
    const old = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...old, accent: 'oklch(0.5 0 0)', version: 0 }));
    const fresh = await (await t.app.request('/api/v1/palette/fixture:fire')).json();
    expect(fresh.version).toBe(1);
    expect(fresh.accent).toBe(old.accent);
    expect(t.loads()).toBe(2);
  });

  it('concurrent requests for one key share one computation', async () => {
    const t = await withCache();
    const all = await Promise.all(
      Array.from({ length: 5 }, () => t.app.request('/api/v1/palette/fixture:dusk')),
    );
    expect(new Set(await Promise.all(all.map((r) => r.text()))).size).toBe(1);
    expect(t.loads()).toBe(1);
  });

  it('development: the fixture library’s SVG covers give their palettes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'echo-palette-'));
    const lib = createApp({ ...base, palette: createPaletteService({ dir, load: libraryCover }) });
    // Paper Satellites (black and cream) and Long Exposure (greys) are achromatic: the fallback
    // (§6.2 step 7).
    for (const [id, source] of [
      ['al-harbour', 'art'],
      ['al-paper', 'fallback'],
      ['al-glass', 'art'],
      ['al-exposure', 'fallback'],
      ['al-signal', 'art'],
    ]) {
      const p = await (await lib.request(`/api/v1/palette/navidrome:${id}`)).json();
      expect(p.source, id).toBe(source);
    }
  });

  it('an unknown cover gets the fallback, uncached; a bad key is rejected', async () => {
    const t = await withCache();
    const res = await t.app.request('/api/v1/palette/navidrome:al-1');
    expect(await res.json()).toEqual(fallbackPalette());
    expect(await readdir(t.dir).catch(() => [])).toHaveLength(0);
    expect((await t.app.request('/api/v1/palette/..%2Fetc')).status).toBe(400);
    expect((await t.app.request('/api/v1/palette/a%20b')).status).toBe(400);
  });
});

describe('deep-link fallback', () => {
  // Positive case (an extension-less path serves index.html) needs a built client: tests/e2e/shell.
  it('never answers a missing file with the client', async () => {
    expect((await app.request('/not-built.html')).status).toBe(404);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });
});

describe('gate G1 (SP-03, SP-04): palettes from Spotify cover art', () => {
  async function spotify() {
    const dir = await mkdtemp(join(tmpdir(), 'echo-palette-'));
    const arts: string[] = [];
    const t = testDeps();
    const palette = createPaletteService({
      dir,
      load: async (_key, ctx) => {
        arts.push(ctx.art ?? '');
        return fixtureCover('night-sun');
      },
    });
    const app = createApp({ ...t.deps, palette });
    const db = t.deps.auth.db;
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
        )
        .run().lastInsertRowid,
    );
    const { createSession } = await import('./auth/sessions.ts');
    const { call } = await import('./testing.ts');
    const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
    const get = (art: string) =>
      call(
        app,
        'GET',
        `/api/v1/palette/spotify:album:abc?art=${encodeURIComponent(art)}`,
        undefined,
        cookie,
      );
    return { db, dir, arts, get, app };
  }

  it('on: the i.scdn.co cover is fetched into memory; only the palette is cached', async () => {
    const s = await spotify();
    const p = await (await s.get('https://i.scdn.co/image/ab67616d0000b273')).json();
    expect(p.source).toBe('art');
    expect(s.arts).toEqual(['https://i.scdn.co/image/ab67616d0000b273']);
    const files = await readdir(s.dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(join(s.dir, files[0] as string), 'utf8'))).toHaveProperty(
      'room',
    );
  });

  it('only https://i.scdn.co, and another image never repaints the album for others', async () => {
    const s = await spotify();
    for (const bad of [
      'http://i.scdn.co/image/x',
      'https://evil.example/image/x',
      'https://i.scdn.co:444/image/x',
      'https://user@i.scdn.co/image/x',
      'not a url',
    ])
      expect((await s.get(bad)).status).toBe(400);
    await s.get('https://i.scdn.co/image/one');
    await s.get('https://i.scdn.co/image/two');
    expect(await readdir(s.dir)).toHaveLength(2);
  });

  it('off: the fallback palette at once, nothing fetched, not cached', async () => {
    const s = await spotify();
    s.db
      .prepare(
        "INSERT INTO server_settings (key, value_json) VALUES ('spotify.gates.artPalette', 'false')",
      )
      .run();
    const res = await s.get('https://i.scdn.co/image/one');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).source).toBe('fallback');
    expect(s.arts).toEqual([]);
  });

  it('Spotify palettes expire after 30 days', async () => {
    const s = await spotify();
    await s.get('https://i.scdn.co/image/one');
    const { utimes } = await import('node:fs/promises');
    const [f] = await readdir(s.dir);
    const old = new Date(Date.now() - 31 * 86_400_000);
    await utimes(join(s.dir, f as string), old, old);
    await s.get('https://i.scdn.co/image/one');
    expect(s.arts).toHaveLength(2);
  });
});

describe('POST /api/v1/csp-report (SEC-08)', () => {
  it('logs and records a browser report without a session or Origin; 10 a minute per address', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const file = join(mkdtempSync(join(tmpdir(), 'echo-csp-')), 'r.jsonl');
    const lines: string[] = [];
    const t = testDeps();
    const app = createApp({
      ...t.deps,
      cspReportFile: file,
      log: (_l, msg, extra) => lines.push(`${msg} ${JSON.stringify(extra)}`),
    });
    const report = {
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example/x.js',
      },
    };
    const post = () =>
      app.request('http://localhost/api/v1/csp-report', {
        method: 'POST',
        headers: { host: 'localhost', 'content-type': 'application/csp-report' },
        body: JSON.stringify(report),
      });
    expect((await post()).status).toBe(204);
    expect(readFileSync(file, 'utf8')).toContain('evil.example');
    expect(lines[0]).toContain('csp violation');
    for (let i = 0; i < 20; i++) await post();
    // One address: 10 a minute; the rest are dropped and counted when the minute rolls over.
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(10);
    // The policy points browsers at it.
    const res = await app.request('http://localhost/api/v1/health', {
      headers: { host: 'localhost' },
    });
    expect(res.headers.get('content-security-policy')).toContain('report-uri /api/v1/csp-report');
  });
});
