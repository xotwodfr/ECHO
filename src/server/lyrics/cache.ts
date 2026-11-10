import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { LyricsDoc } from '../../shared/types.ts';
import type { Tried } from './resolve.ts';

// The shared lyric cache (LYRICS_INTEGRATION.md §7): one JSON file per track key (sha1) under
// /data/cache/lyrics, shared by the server's users. Spicy docs live 30 days, hard (deleted, never
// served stale: Spicy terms §7), LRCLIB 30 days, Navidrome 1 day (the user may edit their files),
// NetEase 1 day (unofficial API, terms unconfirmed: kept short until the owner decides), and a
// negative entry 3 days. A sweep at start and every 24 h deletes what has expired and trims
// the cache to 200 MB, least recently read first (reads touch the file).

const DAY = 86_400_000;
export const TTL: Record<LyricsDoc['source'] | 'negative', number> = {
  spicy: 30 * DAY,
  lrclib: 30 * DAY,
  netease: DAY,
  navidrome: DAY,
  'navidrome-plain': DAY,
  fixture: DAY,
  negative: 3 * DAY,
};
export const CACHE_CAP_BYTES = 200 * 1024 * 1024;

export type Entry =
  | { doc: LyricsDoc; expiresAt: number }
  | { negative: Tried[]; expiresAt: number };

export function createLyricsCache(opts: { dir: string; now: () => number; capBytes?: number }) {
  const cap = opts.capBytes ?? CACHE_CAP_BYTES;
  const file = (key: string) =>
    join(opts.dir, `${createHash('sha1').update(key).digest('hex')}.json`);

  async function write(key: string, e: Entry) {
    await mkdir(opts.dir, { recursive: true });
    const tmp = `${file(key)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(e));
    await rename(tmp, file(key));
  }

  return {
    /** A live entry, or null; an expired one is deleted on the spot. */
    async get(key: string): Promise<Entry | null> {
      let e: Entry;
      try {
        e = JSON.parse(await readFile(file(key), 'utf8')) as Entry;
      } catch {
        return null;
      }
      if (e.expiresAt <= opts.now()) {
        await unlink(file(key)).catch(() => undefined);
        return null;
      }
      const t = new Date(opts.now());
      await utimes(file(key), t, t).catch(() => undefined); // recency, for the size cap
      return e;
    },
    put(key: string, doc: LyricsDoc) {
      return write(key, { doc, expiresAt: opts.now() + (TTL[doc.source] ?? DAY) });
    },
    /** Every source answered "not found" (errors and timeouts never cache a miss). */
    putNegative(key: string, tried: Tried[]) {
      return write(key, { negative: tried, expiresAt: opts.now() + (TTL.negative as number) });
    },
    /**
     * Deletes expired entries (and those `drop` picks: the Spicy key removed), then the least
     * recently read until the cache fits its cap.
     */
    async sweep(drop?: (e: Entry) => boolean) {
      let names: string[];
      try {
        names = (await readdir(opts.dir)).filter((n) => n.endsWith('.json'));
      } catch {
        return { deleted: 0 };
      }
      let deleted = 0;
      const kept: { path: string; size: number; at: number }[] = [];
      for (const n of names) {
        const path = join(opts.dir, n);
        try {
          const e = JSON.parse(await readFile(path, 'utf8')) as Entry;
          const s = await stat(path);
          if (e.expiresAt <= opts.now() || drop?.(e)) {
            await unlink(path);
            deleted++;
          } else kept.push({ path, size: s.size, at: s.mtimeMs });
        } catch {
          await unlink(path).catch(() => undefined); // unreadable: gone
          deleted++;
        }
      }
      let total = kept.reduce((sum, k) => sum + k.size, 0);
      for (const k of kept.sort((a, b) => a.at - b.at)) {
        if (total <= cap) break;
        await unlink(k.path).catch(() => undefined);
        total -= k.size;
        deleted++;
      }
      return { deleted };
    },
  };
}

export type LyricsCache = ReturnType<typeof createLyricsCache>;
