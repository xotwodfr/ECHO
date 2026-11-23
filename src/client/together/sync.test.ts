import { describe, expect, it } from 'vitest';
import {
  createClockSync,
  cuePoint,
  DRIFT_MS,
  expectedPosition,
  type LocalPlayer,
  plan,
} from './sync.ts';

// Listen together's arithmetic: the server clock from here, the song's position, and what the
// player does to stay in step.

describe('the server clock from this device', () => {
  it('takes the midpoint of the shortest round trip', () => {
    const c = createClockSync();
    expect(c.offset()).toBeNull();
    // The server is 10 s ahead. A slow answer (400 ms round trip, stamped late) …
    c.request(1_010_390, 1000_000, 1000_400);
    expect(c.offset()).toBe(10_190);
    // … then a quick one (20 ms): it wins, right to within 10 ms.
    c.request(1_012_010, 1002_000, 1002_020);
    expect(c.offset()).toBe(10_000);
    // A slower one after it does not replace it.
    c.request(1_015_300, 1005_000, 1005_500);
    expect(c.offset()).toBe(10_000);
    expect(c.toServer(2_000_000)).toBe(2_010_000);
  });

  it('a pushed event can only raise the estimate (it took time to arrive)', () => {
    const c = createClockSync();
    c.pushed(1_010_000, 1_000_050); // at least 9950
    expect(c.offset()).toBe(9950);
    c.pushed(1_020_000, 1_010_200); // at least 9800: no news
    expect(c.offset()).toBe(9950);
    c.pushed(1_030_000, 1_020_010); // at least 9990
    expect(c.offset()).toBe(9990);
  });

  it('keeps only recent samples (a clock that moved is followed)', () => {
    const c = createClockSync(2);
    c.request(10_000, 0, 10);
    c.request(15_000, 10_000, 10_100);
    c.request(25_000, 20_000, 20_100);
    expect(c.offset()).toBe(4950);
  });
});

describe('where the song should be', () => {
  const base = { durationMs: 200_000, serverTime: 50_000 };
  it('playing: server now − startedAt, within the song', () => {
    const s = { ...base, playing: true, startedAt: 40_000, positionMs: 10_000 };
    expect(expectedPosition(s, 50_000)).toBe(10_000);
    expect(expectedPosition(s, 65_500)).toBe(25_500);
    expect(expectedPosition(s, 40_000 + 999_999)).toBe(200_000);
    expect(expectedPosition(s, 30_000)).toBe(0);
  });
  it('paused: where it stopped, whatever the time', () => {
    const s = { ...base, playing: false, startedAt: null, positionMs: 12_345 };
    expect(expectedPosition(s, 9_999_999)).toBe(12_345);
  });
  it('an unknown length does not clamp', () => {
    const s = { ...base, durationMs: 0, playing: true, startedAt: 0, positionMs: 0 };
    expect(expectedPosition(s, 500_000)).toBe(500_000);
  });
});

describe('cueing ahead', () => {
  it('cues on the first whole second at least LEAD_MS ahead, and waits until then', () => {
    expect(cuePoint(2772, 200_000)).toEqual({ atMs: 5000, waitMs: 2228 });
    expect(cuePoint(3500, 200_000)).toEqual({ atMs: 5000, waitMs: 1500 });
    expect(cuePoint(0, 200_000)).toEqual({ atMs: 2000, waitMs: 2000 });
    // No room before the end: start where it is.
    expect(cuePoint(198_000, 200_000)).toEqual({ atMs: 198_000, waitMs: 0 });
  });
});

describe('following the session', () => {
  const target = { trackId: 's1', playing: true, positionMs: 60_000, durationMs: 200_000 };
  const local = (over: Partial<LocalPlayer> = {}): LocalPlayer => ({
    trackId: 's1',
    active: true,
    loading: false,
    positionMs: 60_000,
    ...over,
  });

  it('loads the session’s song at its position, playing or not', () => {
    expect(plan(target, local({ trackId: null, active: false }))).toEqual({
      kind: 'load',
      positionMs: 60_000,
      play: true,
    });
    expect(plan({ ...target, playing: false }, local({ trackId: 'other' }))).toEqual({
      kind: 'load',
      positionMs: 60_000,
      play: false,
    });
  });

  it('in step within the tolerance, seeks beyond it', () => {
    expect(plan(target, local({ positionMs: 60_000 + DRIFT_MS - 1 }))).toBeNull();
    expect(plan(target, local({ positionMs: 60_000 - DRIFT_MS + 1 }))).toBeNull();
    expect(plan(target, local({ positionMs: 60_500 }))).toEqual({
      kind: 'seek',
      positionMs: 60_000,
    });
    expect(plan(target, local({ positionMs: 59_000 }))).toEqual({
      kind: 'seek',
      positionMs: 60_000,
    });
    // Not on top of a correction still settling, nor while loading.
    expect(plan(target, local({ positionMs: 59_000 }), true)).toBeNull();
    expect(plan(target, local({ positionMs: 0, loading: true }))).toBeNull();
  });

  it('plays and pauses with the host', () => {
    expect(plan(target, local({ active: false }))).toEqual({ kind: 'play' });
    // Paused elsewhere (a transcode paused on the whole second): moved, then played.
    expect(plan(target, local({ active: false, positionMs: 59_000 }))).toEqual({
      kind: 'seek',
      positionMs: 60_000,
    });
    // Paused on the whole second before is close enough while paused.
    expect(
      plan({ ...target, playing: false, positionMs: 60_772 }, local({ active: false })),
    ).toBeNull();
    expect(plan({ ...target, playing: false }, local())).toEqual({
      kind: 'pause',
      positionMs: 60_000,
    });
    expect(plan({ ...target, playing: false }, local({ active: false }))).toBeNull();
    // Paused somewhere else (the host sought while paused): moved there, still paused.
    expect(plan({ ...target, playing: false }, local({ active: false, positionMs: 10 }))).toEqual({
      kind: 'pause',
      positionMs: 60_000,
    });
  });

  it('a song that ended here first waits for the next instead of starting again', () => {
    const end = { ...target, positionMs: 199_500 };
    expect(plan(end, local({ active: false, positionMs: 200_000 }))).toBeNull();
    expect(plan({ ...target, positionMs: 200_000 }, local({ positionMs: 199_000 }))).toBeNull();
  });

  it('nothing in the session: a playing player stops', () => {
    const none = { trackId: null, playing: false, positionMs: 0, durationMs: 0 };
    expect(plan(none, local())).toEqual({ kind: 'stop' });
    expect(plan(none, local({ active: false }))).toBeNull();
  });
});
