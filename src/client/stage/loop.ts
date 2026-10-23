import type { FeatureSource, Features } from '../../shared/types.ts';

// The Stage loop (TECHNICAL_ARCHITECTURE.md §4.2), free of three.js and the DOM so its order,
// visibility stop and time bases are unit-tested with fakes.

export type StageMode = 'ambient' | 'still';

export interface Frame {
  /** Song time (ms). */
  t: number;
  /** Frame interval (ms), clamped. */
  dt: number;
  features: Features;
  /** Warp time in "units" (VISUALIZER_SPEC.md §4.2). */
  flow: number;
  /** Pool time in seconds, slowed while playback is paused. */
  drift: number;
}

export interface LoopParts {
  songTime(): number;
  features(): FeatureSource;
  palette: { step(dt: number): void };
  render(frame: Frame): void;
  /** Step 6 (governor, M9) slots in after render. */
  isPlaying(): boolean;
  /**
   * Something besides the room needs frames (the lyric field), so the loop keeps ticking in Still
   * mode too. Still frames with `dt > 0` are for it alone: the room is drawn by `renderOnce`.
   */
  animating?(): boolean;
}

export interface LoopEnv {
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  now(): number;
  hidden(): boolean;
  onVisibilityChange(cb: () => void): () => void;
}

/** Ambient flow rate (§4.2): 0.05 units/s, independent of song position. */
export const AMBIENT_FLOW_PER_S = 0.05;
/** Paused playback slows the room to 25% over 1.5 s (§4.2). */
export const PAUSED_RATE = 0.25;
export const RATE_RAMP_S = 1.5;
/** Long gaps (a debugger, a stalled tab) never jump the room. */
export const MAX_DT_MS = 100;

export function createStageLoop(parts: LoopParts, env: LoopEnv, initialMode: StageMode) {
  let mode = initialMode;
  let raf: number | null = null;
  let last = 0;
  let flow = 0;
  let drift = 0;
  let rate = parts.isPlaying() ? 1 : PAUSED_RATE;
  let running = false;

  function frame(dtMs: number) {
    const dt = Math.min(MAX_DT_MS, Math.max(0, dtMs));
    // Ambient time: eases towards full speed while playing, 25% while paused.
    const target = parts.isPlaying() ? 1 : PAUSED_RATE;
    const ramp = ((1 - PAUSED_RATE) / RATE_RAMP_S) * (dt / 1000);
    rate = rate < target ? Math.min(target, rate + ramp) : Math.max(target, rate - ramp);
    if (mode === 'ambient') {
      flow += AMBIENT_FLOW_PER_S * rate * (dt / 1000);
      drift += rate * (dt / 1000);
    }
    // §4.2 order: 1 song time · 2 features · 3 palette · 4 lyric field and 5 render (in `render`)
    // · (6 governor, M9).
    const t = parts.songTime();
    const features = parts.features().sample(t, dt);
    parts.palette.step(dt);
    parts.render({ t, dt, features, flow, drift });
  }

  const wanted = () => mode === 'ambient' || !!parts.animating?.();

  function tick(now: number) {
    raf = null;
    if (!running || env.hidden() || !wanted()) return;
    frame(now - last);
    last = now;
    raf = env.requestFrame(tick);
  }

  function schedule() {
    if (raf !== null || !running || !wanted() || env.hidden()) return;
    last = env.now();
    raf = env.requestFrame(tick);
  }

  function unschedule() {
    if (raf !== null) env.cancelFrame(raf);
    raf = null;
  }

  // Hidden tab: no frames at all (PERF-04). Audio is not the loop's business and continues.
  const offVisibility = env.onVisibilityChange(() => {
    if (env.hidden()) unschedule();
    else if (mode === 'ambient') schedule();
    else {
      renderOnce();
      schedule();
    }
  });

  /** One frame now, with no time passing (Still mode, resize, palette change, restore). */
  function renderOnce() {
    if (!running || env.hidden()) return;
    frame(0);
  }

  return {
    start() {
      running = true;
      renderOnce();
      schedule();
    },
    stop() {
      running = false;
      unschedule();
    },
    renderOnce,
    /** Starts ticking if something now needs frames (a lyric document arrived in Still mode). */
    wake: () => schedule(),
    get mode() {
      return mode;
    },
    setMode(next: StageMode) {
      mode = next;
      if (!wanted()) unschedule();
      renderOnce();
      schedule();
    },
    get running() {
      return running;
    },
    dispose() {
      running = false;
      unschedule();
      offVisibility();
    },
  };
}

export type StageLoop = ReturnType<typeof createStageLoop>;

/** Chrome (and with it the scrims) returns in 160 ms and fades out over 640 ms (task 5). */
export const CHROME_IN_MS = 160;
export const CHROME_OUT_MS = 640;

/** Moves the scrims' chrome level (0..1) towards `target` by one frame of `dt` ms, linearly. */
export function chromeStep(current: number, target: number, dt: number) {
  if (current < target) return Math.min(target, current + dt / CHROME_IN_MS);
  return Math.max(target, current - dt / CHROME_OUT_MS);
}
