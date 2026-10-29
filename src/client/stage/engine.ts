import { DUR_PALETTE_MS } from '../palette/animator.ts';
import { paletteStore } from '../palette/live.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { prefsStore } from '../prefs.ts';
import {
  bendProfile,
  glassElements,
  glassParams,
  glassUniforms,
  onGlassChange,
  radii,
} from '../ui/glass.ts';
import type { FrameParams } from '../view.ts';
import { contrastAt, type Inks, peaksOf, type Solve, solveStep } from './contrast.ts';
import { createGovernor, firstTier, rememberedTier, rememberTier } from './governor.ts';
import {
  AMBIENT_FLOW_PER_S,
  chromeStep,
  createStageLoop,
  type LoopEnv,
  type StageMode,
} from './loop.ts';
import { createLyricField, type LyricField } from './lyrics/field.ts';
import { paletteUniforms, readPalette } from './palette.ts';
import { type FrameInput, StageRenderer, type Tier } from './renderer.ts';
import { createReverb } from './reverb.ts';
import { GLASS_MAX, GLASS_STEPS } from './shaders.ts';
import {
  lyricHost,
  lyricOffset,
  lyricPrefs,
  lyricsStore,
  scrubStore,
  stageStatus,
} from './status.ts';

// The Stage engine (TECHNICAL_ARCHITECTURE.md §4): mounted once by React, then imperative. Loaded
// lazily with three.js when the Stage first opens (PERF-05: three.js loads with the Stage).

/** VISUALIZER_SPEC.md §5.4: the contrast probe reads back every 250 ms. */
const PROBE_MS = 250;

/** The colours the lyric inks derive from, as currently set on :root. */
function readInks(): Inks {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    inkActive: v('--lyric-ink-active'),
    room: v('--art-room'),
    text: v('--text'),
    highlight: v('--art-highlight'),
  };
}

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

const perf: { frameMs: number[]; lyricsMs: number[]; tier: Tier } = {
  frameMs: [],
  lyricsMs: [],
  tier: 'T1',
};
function recordPerf(frameMs: number, lyricsMs: number, tier: Tier) {
  perf.frameMs.push(frameMs);
  perf.lyricsMs.push(lyricsMs);
  perf.tier = tier;
  if (perf.frameMs.length > 600) {
    perf.frameMs.shift();
    perf.lyricsMs.shift();
  }
  (window as unknown as { __echoPerf?: typeof perf }).__echoPerf = perf;
}

