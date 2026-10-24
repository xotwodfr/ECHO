import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './index.ts';
import { fixtureCover, libraryCover } from './palette/covers.ts';
import { fallbackPalette } from './palette/extract.ts';
import { createPaletteService } from './palette/service.ts';

const app = createApp({
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
    return { dir, app: createApp({ palette }), loads: () => loads };
  }

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
    const lib = createApp({ palette: createPaletteService({ dir, load: libraryCover }) });
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
