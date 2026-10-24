import { describe, expect, it } from 'vitest';
import type { QueueState, Track } from '../../shared/types.ts';
import { trimQueue } from './queueSync.ts';

const track = (i: number): Track => ({
  key: `navidrome:t${i}`,
  provider: 'navidrome',
  id: `t${i}`,
  title: `A fairly long track title number ${i}`,
  artists: [{ id: 'ar', name: 'Some Artist' }],
  album: { id: 'al', title: 'Some Album With A Name', key: 'navidrome:al' },
  durationMs: 200_000,
  artwork: [{ url: `/api/v1/navidrome/cover/al?size=600` }],
});

describe('queue trimming (64 KB bodies)', () => {
  it('a small queue is kept whole (history to its last 20)', () => {
    const q: QueueState = {
      provider: 'navidrome',
      now: track(0),
      nextUp: [track(1)],
      context: [track(2), track(3)],
      history: Array.from({ length: 30 }, (_, i) => track(100 + i)),
      shuffleOrder: [1, 0],
    };
    const f = trimQueue(q);
    expect(f.context).toHaveLength(2);
    expect(f.shuffleOrder).toEqual([1, 0]);
    expect(f.history).toHaveLength(20);
    expect(f.history[0]?.id).toBe('t110');
  });

  it('a long context is cut from the far end until it fits, dropping shuffle positions', () => {
    const q: QueueState = {
      provider: 'navidrome',
      now: track(0),
      nextUp: [],
      context: Array.from({ length: 2000 }, (_, i) => track(i + 1)),
      history: [],
      shuffleOrder: Array.from({ length: 2000 }, (_, i) => i),
    };
    const f = trimQueue(q);
    expect(new Blob([JSON.stringify(f)]).size).toBeLessThanOrEqual(60_000);
    expect(f.context[0]?.id).toBe('t1'); // what plays next is kept
    expect(f.context.length).toBeGreaterThan(50);
    expect(f.shuffleOrder).toBeUndefined();
    expect(f.now?.id).toBe('t0');
  });
});