/** Settings → Visuals → Quality (per device): a fixed tier, or `auto` (T1 until the M9 governor). */
const TIERS: Record<string, Tier | undefined> = {
  high: 'T0',
  balanced: 'T1',
  low: 'T2',
  minimal: 'T3',
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
  // A fixed tier (deterministic mode, a caller, Settings → Visuals → Quality), else the governor's,
  // starting from this device's last stable tier (§8.2).
  const manualTier = frame?.tier ?? opts.tier ?? TIERS[prefsStore.getState().visuals.quality];
  let tier: Tier = manualTier ?? rememberedTier() ?? 'T1';
  const env = opts.env ?? browserEnv;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Settings → Visuals: motion (system, full, reduced, off) and the mode (SETTINGS_AND_SECURITY.md
  // §7.1). Still under reduced motion, at T3 and in deterministic mode (one frame, no loop);
  // otherwise Ambient, which becomes Reverb while audio features flow, unless Ambient is chosen.
  const visuals = () => prefsStore.getState().visuals;
  const stillWanted = () => {
    const v = visuals();
    return (
      v.mode === 'still' ||
      v.motion === 'off' ||
      v.motion === 'reduced' ||
      (v.motion === 'system' && reduced.matches)
    );
  };
  const modeNow = (): StageMode => (frame || stillWanted() || tier === 'T3' ? 'still' : 'ambient');
  const set = (patch: Partial<ReturnType<typeof stageStatus.getState>>) =>
    stageStatus.setState(patch);
  set({ renderer: 'pending', reason: null, mode: modeNow(), cover: 'none' });

  let renderer: StageRenderer | null = null;
  try {
    renderer = new StageRenderer(canvas, tier);
    // First run on this device: T0 on a discrete GPU, T1 otherwise.
    if (!manualTier && !rememberedTier()) {
      tier = firstTier(renderer.gpuName());
      renderer.setTier(tier);
    }
  } catch {
    set({ renderer: 'css', reason: 'no-webgl2' });
  }
  const governor = frame ? null : createGovernor({ tier, manual: !!manualTier, now: env.now });
  let trackStartedAt = env.now();
  let rememberAt = manualTier ? 0 : env.now() + 20_000; // a tier held 20 s is this device's

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

  // Reverb's state (§4.3–§4.5) at the intensity chosen in Settings → Visuals (Expressive default).
  let reverb = createReverb(visuals().intensity);

  // The contrast solver's state (DESIGN_SYSTEM.md §3.4): inks are re-read when the palette moves.
  let solve: Solve = { exposure: 0, scrim: 0 };
  let inks: Inks | null = null;
  let lastProbe = Number.NEGATIVE_INFINITY;
  /** One probe and solver step; true when the zone's darkening changed. */
  const contrastStep = (dtMs: number) => {
    const px = renderer?.probe();
    if (!px || !renderer) return false;
    inks ??= readInks();
    const peaks = peaksOf(px);
    const report = contrastAt(inks, peaks);
    const next = solveStep(solve, report, dtMs);
    if (__ECHO_FIXTURES__)
      Object.assign(window, { __echoContrast: { peaks, report, solve: next } });
    if (next.exposure === solve.exposure && next.scrim === solve.scrim) return false;
    solve = next;
    renderer.setZone(solve.exposure, solve.scrim);
    return true;
  };

  const loop = createStageLoop(
    {
      songTime: () => frame?.ms ?? scrubStore.getState().ms ?? c.songTime(),
      // In deterministic mode with `fixture=`, the controller serves the recorded Features
      // (§10), sampled at `frame.ms`. The lyric field reads them (LYRICS_EXPERIENCE.md §12); the
      // room does from M5.
      features: c.features,
      palette: { step() {} }, // the shell's PaletteAnimator writes :root; see offPalette below
      render: (f) => {
        const t0 = performance.now();
        let lyricsMs = 0;
        try {
          // Deterministic: the room as Ambient draws it after `ms` of playback at full rate.
          const flow = frame ? (AMBIENT_FLOW_PER_S * frame.ms) / 1000 : f.flow;
          const drift = frame ? frame.ms / 1000 : f.drift;
          const scrub = scrubStore.getState().ms !== null;
          const tl = performance.now();
          const key = field?.update({
            // The user's offset for this track shifts the lyric clock only, never the features
            // (LYRICS_EXPERIENCE.md §9.13): +150 ms shows the words 150 ms later.
            t: f.t - lyricOffset(),
            dt: f.dt,
            playing: playing(),
            mode: frame ? 'still' : scrub ? 'scrub' : 'run',
            features: f.features,
            reduced: reduced.matches || visuals().motion === 'reduced',
          });
          lyricsMs = performance.now() - tl;
          // In Still mode the loop ticks only for the lyric field; the room is drawn by renderOnce.
          if (!drawing || !renderer || (loop.mode === 'still' && f.dt > 0)) return;
          // The governor (§8.2) on frames that draw the room.
          const next = governor?.sample({
            dtMs: f.dt,
            trackMs: env.now() - trackStartedAt,
            scrubbing: scrub,
          });
          if (next) {
            tier = next;
            renderer.setTier(next);
            loop.setMode(loopMode()); // T3 is Still
            if (!manualTier) rememberAt = env.now() + 20_000;
          }
          if (rememberAt && env.now() >= rememberAt) {
            rememberTier(tier);
            rememberAt = 0;
          }
          // Reverb (§4): the moving room with live (or recorded) features; Ambient without them.
          const reverbOn =
            loop.mode === 'ambient' &&
            !frame &&
            f.features.available &&
            visuals().mode !== 'ambient';
          if (reverbOn !== (stageStatus.getState().mode === 'reverb'))
            set({ mode: reverbOn ? 'reverb' : modeNow() });
          const rv = reverbOn
            ? reverb.step(f.features, f.dt, key ? [key.x, key.y] : DEFAULT_KEY)
            : null;
          renderer.setReverb(rv);
          chrome = loop.mode === 'still' ? chromeTarget : chromeStep(chrome, chromeTarget, f.dt);
          const input = {
            flow: rv ? rv.flow : flow,
            drift,
            // The cover crossfades with the palette; a single frame shows the new one.
            cover: loop.mode === 'still' ? 1 : Math.min(1, (env.now() - coverAt) / DUR_PALETTE_MS),
            key: key ? [key.x, key.y] : DEFAULT_KEY,
            chrome,
            seed: frame?.seed ?? 0,
          } satisfies FrameInput;
          renderer.render(input);
          // Development: A11Y-08 records the stage's luminance grid while asked to.
          if (
            __ECHO_FIXTURES__ &&
            (window as { __echoLuma?: { t: number; grid: number[] }[] }).__echoLuma
          ) {
            const grid = renderer.lumaGrid();
            if (grid)
              (
                window as unknown as { __echoLuma: { t: number; grid: number[] }[] }
              ).__echoLuma.push({
                t: env.now(),
                grid: [...grid],
              });
          }
          // Contrast (DESIGN_SYSTEM.md §3.4): probe every 250 ms while running. A single frame (Still
          // mode, deterministic frames) probes until the solver settles, so it is drawn compliant.
          const now = env.now();
          if (loop.mode === 'still') {
            for (let i = 0; i < 12 && contrastStep(PROBE_MS); i++) renderer.render(input);
          } else if (now - lastProbe >= PROBE_MS) {
            contrastStep(Math.min(now - lastProbe, 1000));
            lastProbe = now;
          }
        } finally {
          // Development and E2E builds: per-frame costs for the performance checks (PERF-03,
          // LYR-26), the last 600 frames.
          if (__ECHO_FIXTURES__ && !frame) recordPerf(performance.now() - t0, lyricsMs, tier);
        }
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
      announce: lyricPrefs.getState().announce,
      onReady: () => {
        loop.renderOnce();
        loop.wake();
      },
    });
    void field.setDoc(lyricsStore.getState().doc);
  };
  const offHost = lyricHost.subscribe((s, prev) => s.el !== prev.el && mountField(s.el));
  const offPrefs = lyricPrefs.subscribe((s) => field?.setAnnounce(s.announce));
  // The palette animates the --art-* properties at shell level; the room follows them.
  const offPalette = paletteStore.subscribe((s, prev) => {
    if (s.version === prev.version || !drawing || !renderer) return;
    renderer.setPalette(paletteUniforms(readPalette()));
    inks = null;
    if (loop.mode === 'still') loop.renderOnce();
  });
  const offDoc = lyricsStore.subscribe((s) => void field?.setDoc(s.doc));
  mountField(lyricHost.getState().el);

  const onReducedChange = () => {
    loop.setMode(loopMode());
    set({ mode: modeNow() });
  };

  // Liquid glass (DESIGN_SYSTEM.md §7.11): the renderer's glass pass bends the room under the
  // Stage's glass controls; modal sheets and dialogs keep their own. One ResizeObserver on each
  // control and on the stage keeps the boxes current: a control that resizes (the brightness
  // slider) moves its neighbours too, so any change measures them all.
  const glassBoxes = new ResizeObserver(() => syncGlass());
  let glassWatched = new Set<HTMLElement>();
  const syncGlass = () => {
    const els = [...glassElements()].filter((el) => !(el instanceof HTMLDialogElement));
    for (const el of glassWatched) if (!els.includes(el)) glassBoxes.unobserve(el);
    for (const el of els) if (!glassWatched.has(el)) glassBoxes.observe(el);
    glassWatched = new Set(els);
    if (!renderer) return;
    const items = els.map((el) => ({
      box: el.getBoundingClientRect(),
      radii: radii(getComputedStyle(el), el.offsetWidth, el.offsetHeight),
    }));
    renderer.setGlass(glassUniforms(canvas.getBoundingClientRect(), items, GLASS_MAX));
    if (drawing && loop.mode === 'still') loop.renderOnce();
  };
  glassBoxes.observe(root);
  const offGlass = onGlassChange(syncGlass);

  // The room's base is the track's album cover, blurred (owner, 2026-10-28). Tracks of one album
  // share it; a cover that cannot be loaded (or used by WebGL: no CORS) leaves --art-room.
  let coverUrl: string | null = null;
  let coverAt = Number.NEGATIVE_INFINITY;
  const showCover = (url: string | null) => {
    if (url === coverUrl) return;
    coverUrl = url;
    const done = (img: HTMLImageElement | null) => {
      if (disposed || coverUrl !== url || !renderer) return;
      renderer.setCover(img);
      coverAt = env.now();
      loop.renderOnce();
      set({ cover: img ? 'shown' : 'none' });
    };
    if (!url) return done(null);
    set({ cover: 'loading' });
    const img = new Image();
    img.crossOrigin = 'anonymous'; // i.scdn.co answers with CORS headers; WebGL needs them
    img.src = url;
    img.decode().then(
      () => done(img),
      () => done(null),
    );
  };
  const artOf = (s: ReturnType<typeof c.player.getState>) => s.track?.artwork[0]?.url ?? null;

  // The governor holds still for the first 3 s of each track (§8.2).
  const offTrack = c.player.subscribe((s, prev) => {
    if (s.track?.key !== prev.track?.key) trackStartedAt = env.now();
    showCover(artOf(s));
  });
  const offVisuals = prefsStore.subscribe((s, prev) => {
    const [v, p] = [s.visuals, prev.visuals];
    if (v.backdrop !== p.backdrop) {
      renderer?.setBrightness(v.backdrop);
      if (loop.mode === 'still') loop.renderOnce();
    }
    if (v.mode === p.mode && v.motion === p.motion && v.intensity === p.intensity) return;
    if (v.intensity !== p.intensity) reverb = createReverb(v.intensity);
    onReducedChange();
  });
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
      renderer.setBrightness(visuals().backdrop);
      const cs = getComputedStyle(document.documentElement);
      renderer.setScrims(
        Number.parseFloat(cs.getPropertyValue('--scrim-top')),
        Number.parseFloat(cs.getPropertyValue('--scrim-dock')),
      );
      const g = glassParams(cs);
      renderer.setGlassLook({ ...g, bend: bendProfile(g, GLASS_STEPS) });
      syncGlass();
      showCover(artOf(c.player.getState()));
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
      offPalette();
      offPrefs();
      offVisuals();
      offTrack();
      offGlass();
      glassBoxes.disconnect();
      field?.dispose();
      observer.disconnect();
      reduced.removeEventListener('change', onReducedChange);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer?.dispose();
      set({ renderer: 'pending', reason: null, cover: 'none' });
    },
  };
}

export type StageHandle = ReturnType<typeof mountStage>;
