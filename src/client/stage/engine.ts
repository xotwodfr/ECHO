import type { PlaybackController } from '../playback/controller.ts';
import type { FrameParams } from '../view.ts';
import {
  AMBIENT_FLOW_PER_S,
  chromeStep,
  createStageLoop,
  type LoopEnv,
  type StageMode,
} from './loop.ts';
import { createLyricField, type LyricField } from './lyrics/field.ts';
import { paletteUniforms, readPalette } from './palette.ts';
import { StageRenderer, type Tier } from './renderer.ts';
import { lyricHost, lyricsStore, scrubStore, stageStatus } from './status.ts';

// The Stage engine (TECHNICAL_ARCHITECTURE.md §4): mounted once by React, then imperative. Loaded
// lazily with three.js when the Stage first opens (PERF-05: three.js loads with the Stage).

/** Where the key light sits when no line is being sung: 40% H. */
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
  /** Deterministic mode (§10): one frame at `frame.ms`, no loop. */
  frame?: FrameParams;
}

/**
 * Mounts the Stage into `root` (which holds `canvas` and the CSS fallback room). Falls back to the
 * CSS room when WebGL 2 is unavailable or the context is lost, and recovers on restore (§5.6, §9).
 * The loop runs either way: the lyric field (LYRICS_EXPERIENCE.md) does not need the room.
 */
export function mountStage(root: HTMLElement, canvas: HTMLCanvasElement, opts: StageOptions) {
  const { frame } = opts;
  const tier = frame?.tier ?? opts.tier ?? 'T1';
  const env = opts.env ?? browserEnv;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Still under reduced motion, at T3 and in deterministic mode (one frame, no loop); otherwise
  // Ambient. Reverb needs audio features (M5).
  const modeNow = (): StageMode =>
    frame || reduced.matches || tier === 'T3' ? 'still' : 'ambient';
  const set = (patch: Partial<ReturnType<typeof stageStatus.getState>>) =>
    stageStatus.setState(patch);
  set({ renderer: 'pending', reason: null, mode: modeNow() });

  let renderer: StageRenderer | null = null;
  try {
    renderer = new StageRenderer(canvas, tier);
  } catch {
    set({ renderer: 'css', reason: 'no-webgl2' });
  }

  let disposed = false;
  let drawing = false; // the room: once the renderer is ready, until the context is lost
  let roomOk = !!renderer; // false without WebGL 2, after a failed start, while the context is lost
  // The loop's own pace: the room's mode while it can draw, else Still (frames only for the lyric
  // field, if it is showing).
  const loopMode = (): StageMode => (roomOk ? modeNow() : 'still');
  // Scrims follow the chrome (DESIGN_SYSTEM.md §7.7): `chrome` eases towards `chromeTarget`.
  let chrome = 1;
  let chromeTarget = 1;
  const { controller: c } = opts;
  let field: LyricField | null = null;
  const playing = () => c.player.getState().status === 'playing';

  const loop = createStageLoop(
    {
      songTime: () => frame?.ms ?? scrubStore.getState().ms ?? c.songTime(),
      // In deterministic mode with `fixture=`, the controller serves the recorded Features
      // (§10), sampled at `frame.ms`. The lyric field reads them (LYRICS_EXPERIENCE.md §12); the
      // room does from M5.
      features: c.features,
      palette: { step() {} }, // PaletteAnimator (OKLab transitions) in M4
      render: (f) => {
        // Deterministic: the room as Ambient draws it after `ms` of playback at full rate.
        const flow = frame ? (AMBIENT_FLOW_PER_S * frame.ms) / 1000 : f.flow;
        const drift = frame ? frame.ms / 1000 : f.drift;
        const scrub = scrubStore.getState().ms !== null;
        const key = field?.update({
          t: f.t,
          dt: f.dt,
          driftS: drift,
          playing: playing(),
          mode: frame ? 'still' : scrub ? 'scrub' : 'run',
          features: f.features,
        });
        // In Still mode the loop ticks only for the lyric field; the room is drawn by renderOnce.
        if (!drawing || !renderer || (loop.mode === 'still' && f.dt > 0)) return;
        chrome = loop.mode === 'still' ? chromeTarget : chromeStep(chrome, chromeTarget, f.dt);
        renderer.render({
          flow,
          drift,
          key: key ? [key.x, key.y] : DEFAULT_KEY,
          chrome,
          seed: frame?.seed ?? 0,
        });
      },
      isPlaying: playing,
      // Deterministic mode draws single frames only.
      animating: () => !frame && !!field?.active,
    },
    env,
    loopMode(),
  );

  const resize = () => {
    if (!renderer) return;
    const r = root.getBoundingClientRect();
    renderer.setSize(r.width, r.height, window.devicePixelRatio || 1);
  };
  const observer = new ResizeObserver(() => {
    resize();
    field?.resize();
    loop.renderOnce(); // Still mode shows the new size at once; Ambient draws it next frame anyway
  });

  // The lyric field lives in the Lyrics view's host element, and shows the current document.
  const mountField = (el: HTMLElement | null) => {
    field?.dispose();
    field = null;
    if (!el) return;
    field = createLyricField(el, {
      tier,
      onReady: () => {
        loop.renderOnce();
        loop.wake();
      },
    });
    void field.setDoc(lyricsStore.getState().doc);
  };
  const offHost = lyricHost.subscribe((s, prev) => s.el !== prev.el && mountField(s.el));
  const offDoc = lyricsStore.subscribe((s) => void field?.setDoc(s.doc));
  mountField(lyricHost.getState().el);

  const onReducedChange = () => {
    loop.setMode(loopMode());
    set({ mode: modeNow() });
  };
  const onLost = () => {
    drawing = false;
    roomOk = false;
    loop.setMode(loopMode());
    set({ renderer: 'css', reason: 'context-lost' });
  };
  const onRestored = () => {
    if (!renderer) return;
    renderer.rebuild();
    resize();
    drawing = true;
    roomOk = true;
    set({ renderer: 'webgl', reason: null });
    loop.setMode(loopMode());
  };

  observer.observe(root);
  reduced.addEventListener('change', onReducedChange);
  loop.start();

  void renderer
    ?.init()
    .then(() => {
      if (disposed || !renderer) return;
      renderer.setPalette(paletteUniforms(readPalette()));
      resize();
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      drawing = true;
      set({ renderer: 'webgl', reason: null });
      loop.renderOnce();
    })
    .catch((err: unknown) => {
      // Any failure to start (a texture, a shader, the palette) falls back to the CSS room, never to
      // an empty stage.
      if (disposed) return;
      console.error('Stage failed to start; showing the CSS room', err);
      roomOk = false;
      loop.setMode(loopMode());
      set({ renderer: 'css', reason: 'error' });
    });

  return {
    renderer,
    loop,
    /** Chrome shown or hidden (PRODUCT_SPEC.md §6.1); the scrims fade with it. */
    setChrome(visible: boolean) {
      chromeTarget = visible ? 1 : 0;
      if (loop.mode === 'still') loop.renderOnce();
    },
    dispose() {
      disposed = true;
      loop.dispose();
      offHost();
      offDoc();
      field?.dispose();
      observer.disconnect();
      reduced.removeEventListener('change', onReducedChange);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer?.dispose();
      set({ renderer: 'pending', reason: null });
    },
  };
}

export type StageHandle = ReturnType<typeof mountStage>;
