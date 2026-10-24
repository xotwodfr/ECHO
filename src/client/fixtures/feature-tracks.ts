import type { FeatureSource, Features } from '../../shared/types.ts';

// Hand-authored Features tracks (IMPLEMENTATION_PLAN.md M3 task 2): a calm ballad, steady 4/4 pop,
// a 140 BPM techno stress track and silence. Each is a pure function of song time, so any frame is
// reproducible without a recording; real recordings replace them in M5. Envelopes use the attack
// and release times of VISUALIZER_SPEC.md §3.2, and an onset fires on the frame whose interval
// (t − dt, t] contains a hit, so a single still frame (dt = 0) never shows one.

interface Groove {
  bpm: number;
  kick: number[]; // beats within the 4-beat bar
  snare: number[];
  hatsPerBeat: number; // 0: none
  level: number; // overall loudness, 0..1
  voice?: number; // vocal-band gain, default 1: a ballad is carried by the voice
  intensity: (tMs: number) => number;
}

const ATTACK_MS = 10;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const EPS = 1e-6; // ms: a hit on a frame boundary must not round into the frame before or after
/** a mod n in [0, n), with values within EPS of n rounded to 0. */
const mod = (a: number, n: number) => {
  const r = ((a % n) + n) % n;
  return r > n - EPS ? 0 : r;
};
const env = (since: number, releaseMs: number) =>
  since < ATTACK_MS ? since / ATTACK_MS : Math.exp(-(since - ATTACK_MS) / releaseMs);

function groove(g: Groove): FeatureSource {
  const beat = 60_000 / g.bpm;
  const bar = 4 * beat;
  /** Time since the latest of `beats` (within the bar) at or before t. */
  const since = (t: number, beats: number[]) =>
    beats.length ? Math.min(...beats.map((b) => mod(t - b * beat, bar))) : Infinity;
  return {
    sample(t, dt): Features {
      const intensity = clamp01(g.intensity(t));
      const k = since(t, g.kick);
      const s = since(t, g.snare);
      const h = g.hatsPerBeat ? mod(t, beat / g.hatsPerBeat) : Infinity;
      const bass = g.level * env(k, 180) * (0.55 + 0.45 * intensity);
      const hit = dt > 0 && (k < dt - EPS || s < dt - EPS);
      return {
        available: true,
        sub: clamp01(0.85 * bass),
        bass: clamp01(bass),
        // The vocal band swells over two bars and rises with intensity.
        mid: clamp01(
          g.level *
            (g.voice ?? 1) *
            (0.3 + 0.4 * intensity) *
            (0.75 + 0.25 * Math.sin((2 * Math.PI * t) / (2 * bar))),
        ),
        high: clamp01(g.level * intensity * Math.max(0.6 * env(h, 120), 0.8 * env(s, 120))),
        onset: hit ? clamp01(0.5 + 0.5 * intensity) : 0,
        intensity,
        bassImpulse: clamp01(g.level * env(k, 40)),
      };
    },
  };
}

/** A smooth 0..1 rise and fall with period `periodMs`, starting at the trough. */
const wave = (t: number, periodMs: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / periodMs);

export const featureTracks: Record<string, FeatureSource> = {
  // 68 BPM, soft kick on 1 and the "and" of 3, no hats; intensity breathes over a minute.
  ballad: groove({
    bpm: 68,
    kick: [0, 2.5],
    snare: [],
    hatsPerBeat: 0,
    level: 0.55,
    voice: 2.2,
    intensity: (t) => 0.12 + 0.38 * wave(t, 60_000),
  }),
  // 120 BPM four-on-the-floor-ish pop: kick 1 and 3, snare 2 and 4, eighth hats; verse and chorus
  // alternate every 16 bars (32 s).
  pop: groove({
    bpm: 120,
    kick: [0, 2],
    snare: [1, 3],
    hatsPerBeat: 2,
    level: 0.8,
    intensity: (t) => (Math.floor(t / 32_000) % 2 ? 0.78 : 0.45),
  }),
  // 140 BPM stress: kick on every beat, clap on 2 and 4, sixteenth hats, intensity near the top.
  techno: groove({
    bpm: 140,
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    hatsPerBeat: 4,
    level: 1,
    intensity: () => 0.95,
  }),
  // Analysis available, nothing playing (an intro, a gap): every level 0.
  silence: {
    sample: () => ({
      available: true,
      sub: 0,
      bass: 0,
      mid: 0,
      high: 0,
      onset: 0,
      intensity: 0,
      bassImpulse: 0,
    }),
  },
};
