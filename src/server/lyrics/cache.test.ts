import { mkdtempSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LyricsDoc } from '../../shared/types.ts';
import { CACHE_CAP_BYTES, createLyricsCache } from './cache.ts';

// LI-06 and LYRICS_INTEGRATION.md §7: TTLs per source, hard Spicy expiry, negatives, sweep, cap.

const DAY = 86_400_000;
const doc = (source: LyricsDoc['source'], pad = ''): LyricsDoc => ({
  version: 1,
  trackKey: 't',
  sync: 'line',
  source,
  attribution: { text: 'x' },
  offsetMs: 0,
  lines: [{ text: `hi${pad}`, start: 1000 }],
  fetchedAt: new Date(0).toISOString(),
});

function setup(capBytes?: number) {
  const clock = { t: 1_800_000_000_000 };
  const dir = mkdtempSync(join(tmpdir(), 'echo-lcache-'));
  return { clock, dir, cache: createLyricsCache({ dir, now: () => clock.t, capBytes }) };
}

describe('the lyric cache (LI-06)', () => {
  it('Spicy entries live 30 days and are then deleted, never served stale', async () => {
    const { cache, clock, dir } = setup();
    await cache.put('a', doc('spicy'));
    clock.t += 30 * DAY - 1;
    expect(await cache.get('a')).toMatchObject({ doc: { source: 'spicy' } });
    clock.t += 1;
    expect(await cache.get('a')).toBeNull();
    expect(readdirSync(dir)).toEqual([]); // deleted on the spot
  });

  it('LRCLIB 30 days, Navidrome 1 day, a negative 3 days', async () => {
    const { cache, clock } = setup();
    await cache.put('l', doc('lrclib'));
    await cache.put('n', doc('navidrome'));
    await cache.putNegative('x', [{ source: 'lrclib', outcome: 'notFound' }]);
    clock.t += DAY;
    expect(await cache.get('n')).toBeNull();
    expect(await cache.get('x')).toMatchObject({
      negative: [{ source: 'lrclib', outcome: 'notFound' }],
    });
    clock.t += 2 * DAY;
    expect(await cache.get('x')).toBeNull();
    expect(await cache.get('l')).not.toBeNull();
    clock.t += 27 * DAY;
    expect(await cache.get('l')).toBeNull();
  });

  it('the sweep deletes expired entries and unreadable files', async () => {
    const { cache, clock, dir } = setup();
    await cache.put('s', doc('spicy'));
    await cache.put('n', doc('navidrome'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'garbage.json'), '{not json');
    clock.t += 2 * DAY;
    expect(await cache.sweep()).toEqual({ deleted: 2 });
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('over the cap, the least recently read entries go first', async () => {
    const { cache, dir, clock } = setup(3000);
    for (const k of ['a', 'b', 'c']) await cache.put(k, doc('lrclib', 'x'.repeat(1200)));
    // Make 'a' the most recently read and 'b' the oldest.
    const files = readdirSync(dir).map((n) => join(dir, n));
    for (const [i, f] of files.entries())
      utimesSync(f, new Date(clock.t - (i + 1) * 1000), new Date(clock.t - (i + 1) * 1000));
    await cache.get('a');
    await cache.sweep();
    expect(await cache.get('a')).not.toBeNull();
    const total = readdirSync(dir).reduce((s, n) => s + statSync(join(dir, n)).size, 0);
    expect(total).toBeLessThanOrEqual(3000);
    expect(CACHE_CAP_BYTES).toBe(200 * 1024 * 1024);
  });
});
