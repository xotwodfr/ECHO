import { describe, expect, it } from 'vitest';
import type { PlaybackState, Track } from '../../shared/types.ts';
import { type AudioClock, createSongClock, positionNow } from './songClock.ts';

const track = (key: string): Track => ({
  key,
  provider: 'navidrome',
  id: key,
  title: key,
  artists: [],
  album: { title: '', key: '' },
  durationMs: 600_000,
  artwork: [],
});

function rig() {
  let t = 1000;
  let s: PlaybackState = {
    status: 'playing',
    track: track('a'),
    positionMs: 0,
    positionAt: t,
    volume: 1,
    shuffle: false,
    repeat: 'off',
    capabilities: {} as PlaybackState['capabilities'],
  };
  let audio: AudioClock | null = null;
  const clock = createSongClock(
    () => s,
    () => audio,
    () => t,
  );
  return {
    clock,
    step(ms: number) {
      t += ms;
    },
    set(over: Partial<PlaybackState>) {
      s = { ...s, ...over };
    },
    audio(a: AudioClock | null) {
      audio = a;
    },
    get t() {
      return t;
    },
    get state() {
      return s;
    },
  };
}

const FRAME = 1000 / 60;

describe('SongClock (TECHNICAL_ARCHITECTURE.md §5.2)', () => {
  it('without audio it is the extrapolated provider position', () => {
    const r = rig();
    expect(r.clock.now()).toBe(0);
    r.step(1234);
    expect(r.clock.now()).toBeCloseTo(1234);
    expect(r.clock.now()).toBeCloseTo(positionNow(r.state, r.t));
  });

  it('runs on performance time between audio updates and slews small errors at 10% per frame', () => {
    const r = rig();
    r.audio({ positionMs: 0, latencyMs: 0 });
    r.clock.now();
    // The element reports a coarse, stale position (as currentTime does): the clock keeps moving.
    r.step(FRAME);
    expect(r.clock.now()).toBeCloseTo(FRAME * 0.9); // ran FRAME ahead, then 10% back toward 0
    // The element is 40 ms behind the clock's own estimate: closed by 10% of the error per frame.
    const r2 = rig();
    r2.audio({ positionMs: 0, latencyMs: 0 });
    r2.clock.now();
    r2.step(FRAME);
    r2.audio({ positionMs: FRAME - 40, latencyMs: 0 });
    expect(r2.clock.now()).toBeCloseTo(FRAME - 4);
    r2.step(FRAME);
    r2.audio({ positionMs: 2 * FRAME - 40, latencyMs: 0 });
    expect(r2.clock.now()).toBeCloseTo(2 * FRAME - 4 - 0.1 * 36);
  });

  it('slews by elapsed frames, not by calls', () => {
    const r = rig();
    r.audio({ positionMs: 0, latencyMs: 0 });
    r.clock.now();
    r.step(2 * FRAME);
    r.audio({ positionMs: 2 * FRAME - 40, latencyMs: 0 });
    expect(r.clock.now()).toBeCloseTo(2 * FRAME - 40 * 0.19); // two frames close 1 − 0.9² of it
    // A second call in the same frame changes nothing.
    expect(r.clock.now()).toBeCloseTo(2 * FRAME - 40 * 0.19);
  });

  it('snaps errors of 80 ms or more (a seek, a stall)', () => {
    const r = rig();
    r.audio({ positionMs: 0, latencyMs: 0 });
    r.clock.now();
    r.step(FRAME);
    r.audio({ positionMs: 30_000, latencyMs: 0 });
    expect(r.clock.now()).toBe(30_000);
    r.step(FRAME);
    r.audio({ positionMs: 30_000 + FRAME - 80, latencyMs: 0 });
    expect(r.clock.now()).toBeCloseTo(30_000 + FRAME - 80);
  });

  it('subtracts the output latency, so lyrics follow what is heard', () => {
    const r = rig();
    r.audio({ positionMs: 5000, latencyMs: 150 });
    expect(r.clock.now()).toBe(4850);
  });

  it('holds still while paused even if the latency estimate drifts; a paused seek moves it', () => {
    const r = rig();
    r.set({ status: 'paused' });
    r.audio({ positionMs: 5000, latencyMs: 20 });
    expect(r.clock.now()).toBe(4980);
    r.step(500);
    r.audio({ positionMs: 5000, latencyMs: 27 });
    expect(r.clock.now()).toBe(4980);
    r.audio({ positionMs: 9000, latencyMs: 27 });
    expect(r.clock.now()).toBe(8973);
    r.set({ status: 'playing', positionMs: 9000, positionAt: r.t });
    r.step(FRAME);
    // Resumes from there: one frame on, 10% slewed back toward the (stale) element, less latency.
    expect(r.clock.now()).toBeCloseTo(9000 + FRAME * 0.9 - 27, 1);
  });

  it('is frozen while paused and snaps on a track change', () => {
    const r = rig();
    r.audio({ positionMs: 5000, latencyMs: 20 });
    r.set({ status: 'paused' });
    expect(r.clock.now()).toBe(4980);
    r.step(1000);
    expect(r.clock.now()).toBe(4980);
    r.set({ status: 'playing', track: track('b') });
    r.audio({ positionMs: 10, latencyMs: 20 });
    expect(r.clock.now()).toBe(0); // 10 − 20, clamped at the start
  });
});
