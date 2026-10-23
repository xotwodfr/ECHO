import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { voidAndCluster } from '../../../scripts/blue-noise.ts';
import { parseColor } from '../../shared/oklab.ts';
import type { FeatureSource } from '../../shared/types.ts';
import {
  AMBIENT_FLOW_PER_S,
  createStageLoop,
  type Frame,
  type LoopEnv,
  MAX_DT_MS,
  PAUSED_RATE,
  RATE_RAMP_S,
} from './loop.ts';
import { BASE_EXPOSURE, HABLE, hable, paletteUniforms } from './palette.ts';

// A frame clock: requestFrame queues callbacks, `advance(ms)` runs one frame ms later.
function fakeEnv() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, (t: number) => void>();
  let hidden = false;
  const listeners = new Set<() => void>();
  let requested = 0;
  const env: LoopEnv = {
    requestFrame(cb) {
      requested++;
      queue.set(next, cb);
      return next++;
    },
    cancelFrame: (id) => void queue.delete(id),
    now: () => now,
    hidden: () => hidden,
    onVisibilityChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    env,
    advance(ms: number) {
      now += ms;
      const due = [...queue];
      queue.clear();
      for (const [, cb] of due) cb(now);
    },
    setHidden(h: boolean) {
      hidden = h;
      for (const cb of listeners) cb();
    },
    pending: () => queue.size,
    requested: () => requested,
  };
}

const silent: FeatureSource = {
  sample: () => ({
    available: false,
    sub: 0,
    bass: 0,
    mid: 0,
    high: 0,
    onset: 0,
    intensity: 0.6,
    bassImpulse: 0,
  }),
};

function setup(mode: 'ambient' | 'still' = 'ambient', playing = true) {
  const f = fakeEnv();
  const calls: string[] = [];
  const frames: Frame[] = [];
  const state = { playing };
  const loop = createStageLoop(
    {
      songTime: () => {
        calls.push('songTime');
        return 1234;
      },
      features: () => ({
        sample: (t, dt) => {
          calls.push('features');
          return silent.sample(t, dt);
        },
      }),
      palette: { step: () => void calls.push('palette') },
      render: (fr) => {
        calls.push('render');
        frames.push(fr);
      },
      isPlaying: () => state.playing,
    },
    f.env,
    mode,
  );
  return { ...f, loop, calls, frames, state };
}

describe('Stage loop (TECHNICAL_ARCHITECTURE.md §4.2)', () => {
  it('runs the frame steps in order: song time, features, palette, render', () => {
    const { loop, calls, frames } = setup();
    loop.start();
    expect(calls).toEqual(['songTime', 'features', 'palette', 'render']);
    expect(frames[0]?.t).toBe(1234);
  });

  it('ambient: one frame per animation frame, flow at 0.05 units/s, dt clamped', () => {
    const { loop, advance, frames } = setup();
    loop.start();
    for (let i = 0; i < 60; i++) advance(1000 / 60);
    expect(frames).toHaveLength(61);
    expect(frames.at(-1)?.flow).toBeCloseTo(AMBIENT_FLOW_PER_S, 5);
    expect(frames.at(-1)?.drift).toBeCloseTo(1, 5);
    advance(5000); // a stall never jumps the room
    expect(frames.at(-1)?.dt).toBe(MAX_DT_MS);
  });

  // PERF-04: a hidden tab gets no frames at all.
  it('stops while hidden and resumes when visible, without a time jump', () => {
    const { loop, advance, setHidden, frames, pending } = setup();
    loop.start();
    advance(16);
    setHidden(true);
    expect(pending()).toBe(0);
    const before = frames.length;
    advance(16);
    advance(60_000);
    expect(frames).toHaveLength(before);
    setHidden(false);
    advance(16);
    expect(frames).toHaveLength(before + 1);
    expect(frames.at(-1)?.dt).toBe(16);
  });

  it('paused playback slows the room to 25% over 1.5 s, and back', () => {
    const { loop, advance, frames, state } = setup('ambient', true);
    loop.start();
    advance(10);
    state.playing = false;
    const at = frames.at(-1)?.drift ?? 0;
    for (let i = 0; i < 100; i++) advance(20); // 2 s, past the 1.5 s ramp
    const last = frames.at(-1) as Frame;
    const prev = frames.at(-2) as Frame;
    expect((last.drift - prev.drift) / 0.02).toBeCloseTo(PAUSED_RATE, 5);
    expect(last.drift - at).toBeGreaterThan(2 * PAUSED_RATE);
    expect(last.drift - at).toBeLessThan(2);
    state.playing = true;
    for (let i = 0; i < (RATE_RAMP_S * 1000) / 20 + 5; i++) advance(20);
    const a = frames.at(-1) as Frame;
    const b = frames.at(-2) as Frame;
    expect((a.drift - b.drift) / 0.02).toBeCloseTo(1, 5);
  });

  it('still: renders once, never loops, and re-renders on request', () => {
    const { loop, advance, frames, requested } = setup('still');
    loop.start();
    advance(1000);
    expect(frames).toHaveLength(1);
    expect(requested()).toBe(0);
    loop.renderOnce();
    expect(frames).toHaveLength(2);
    expect(frames.at(-1)?.flow).toBe(0);
    loop.setMode('ambient');
    advance(16);
    expect(frames.length).toBeGreaterThan(3);
    loop.setMode('still');
    const n = frames.length;
    advance(16);
    expect(frames).toHaveLength(n);
  });

  it('stop and dispose leave nothing scheduled', () => {
    const { loop, advance, pending, frames, setHidden } = setup();
    loop.start();
    loop.stop();
    expect(pending()).toBe(0);
    loop.start();
    loop.dispose();
    const n = frames.length;
    setHidden(false);
    advance(16);
    expect(frames).toHaveLength(n);
  });
});

describe('palette and tone map', () => {
  // The Stage reads the --art-* properties; tokens.css must hold values it can parse.
  it('parses every --art-* default in tokens.css', () => {
    const css = readFileSync('src/client/tokens.css', 'utf8');
    const get = (n: string) => new RegExp(`--art-${n}:\\s*([^;]+);`).exec(css)?.[1] ?? '';
    const u = paletteUniforms({
      room: get('room'),
      accent: get('accent'),
      highlight: get('highlight'),
      glow: get('glow'),
      shadow: get('shadow'),
    });
    for (const c of Object.values(u)) for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
    expect(u.glow[0]).toBeCloseTo(parseColor(get('glow')).rgb[0] * 0.35, 6);
    expect(u.room[0]).toBeLessThan(0.01); // a dark room, in linear light
  });

  it('BASE_EXPOSURE keeps dark colours unchanged through the filmic curve', () => {
    const tone = (x: number) => hable(x * BASE_EXPOSURE) / hable(HABLE.W);
    for (const x of [0.001, 0.003, 0.01]) expect(tone(x) / x).toBeCloseTo(1, 1);
    expect(tone(4)).toBeLessThan(1); // highlights still roll off
  });
});

describe('blue noise', () => {
  it('ranks every texel once, with negatively correlated neighbours', () => {
    const n = 16;
    const rank = voidAndCluster(n);
    expect([...rank].sort((a, b) => a - b)).toEqual([...Array(n * n).keys()]);
    const v = (x: number, y: number) =>
      (rank[((y + n) % n) * n + ((x + n) % n)] as number) - (n * n - 1) / 2;
    let s = 0;
    let ss = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        s += v(x, y) * v(x + 1, y) + v(x, y) * v(x, y + 1);
        ss += 2 * v(x, y) ** 2;
      }
    expect(s / ss).toBeLessThan(-0.1);
  });
});
