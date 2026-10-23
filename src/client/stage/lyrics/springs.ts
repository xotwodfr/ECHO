import { LYRICS } from './lyricsConfig.ts';

// Damped harmonic springs (LYRICS_EXPERIENCE.md §6.1), integrated in closed form: one step is the
// exact solution for a target held constant over `dt`, so the path does not depend on the frame
// rate (30, 60, 120 or 144 Hz) and never goes unstable.

/** Longest step: a sleeping tab or a debugger pause never produces a giant jump. */
export const MAX_SPRING_DT_MS = 100;

export interface Spring {
  x: number; // position
  v: number; // velocity, units per second
}

export interface SpringParams {
  f: number; // natural frequency, Hz
  zeta: number; // damping ratio
}

export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Moves `s` towards `target` by `dtMs` (clamped to 100 ms), in place. */
export function step(s: Spring, target: number, p: SpringParams, dtMs: number) {
  const t = Math.min(MAX_SPRING_DT_MS, Math.max(0, dtMs)) / 1000;
  if (t === 0) return s;
  const w = 2 * Math.PI * p.f;
  const z = p.zeta;
  const u0 = s.x - target;
  const v0 = s.v;
  let u: number;
  let v: number;
  if (Math.abs(z - 1) < 1e-6) {
    // Critically damped: u = (u0 + (v0 + w u0) t) e^{−wt}
    const e = Math.exp(-w * t);
    const b = v0 + w * u0;
    u = (u0 + b * t) * e;
    v = (b - w * (u0 + b * t)) * e;
  } else if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * t);
    const c = Math.cos(wd * t);
    const sn = Math.sin(wd * t);
    const b = (v0 + z * w * u0) / wd;
    u = e * (u0 * c + b * sn);
    v = e * ((b * wd - z * w * u0) * c - (u0 * wd + z * w * b) * sn);
  } else {
    const r = w * Math.sqrt(z * z - 1);
    const r1 = -z * w + r;
    const r2 = -z * w - r;
    const c2 = (v0 - r1 * u0) / (r2 - r1);
    const c1 = u0 - c2;
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    u = c1 * e1 + c2 * e2;
    v = c1 * r1 * e1 + c2 * r2 * e2;
  }
  s.x = target + u;
  s.v = v;
  return s;
}

/** Places `s` at `target`, at rest (scrub, resize, deterministic frames). */
export function snap(s: Spring, target: number) {
  s.x = target;
  s.v = 0;
  return s;
}

const [fMin, fMax, zNormal] = LYRICS.springs.normal;
const pair = ([f, zeta]: readonly [number, number]): SpringParams => ({ f, zeta });

export const SPRINGS = {
  slow: pair(LYRICS.springs.slow),
  enter: pair(LYRICS.springs.enter),
  lift: pair(LYRICS.springs.lift),
  impulse: pair(LYRICS.springs.impulse),
} as const;

/**
 * `line.normal` for a hand-over between lines `gapMs` apart (start to start): faster lyrics get a
 * stiffer spring, 2.35 Hz at 100 ms down to 2.0 Hz at 800 ms or more (the AMLL mapping).
 */
export function lineNormal(gapMs: number): SpringParams {
  const n = Math.min(1, Math.max(0, (gapMs - 100) / 700));
  return { f: fMin + (fMax - fMin) * (1 - n) ** 0.2, zeta: zNormal };
}
