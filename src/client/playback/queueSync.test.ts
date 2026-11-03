import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueState, Track } from '../../shared/types.ts';
import { sessionExpired } from '../session.ts';
import { ManualClock } from './clock.ts';
import { createPlaybackController } from './controller.ts';
import { FakeProvider } from './fake.ts';
import { queueSlot, savedQueue, startQueueSync, trimQueue } from './queueSync.ts';

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

const ytTrack = (id: string): Track => ({
  ...track(0),
  key: `youtube:${id}`,
  provider: 'youtube',
  id,
});

describe('the queue slot (spec call 16)', () => {
  const q = (over: Partial<QueueState>): QueueState => ({
    provider: 'navidrome',
    now: track(0),
    nextUp: [],
    context: [track(1)],
    history: [],
    ...over,
  });
  it('queueSlot picks youtube for any youtube track', () => {
    expect(queueSlot(q({}))).toBe('/me/queue');
    expect(queueSlot(q({ nextUp: [ytTrack('y')] }))).toBe('/me/queue/youtube');
    expect(queueSlot(q({ now: ytTrack('y'), provider: 'youtube' }))).toBe('/me/queue/youtube');
  });
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

describe('ReplayGain (PLAY-05)', () => {
  it('dB to linear, limited by the peak; unknown gain is unity', async () => {
    const { replayGainLinear } = await import('./audio.ts');
    expect(replayGainLinear(undefined, undefined)).toBe(1);
    expect(replayGainLinear(-6, 0.5)).toBeCloseTo(0.501, 3);
    expect(replayGainLinear(6, 0.9)).toBeCloseTo(1 / 0.9, 9); // +6 dB would clip a 0.9 peak
    expect(replayGainLinear(3, undefined)).toBeCloseTo(1.413, 3);
  });
});

// ON-QU-1: one failed first request (the server restarting) turned queue sync off for the whole
// session: no restore, and no change was ever saved.
describe('queue sync start', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks again while the server is unreachable, then saves changes against its answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('addEventListener', () => {});
    let failures = 2;
    const puts: { baseUpdatedAt: number }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) return new Response('{}');
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return Response.json({ updatedAt: 6 });
      }
      if (failures-- > 0) throw new TypeError('Failed to fetch');
      return Response.json({ queue: null, positionMs: 0, updatedAt: 5 });
    });
    const clock = new ManualClock();
    const c = createPlaybackController({ provider: new FakeProvider({ clock, loadMs: 0 }), clock });
    void startQueueSync(c, () => {});
    await vi.advanceTimersByTimeAsync(3500); // tries at 0, 1 and 3 s
    c.playList([track(1), track(2)], 0, { kind: 'album', id: 'al', title: 'Al' });
    await vi.advanceTimersByTimeAsync(2500); // the save's debounce
    expect(puts.map((p) => p.baseUpdatedAt)).toEqual([5]);
  });

  // QA 2026-10-28 (QUE-05): pause and seek change the position, not the queue, so nothing was saved
  // and a reload came back wherever the last queue change had left it.
  it('a pause or a seek saves the position', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('addEventListener', () => {});
    const puts: { positionMs: number }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return Response.json({ queue: null, positionMs: 0, updatedAt: 5 });
    });
    const clock = new ManualClock();
    const c = createPlaybackController({ provider: new FakeProvider({ clock, loadMs: 0 }), clock });
    await startQueueSync(c, () => {});
    c.playList([track(1), track(2)], 0, { kind: 'album', id: 'al', title: 'Al' });
    await vi.advanceTimersByTimeAsync(2500); // the queue change
    clock.advance(30_000);
    c.toggle(); // pause at 0:30
    await vi.advanceTimersByTimeAsync(2500);
    c.seek(100_000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(puts.slice(1).map((p) => Math.round(p.positionMs / 1000))).toEqual([30, 100]);
  });

  it('restores the newer of the two slots', async () => {
    vi.stubGlobal('addEventListener', () => {});
    const nav = { provider: 'navidrome', now: track(1), nextUp: [], context: [], history: [] };
    const yt = { provider: 'youtube', now: ytTrack('y'), nextUp: [], context: [], history: [] };
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/me/queue/youtube')
        ? Response.json({ queue: yt, positionMs: 0, updatedAt: 9 })
        : Response.json({ queue: nav, positionMs: 0, updatedAt: 5 }),
    );
    const clock = new ManualClock();
    const provider = new FakeProvider({ clock, loadMs: 0 });
    Object.assign(provider, { sources: ['navidrome', 'youtube'] });
    const c = createPlaybackController({ provider, clock });
    await startQueueSync(c, () => {});
    expect(c.queue.getState().now?.key).toBe('youtube:y');
  });

  // QA 2026-10-28: with the session ended, a save would go out under whoever signs in next on the
  // sheet: another user received this queue.
  it('saves nothing while the session has ended', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('addEventListener', () => {});
    const puts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') puts.push(init.body);
      return Response.json({ queue: null, positionMs: 0, updatedAt: 5 });
    });
    const clock = new ManualClock();
    const c = createPlaybackController({ provider: new FakeProvider({ clock, loadMs: 0 }), clock });
    await startQueueSync(c, () => {});
    sessionExpired.setState({ expired: true });
    try {
      c.playList([track(1), track(2)], 0, { kind: 'album', id: 'al', title: 'Al' });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(puts).toEqual([]);
    } finally {
      sessionExpired.setState({ expired: false });
    }
  });
});

describe('a queue saved by another client', () => {
  it('the Android app’s, which leaves out empty lists and the default provider, plays here', () => {
    const t = {
      key: 'navidrome:a',
      id: 'a',
      title: 'A',
      artists: [{ name: 'X' }],
      album: { title: 'B', key: 'navidrome:b' },
      durationMs: 1000,
    };
    const q = savedQueue({ now: t, context: [t] } as unknown as QueueState);
    expect(q.provider).toBe('navidrome');
    expect(q.nextUp).toEqual([]);
    expect(q.history).toEqual([]);
    expect(q.now?.provider).toBe('navidrome');
    expect(q.now?.artwork).toEqual([]);
    expect(q.context[0]?.provider).toBe('navidrome');
    expect(savedQueue({ ...q, provider: null }).provider).toBeNull();
  });
});
