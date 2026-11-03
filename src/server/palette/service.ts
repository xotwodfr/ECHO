import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeCover } from './decode.ts';
import {
  clustersOf,
  fallbackPalette,
  PALETTE_VERSION,
  type Palette,
  paletteOf,
} from './extract.ts';

// The shared palette cache (VISUALIZER_SPEC.md §6.3): one JSON file per album key under
// /data/cache/palette, computed on a miss. Concurrent requests for a key share one computation.
// A palette from an older algorithm (`version`) counts as a miss. Covers that cannot be loaded or
// decoded get the fallback palette, which is not cached, so a later request can still succeed.

/** The requesting user, for covers that come from their own connection (null: no session). */
export interface LoadContext {
  userId: number | null;
  /**
   * Whose covers these are, for keys that are not global: the user's Navidrome URL. Entries are
   * shared only within one scope, so a user on another server cannot poison or read the palette
   * of an album id on this one. Null: a global key (generated fixtures).
   */
  scope?: string | null;
}
export type CoverLoader = (albumKey: string, ctx: LoadContext) => Promise<Buffer | null>;

export function createPaletteService(opts: { dir: string; load: CoverLoader }) {
  const inflight = new Map<string, Promise<Palette>>();
  const file = (key: string) =>
    join(opts.dir, `${createHash('sha256').update(key).digest('hex')}.json`);

  async function cached(key: string): Promise<Palette | null> {
    try {
      const p = JSON.parse(await readFile(file(key), 'utf8')) as Palette;
      return p.version === PALETTE_VERSION ? p : null;
    } catch {
      return null;
    }
  }

  async function compute(key: string, id: string, ctx: LoadContext): Promise<Palette> {
    const image = await opts.load(key, ctx);
    if (!image) return fallbackPalette();
    let palette: Palette;
    try {
      const { rgba, width, height } = await decodeCover(image);
      palette = paletteOf(clustersOf(rgba, width, height));
    } catch {
      return fallbackPalette();
    }
    // Write-then-rename, so a reader never sees half a file. Best-effort: a failed write (a full
    // disk) still answers with the palette, and the next request computes it again.
    const tmp = `${file(id)}.${process.pid}.tmp`;
    try {
      await mkdir(opts.dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(palette));
      await rename(tmp, file(id));
    } catch {
      await rm(tmp, { force: true }).catch(() => {});
    }
    return palette;
  }

  return {
    async get(key: string, ctx: LoadContext = { userId: null }): Promise<Palette> {
      const id = ctx.scope ? `${ctx.scope}|${key}` : key;
      const hit = await cached(id);
      if (hit) return hit;
      let p = inflight.get(id);
      if (!p) {
        p = compute(key, id, ctx).finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
      return p;
    },
  };
}

export type PaletteService = ReturnType<typeof createPaletteService>;
