import type { Features } from '../../shared/types.ts';

// Reverb mode's per-frame state (VISUALIZER_SPEC.md §4.2–§4.5, §7): flow speed from intensity,
// bass breathing, wavefront rings spawned by onsets (at most 3), the key flare, feedback decay and
// warp, scaled by the intensity setting (§7.4) and then held under the photosensitivity limit
// (§7.3), which always has the last word. Pure: the renderer only uploads what this returns.

export type Intensity = 'subtle' | 'balanced' | 'expressive';

export const SETTINGS = {
  subtle: {
    breathe: 0.05,
    threshold: 0.55,
    i0Cap: 0.12,
    rings: 2,
    flowHigh: 1.3,
    poolBass: 0.03,
    decay: -0.02,
  },
  balanced: {
    breathe: 0.1,
    threshold: 0.35,
    i0Cap: 0.22,
    rings: 3,
    flowHigh: 1.6,
    poolBass: 0.06,
    decay: 0,
  },
  expressive: {
    breathe: 0.15,
    threshold: 0.25,
    i0Cap: 0.22,
    rings: 3,
    flowHigh: 2.0,
    poolBass: 0.09,
    decay: 0.02,
  },
} as const;

/** §7.3: all luminance-driving terms together change by at most this per second. */
export const LUMA_SLEW_PER_S = 0.24;
const RING_SPEED = 0.55; // H per second
const FLARE = 0.15;
const FLARE_MS = 120;

export interface Ring {
  x: number; // stage uv, y down
  y: number;
  age: number; // s
  i0: number;
  tau: number; // s
}

export interface ReverbFrame {
  flow: number; // warp time, accumulated
  exposure: number; // multiplier on the base exposure (1 ± breathing)
  rings: Ring[]; // ≤ 3, already scaled by `ringGain`
  ringGain: number; // the limiter's scale on ring light
  flare: number; // key flare, 0..0.15
  decay: number; // feedback decay per frame
  warp: number; // feedback UV warp amplitude
  poolScale: number; // pool radius multiplier (bass)
  keyScale: number; // key-light radius multiplier (sub)
  ringRadius: (r: Ring) => number; // H
}

/** Ring light at its age: I₀·e^{−age/τ}. */
export const ringLight = (r: Ring) => r.i0 * Math.exp(-r.age / r.tau);

export function createReverb(setting: Intensity = 'expressive', seed = 1) {
  const S = SETTINGS[setting];
  let flow = 0;
  let rings: Ring[] = [];
  let flareMs = 0;
  // What the limiter last let through, per term.
  let shownExposure = 1;
  let shownRings = 0;
  let shownFlare = 0;
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };

  return {
    step(f: Features, dtMs: number, key: [number, number]): ReverbFrame {
      const dt = dtMs / 1000;
      const it = f.available ? f.intensity : 0.6;
      const g = 0.35 + 0.65 * it; // motion gain (LYRICS_EXPERIENCE.md §12.2)
      // §4.2 / §7.2: flow speeds up with intensity; calm passages sit at the minimum.
      const busy = it > 0.75 ? S.flowHigh : 1;
      flow += (it < 0.2 ? 0.04 : (0.04 + 0.1 * it) * busy) * dt;

      // §4.3: an onset spawns a ring at the key light (70%) or on a pool (30%); calm passages
      // need a stronger one. Beyond the cap, the oldest ring is refreshed.
      const threshold = it < 0.2 ? Math.max(0.5, S.threshold) : S.threshold;
      for (const r of rings) r.age += dt;
      rings = rings.filter((r) => ringLight(r) > 0.002);
      if (f.available && f.onset > threshold) {
        const atKey = rand() < 0.7;
        const ring: Ring = {
          x: atKey ? key[0] : 0.2 + 0.6 * rand(),
          y: atKey ? key[1] : 0.2 + 0.5 * rand(),
          age: 0,
          i0: Math.min(S.i0Cap, 0.1 + 0.12 * f.onset),
          tau: 0.45 + 0.6 * (1 - it),
        };
        if (rings.length >= S.rings) rings.sort((a, b) => b.age - a.age).shift();
        rings.push(ring);
        flareMs = FLARE_MS;
      }
      flareMs = Math.max(0, flareMs - dtMs);

      // §4.5 / §7.2: breathing ±3% when calm, up to the setting's maximum.
      const breathe = it < 0.2 ? Math.min(0.03, S.breathe) : S.breathe;
      const wantExposure = 1 + breathe * g * (f.available ? f.bass : 0);
      const wantRings = rings.reduce((sum, r) => sum + ringLight(r), 0);
      const wantFlare = flareMs > 0 ? FLARE : 0;

      // §7.3: the combined change of everything that drives luminance is slew-limited, so no
      // region can flash. Each term moves toward its target by a share of one budget. Ring and
      // flare light may fall at once (the feedback buffer's decay already softens the fall); held
      // up instead, the next onset would jump to the held value.
      shownRings = Math.min(shownRings, wantRings);
      shownFlare = Math.min(shownFlare, wantFlare);
      const budget = LUMA_SLEW_PER_S * dt;
      const d = [wantExposure - shownExposure, wantRings - shownRings, wantFlare - shownFlare];
      const total = Math.abs(d[0] as number) + Math.abs(d[1] as number) + Math.abs(d[2] as number);
      const k = total > budget ? budget / total : 1;
      shownExposure += (d[0] as number) * k;
      shownRings += (d[1] as number) * k;
      shownFlare += (d[2] as number) * k;
      const ringGain = wantRings > 0 ? Math.min(1, shownRings / wantRings) : 0;

      return {
        flow,
        exposure: shownExposure,
        rings: rings.map((r) => ({ ...r, i0: r.i0 * ringGain })),
        ringGain,
        flare: shownFlare,
        decay: Math.min(0.97, 0.9 + 0.06 * (1 - it) + S.decay),
        warp: Math.min(0.003, 0.002 * (1 + 0.5 * (f.available ? f.high : 0))),
        poolScale: 1 + S.poolBass * (f.available ? f.bass : 0),
        keyScale: 1 + 0.08 * (f.available ? f.sub : 0),
        ringRadius: (r) => RING_SPEED * r.age,
      };
    },
  };
}

/** §7.3: ring and flare tints never read as saturated red, R/(R+G+B) < 0.8. */
export function safeTint([r, g, b]: [number, number, number]): [number, number, number] {
  const sum = r + g + b;
  if (sum <= 0 || r / sum < 0.8) return [r, g, b];
  // Raise green and blue until red is 79% of the sum.
  const lift = (r / 0.79 - sum) / 2;
  return [r, g + lift, b + lift];
}
