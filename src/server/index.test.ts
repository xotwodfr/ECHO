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

  // QA 2026-10-28: personal answers (a TOTP secret, recovery codes, sessions) carried no
  // Cache-Control; every API answer is no-store unless its route says otherwise.
  it('API answers are not stored, unless the route says so', async () => {
    const me = await app.request('/api/v1/me');
    expect(me.status).toBe(401);
    expect(me.headers.get('cache-control')).toBe('no-store');
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
