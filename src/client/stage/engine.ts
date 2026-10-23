import { type PlaybackController, positionNow } from '../playback/controller.ts';
import {
  chromeStep,
  createStageLoop,
  type LoopEnv,
  type StageLoop,
  type StageMode,
} from './loop.ts';
import { paletteUniforms, readPalette } from './palette.ts';
import { StageRenderer, type Tier } from './renderer.ts';
import { stageStatus } from './status.ts';

// The Stage engine (TECHNICAL_ARCHITECTURE.md §4): mounted once by React, then imperative. Loaded
// lazily with three.js when the Stage first opens (PERF-05: three.js loads with the Stage).

/** Where the key light sits until the lyric layer publishes the active line (M3): 40% H. */
const DEFAULT_KEY: [number, number] = [0.5, 0.4];

const browserEnv: LoopEnv = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
  hidden: () => document.visibilityState === 'hidden',
  onVisibilityChange(cb) {
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
};

export interface StageOptions {
  controller: PlaybackController;
  /** Quality tier (§8.1). The governor and first-run heuristic arrive in M9; M2 starts at T1. */
  tier?: Tier;
  env?: LoopEnv;
}

/**
 * Mounts the Stage into `root` (which holds `canvas` and the CSS fallback room). Falls back to the
 * CSS room when WebGL 2 is unavailable or the context is lost, and recovers on restore (§5.6, §9).
 */
export function mountStage(root: HTMLElement, canvas: HTMLCanvasElement, opts: StageOptions) {
  const tier = opts.tier ?? 'T1';
  const env = opts.env ?? browserEnv;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Still under reduced motion and at T3; otherwise Ambient. Reverb needs audio features (M5).
  const modeNow = (): StageMode => (reduced.matches || tier === 'T3' ? 'still' : 'ambient');
  const set = (patch: Partial<ReturnType<typeof stageStatus.getState>>) =>
    stageStatus.setState(patch);
  set({ renderer: 'pending', reason: null, mode: modeNow() });

  let renderer: StageRenderer;
  try {
    renderer = new StageRenderer(canvas, tier);
  } catch {
    set({ renderer: 'css', reason: 'no-webgl2' });
    return { dispose() {}, setChrome() {} }; // the CSS room has no scrims
  }

  let disposed = false;
  let loop: StageLoop | null = null;
  // Scrims follow the chrome (DESIGN_SYSTEM.md §7.7): `chrome` eases towards `chromeTarget`.
  let chrome = 1;
  let chromeTarget = 1;
  const { controller: c } = opts;

  const resize = () => {
    const r = root.getBoundingClientRect();
    renderer.setSize(r.width, r.height, window.devicePixelRatio || 1);
  };
  const observer = new ResizeObserver(() => {
    resize();
    loop?.renderOnce(); // Still mode shows the new size at once; Ambient draws it next frame anyway
  });

  const onReducedChange = () => {
    loop?.setMode(modeNow());
    set({ mode: modeNow() });
  };
  const onLost = () => {
    loop?.stop();
    set({ renderer: 'css', reason: 'context-lost' });
  };
  const onRestored = () => {
    renderer.rebuild();
    resize();
    set({ renderer: 'webgl', reason: null });
    loop?.start();
  };

  void renderer
    .init()
    .then(() => {
      if (disposed) return;
      renderer.setPalette(paletteUniforms(readPalette()));
      resize();
      loop = createStageLoop(
        {
          songTime: () => positionNow(c.player.getState(), performance.now()),
          features: c.features,
          palette: { step() {} }, // PaletteAnimator (OKLab transitions) in M4
          render: (f) => {
            chrome = loop?.mode === 'still' ? chromeTarget : chromeStep(chrome, chromeTarget, f.dt);
            renderer.render({ flow: f.flow, drift: f.drift, key: DEFAULT_KEY, chrome, seed: 0 });
          },
          isPlaying: () => c.player.getState().status === 'playing',
        },
        env,
        modeNow(),
      );
      observer.observe(root);
      reduced.addEventListener('change', onReducedChange);
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      set({ renderer: 'webgl', reason: null });
      loop.start();
    })
    .catch((err: unknown) => {
      // Any failure to start (a texture, a shader, the palette) falls back to the CSS room, never to
      // an empty stage.
      if (disposed) return;
      console.error('Stage failed to start; showing the CSS room', err);
      set({ renderer: 'css', reason: 'error' });
    });

  return {
    renderer,
    get loop() {
      return loop;
    },
    /** Chrome shown or hidden (PRODUCT_SPEC.md §6.1); the scrims fade with it. */
    setChrome(visible: boolean) {
      chromeTarget = visible ? 1 : 0;
      if (loop?.mode === 'still') loop.renderOnce();
    },
    dispose() {
      disposed = true;
      loop?.dispose();
      observer.disconnect();
      reduced.removeEventListener('change', onReducedChange);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      set({ renderer: 'pending', reason: null });
    },
  };
}

export type StageHandle = ReturnType<typeof mountStage>;
