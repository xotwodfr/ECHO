import { describe, expect, it, vi } from 'vitest';
import { createGovernor, firstTier, rememberedTier, rememberTier } from './governor.ts';

// PERF-02 (VISUALIZER_SPEC.md §8.2): steps down within 1.5 s of sustained overload, up only after
// 8 s well under budget and 20 s after any change, never in a track's first 3 s or a scrub.

function run(manual = false, tier: 'T0' | 'T1' | 'T2' | 'T3' = 'T1') {
  let t = 0;
  const g = createGovernor({ tier, manual, now: () => t });
  const changes: { at: number; tier: string }[] = [];
  const frames = (
    ms: number,
    dt: number,
    extra: { gpuMs?: number; scrubbing?: boolean; trackStart?: number } = {},
  ) => {
    for (let e = 0; e < ms; e += dt) {
      t += dt;
      const r = g.sample({
        dtMs: dt,
        gpuMs: extra.gpuMs,
        trackMs: t - (extra.trackStart ?? -10_000),
        scrubbing: !!extra.scrubbing,
      });
      if (r) changes.push({ at: t, tier: r });
    }
  };
  frames(1000, 1000 / 60); // calibrates on 60 Hz
  return { g, frames, changes, now: () => t };
}

describe('the governor', () => {
  it('measures the refresh rate from the first 60 frames', () => {
    const r = run();
    expect(r.g.targetMs).toBeCloseTo(16.67, 1);
    const g144 = createGovernor({ tier: 'T1', manual: false, now: () => 0 });
    for (let i = 0; i < 60; i++)
      g144.sample({ dtMs: 1000 / 144, trackMs: 10_000, scrubbing: false });
    expect(g144.targetMs).toBeCloseTo(6.94, 1);
  });

  it('steps down within 1.5 s of sustained overload', () => {
    const r = run();
    const start = r.now();
    r.frames(3000, 30); // 33 fps on a 60 Hz display
    expect(r.changes[0]?.tier).toBe('T2');
    expect((r.changes[0]?.at ?? Infinity) - start).toBeLessThanOrEqual(1500);
  });

  it('GPU time over budget steps down even at full frame rate', () => {
    const r = run();
    r.frames(2000, 1000 / 60, { gpuMs: 12 });
    expect(r.changes[0]?.tier).toBe('T2');
  });

  it('steps up only after 8 s well under budget and 20 s after the last change', () => {
    const r = run(false, 'T2');
    r.frames(9000, 10); // well under budget, but the governor just started: lastChange is -∞
    expect(r.changes.map((c) => c.tier)).toEqual(['T1']);
    r.frames(9000, 10); // 9 s later: still within 20 s of the step up
    expect(r.changes).toHaveLength(1);
    r.frames(12_000, 10);
    expect(r.changes.map((c) => c.tier)).toEqual(['T1', 'T0']);
  });

  // Owner's report, 2026-10-28: the Visual view showed a frozen room. Frames are locked to the
  // display's refresh, so they can never come in faster than the calibrated target: a step down was
  // for ever (and T3 is Still, remembered per device). Recovery must be reachable with vsync.
  it('recovers on a vsync-locked display once a heavy spell has passed', () => {
    let t = 0;
    const g = createGovernor({ tier: 'T0', manual: false, now: () => t });
    const frames = (ms: number, dt: number) => {
      const out: string[] = [];
      for (let e = 0; e < ms; e += dt) {
        t += dt;
        const r = g.sample({ dtMs: dt, trackMs: 10_000, scrubbing: false });
        if (r) out.push(r);
      }
      return out;
    };
    frames(1000, 1000 / 240); // a 240 Hz display
    expect(frames(1500, 1000 / 120)).toEqual(['T1']); // a heavy second: half the frame rate
    expect(frames(60_000, 1000 / 240)).toEqual(['T0']); // full refresh again: back up
  });

  it('never freezes the room on its own: T3 (Still) is a manual choice', () => {
    const r = run(false, 'T2');
    r.frames(5000, 50); // 20 fps, far over budget
    expect(r.changes).toEqual([]); // stays at T2, still drawing
    const manual = run(true, 'T2');
    manual.frames(5000, 60); // a manual tier's emergency (< 20 fps for 3 s) may go to Still
    expect(manual.changes.map((c) => c.tier)).toEqual(['T3']);
  });

  it('a remembered T3 is not a starting point', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    try {
      rememberTier('T3');
      expect(rememberedTier()).toBeNull();
      rememberTier('T2');
      expect(rememberedTier()).toBe('T2');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never oscillates more than once per 20 s under a load that flips', () => {
    const r = run(false, 'T1');
    for (let i = 0; i < 12; i++) {
      r.frames(5000, 30); // overloaded
      r.frames(10_000, 10); // then fine
    }
    const ups = r.changes.filter((c, i) => i > 0 && c.tier < (r.changes[i - 1]?.tier ?? ''));
    for (let i = 1; i < ups.length; i++)
      expect((ups[i]?.at ?? 0) - (ups[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(20_000);
  });

  it('holds still in a track’s first 3 s and while scrubbing', () => {
    const r = run();
    r.frames(2900, 30, { trackStart: r.now() });
    expect(r.changes).toEqual([]);
    r.frames(3000, 30, { scrubbing: true });
    expect(r.changes).toEqual([]);
  });

  it('a manual tier only gives way to an emergency: under 20 fps for 3 s', () => {
    const r = run(true, 'T0');
    r.frames(5000, 30); // 33 fps: not an emergency
    expect(r.changes).toEqual([]);
    r.frames(4000, 70); // 14 fps
    expect(r.changes[0]?.tier).toBe('T1');
  });

  it('first run: T0 on a discrete GPU, T1 otherwise', () => {
    expect(firstTier('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)')).toBe('T0');
    expect(firstTier('AMD Radeon RX 6800 (radeonsi, navi21)')).toBe('T0');
    expect(firstTier('Mesa Intel(R) UHD Graphics 620')).toBe('T1');
    expect(firstTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe('T1');
    expect(firstTier(null)).toBe('T1');
  });
});
