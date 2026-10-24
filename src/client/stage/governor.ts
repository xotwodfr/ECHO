import type { Tier } from './renderer.ts';

// The quality governor (VISUALIZER_SPEC.md §8.2). Pure: the engine feeds it frame intervals (and
// GPU time when the timer query exists) and applies the tier it returns. The refresh rate is the
// median of the first 60 intervals; a tier steps down after 1 s over budget and up after 8 s well
// under it, never in the first 3 s of a track or during a scrub, and never up within 20 s of any
// change, so it cannot oscillate faster than that (PERF-02). A manual tier only gives way to an
// emergency: under 20 fps for 3 s.

const ORDER: Tier[] = ['T0', 'T1', 'T2', 'T3'];
const ALPHA = 0.1;
const DOWN_AFTER_MS = 1000;
const UP_AFTER_MS = 8000;
const SETTLE_MS = 20_000;
const TRACK_START_MS = 3000;
const EMERGENCY_MS = 3000;
const EMERGENCY_FRAME_MS = 50; // 20 fps
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
    if (!next) return null;
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
      const isUnder = ema < 0.8 * target && (gpu === undefined || gpu < 0.4 * target);
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

/** The device's last stable tier, if it has one (per device: localStorage). */
export function rememberedTier(): Tier | null {
  try {
    const v = localStorage.getItem(LAST_TIER_KEY);
    return v && (ORDER as string[]).includes(v) ? (v as Tier) : null;
  } catch {
    return null;
  }
}

export function rememberTier(tier: Tier) {
  try {
    localStorage.setItem(LAST_TIER_KEY, tier);
  } catch {}
}
