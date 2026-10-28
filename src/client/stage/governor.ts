import type { Tier } from './renderer.ts';

// The quality governor (VISUALIZER_SPEC.md §8.2). Pure: the engine feeds it frame intervals (and
// GPU time when the timer query exists) and applies the tier it returns. The refresh rate is the
// median of the first 60 intervals; a tier steps down after 1 s over budget and up after 8 s at full
// refresh, never in the first 3 s of a track or during a scrub, and never up within 20 s of any
// change, so it cannot oscillate faster than that (PERF-02). Frames are locked to the display's
// refresh, so they never come in faster than the target: "well under budget" cannot be seen in the
// intervals, and recovery is a probe (a tier that cannot hold steps down again after 1 s). On its own
// it goes no lower than T2: T3 is Still, a frozen room, and in Still nothing is measured, so it could
// never come back (owner's report, 2026-10-28). A manual tier only gives way to an emergency: under
// 20 fps for 3 s.

const ORDER: Tier[] = ['T0', 'T1', 'T2', 'T3'];
const ALPHA = 0.1;
const DOWN_AFTER_MS = 1000;
const UP_AFTER_MS = 8000;
const SETTLE_MS = 20_000;
const TRACK_START_MS = 3000;
const EMERGENCY_MS = 3000;
const EMERGENCY_FRAME_MS = 50; // 20 fps
/** "At full refresh": within 5% of the target (vsync-locked frames sit at it, with jitter). */
const FULL_RATE = 1.05;
/** A gap this long is a hidden tab or a stall, not a frame: it is not measured. */
const GAP_MS = 250;
export const LAST_TIER_KEY = 'echo.visuals.lastTier';

export interface Sample {
  dtMs: number;
  /** GPU time of the frame, when EXT_disjoint_timer_query_webgl2 reports it. */
  gpuMs?: number;
  /** Time since the current track started. */
  trackMs: number;
  scrubbing: boolean;
}

export function createGovernor(opts: { tier: Tier; manual: boolean; now: () => number }) {
  let tier = opts.tier;
  const intervals: number[] = [];
  let target = 1000 / 60;
  let ema = 0;
  let over = 0; // ms spent over budget, continuously
  let under = 0; // ms spent well under budget, continuously
  let slow = 0; // ms under 20 fps (emergency), continuously
  let lastChange = Number.NEGATIVE_INFINITY;

  const step = (dir: 1 | -1): Tier | null => {
    const i = ORDER.indexOf(tier) + dir;
    const next = ORDER[i];
    if (!next || (next === 'T3' && !opts.manual)) return null;
    tier = next;
    lastChange = opts.now();
    over = under = slow = 0;
    return tier;
  };

  return {
    get tier() {
      return tier;
    },
    get targetMs() {
      return target;
    },
    /** One frame; returns the new tier when it changes, else null. */
    sample(s: Sample): Tier | null {
      if (s.dtMs <= 0 || s.dtMs > GAP_MS) return null;
      if (intervals.length < 60) {
        intervals.push(s.dtMs);
        if (intervals.length === 60) {
          const sorted = [...intervals].sort((a, b) => a - b);
          target = sorted[30] as number;
          ema = target;
        }
        return null;
      }
      ema += ALPHA * (s.dtMs - ema);
      const gpu = s.gpuMs;
      if (opts.manual) {
        slow = ema > EMERGENCY_FRAME_MS ? slow + s.dtMs : 0;
        return slow >= EMERGENCY_MS ? step(1) : null;
      }
      if (s.trackMs < TRACK_START_MS || s.scrubbing) {
        over = under = 0;
        return null;
      }
      const isOver = ema > 1.15 * target || (gpu !== undefined && gpu > 0.6 * target);
      const isUnder = ema <= FULL_RATE * target && (gpu === undefined || gpu < 0.4 * target);
      over = isOver ? over + s.dtMs : 0;
      under = isUnder ? under + s.dtMs : 0;
      if (over >= DOWN_AFTER_MS) return step(1);
      if (under >= UP_AFTER_MS && opts.now() - lastChange >= SETTLE_MS) return step(-1);
      return null;
    },
  };
}

/** §8.2 first run: T1, or T0 when the GPU is a discrete one (NVIDIA, AMD). */
export function firstTier(renderer: string | null): Tier {
  if (!renderer) return 'T1';
  if (/swiftshader|llvmpipe|software|intel|apple|mali|adreno/i.test(renderer)) return 'T1';
  return /nvidia|geforce|quadro|rtx|radeon|amd/i.test(renderer) ? 'T0' : 'T1';
}

/**
 * The device's last stable tier, if it has one (per device: localStorage). Never T3: Still is a
 * manual choice, and a device the old governor left there must not start frozen.
 */
export function rememberedTier(): Tier | null {
  try {
    const v = localStorage.getItem(LAST_TIER_KEY);
    return v && v !== 'T3' && (ORDER as string[]).includes(v) ? (v as Tier) : null;
  } catch {
    return null;
  }
}

export function rememberTier(tier: Tier) {
  try {
    localStorage.setItem(LAST_TIER_KEY, tier);
  } catch {}
}
