import { describe, expect, it } from 'vitest';
import {
  lineNormal,
  MAX_SPRING_DT_MS,
  SPRINGS,
  type SpringParams,
  snap,
  spring,
  step,
} from './springs.ts';

/** Runs a spring from 1 to 0 at `hz` for `ms`; returns its position. */
function run(p: SpringParams, hz: number, ms: number, from = 1) {
  const s = spring(from);
  const dt = 1000 / hz;
  for (let t = 0; t + 1e-9 < ms; t += dt) step(s, 0, p, Math.min(dt, ms - t));
  return s;
}

/** Time until |x| stays below 2% (sampled at 1 kHz). */
function settle(p: SpringParams) {
  const s = spring(1);
  let last = 0;
  for (let t = 1; t <= 5000; t++) {
    step(s, 0, p, 1);
    if (Math.abs(s.x) >= 0.02) last = t;
  }
  return last / 1000;
}

const ALL: [string, SpringParams][] = [
  ['normal (slow lines)', lineNormal(800)],
  ['normal (fast lines)', lineNormal(100)],
  ['slow', SPRINGS.slow],
  ['enter', SPRINGS.enter],
  ['lift', SPRINGS.lift],
  ['impulse', SPRINGS.impulse],
  ['overdamped', { f: 2, zeta: 1.4 }],
];

describe('springs (LYRICS_EXPERIENCE.md §6.1)', () => {
  it.each(ALL)('%s: the same path at 30, 60, 120 and 144 Hz', (_, p) => {
    for (const ms of [150, 400, 1000]) {
      const ref = run(p, 1000, ms);
      for (const hz of [30, 60, 120, 144]) {
        const s = run(p, hz, ms);
        expect(s.x).toBeCloseTo(ref.x, 9);
        expect(s.v).toBeCloseTo(ref.v, 7);
      }
    }
  });

  it.each(ALL)('%s: converges to the target and stays bounded', (_, p) => {
    const s = run(p, 60, 4000);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
    for (let ms = 0; ms < 2000; ms += 50) expect(Math.abs(run(p, 60, ms).x)).toBeLessThanOrEqual(1);
  });

  it.each([
    ['line.normal at 2.0 Hz', lineNormal(800), 0.46],
    ['line.normal at 2.35 Hz', lineNormal(100), 0.39],
    // The draft table said 0.75 and 0.85 s; the exact solution (checked against RK4 below) settles
    // sooner, because ζ < 1 overshoots by less than the 2% band. Corrected in the spec.
    ['line.slow', SPRINGS.slow, 0.46],
    ['line.enter', SPRINGS.enter, 0.76],
  ] as const)('%s settles (2%%) in ≈ %f s (§6.1 table)', (_, p, s) => {
    expect(settle(p)).toBeCloseTo(s, 1);
  });

  it.each(ALL)('%s: matches a fine RK4 integration of x″ = −ω²x − 2ζωx′', (_, p) => {
    const w = 2 * Math.PI * p.f;
    const acc = (x: number, v: number) => -w * w * x - 2 * p.zeta * w * v;
    let x = 1;
    let v = 0;
    const h = 1e-5;
    for (let i = 0; i < 0.3 / h; i++) {
      const [ax, av] = [v, acc(x, v)];
      const [bx, bv] = [v + (h / 2) * av, acc(x + (h / 2) * ax, v + (h / 2) * av)];
      const [cx, cv] = [v + (h / 2) * bv, acc(x + (h / 2) * bx, v + (h / 2) * bv)];
      const [dx, dv] = [v + h * cv, acc(x + h * cx, v + h * cv)];
      x += (h / 6) * (ax + 2 * bx + 2 * cx + dx);
      v += (h / 6) * (av + 2 * bv + 2 * cv + dv);
    }
    const s = run(p, 60, 300);
    expect(s.x).toBeCloseTo(x, 5);
    expect(s.v).toBeCloseTo(v, 3);
  });

  it('critically damped at 2.0 Hz covers ~90% of the travel in 300 ms (§5.3 hand-over lead)', () => {
    expect(1 - run(lineNormal(800), 60, 300).x).toBeGreaterThan(0.88);
  });

  it('critically damped and underdamped never overshoot more than ζ allows', () => {
    const min = (p: SpringParams) => {
      let m = 1;
      for (let ms = 0; ms < 3000; ms += 10) m = Math.min(m, run(p, 100, ms).x);
      return m;
    };
    expect(min(lineNormal(800))).toBeGreaterThan(-1e-9); // ζ = 1: no overshoot
    expect(min(SPRINGS.slow)).toBeLessThan(0); // ζ 0.85 overshoots a little
    expect(min(SPRINGS.slow)).toBeGreaterThan(-0.02);
  });

  it('clamps dt to 100 ms: a 10 s gap moves no further than one 100 ms step', () => {
    const p = lineNormal(800);
    const big = step(spring(1), 0, p, 10_000);
    const one = step(spring(1), 0, p, MAX_SPRING_DT_MS);
    expect(big).toEqual(one);
    expect(step(spring(1), 0, p, 0)).toEqual(spring(1));
    expect(step(spring(1), 0, p, -5)).toEqual(spring(1));
  });

  it('carries velocity across a target change (no hard cut)', () => {
    const s = spring(0);
    step(s, 1, SPRINGS.slow, 100);
    const v = s.v;
    step(s, 2, SPRINGS.slow, 0.001);
    expect(s.v).toBeCloseTo(v, 0);
    expect(snap(s, 5)).toEqual({ x: 5, v: 0 });
  });

  it('line.normal stiffens for fast lyrics: 2.35 Hz at 100 ms, 2.0 Hz from 800 ms', () => {
    expect(lineNormal(0).f).toBeCloseTo(2.35);
    expect(lineNormal(100).f).toBeCloseTo(2.35);
    expect(lineNormal(800).f).toBeCloseTo(2.0);
    expect(lineNormal(5000).f).toBeCloseTo(2.0);
    expect(lineNormal(450).f).toBeGreaterThan(2.0);
    expect(lineNormal(450).f).toBeLessThan(2.35);
    expect(lineNormal(450).zeta).toBe(1);
  });
});
