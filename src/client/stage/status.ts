import { createStore } from 'zustand/vanilla';
import type { LyricsDoc } from '../../shared/types.ts';
import type { StageMode } from './loop.ts';

// What the Stage is showing, for the shell (data attributes, the Settings notice). Kept out of the
// lazily loaded engine so it costs nothing until the Stage opens.

export interface StageStatus {
  renderer: 'pending' | 'webgl' | 'css';
  /** Why the CSS room is showing (VISUALIZER_SPEC.md §9). */
  reason: 'no-webgl2' | 'context-lost' | 'error' | null;
  /** The loop's pace, or Reverb when it runs with live features (VISUALIZER_SPEC.md §4). */
  mode: StageMode | 'reverb';
}

export const stageStatus = createStore<StageStatus>()(() => ({
  renderer: 'pending',
  reason: null,
  mode: 'ambient',
}));

let supported: boolean | null = null;

/** Whether this browser can create a WebGL 2 context (checked once, and released at once). */
export function webgl2Supported() {
  if (supported === null) {
    const gl = document.createElement('canvas').getContext('webgl2');
    supported = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return supported;
}

/** The Stage's view modes (PRODUCT_SPEC.md §6.1): Lyrics, Cover, Visual (environment only). */
export const STAGE_VIEWS = ['lyrics', 'cover', 'visual'] as const;
export type StageView = (typeof STAGE_VIEWS)[number];

export const stageView = createStore<{ view: StageView; set(view: StageView): void }>()((set) => ({
  view: 'lyrics',
  set: (view) => set({ view }),
}));

/** V: Lyrics → Cover → Visual → Lyrics. */
export const nextView = (v: StageView): StageView =>
  STAGE_VIEWS[(STAGE_VIEWS.indexOf(v) + 1) % STAGE_VIEWS.length] as StageView;

/** Whether the Stage chrome is hidden after idle (PRODUCT_SPEC.md §6.1). */
export const stageChrome = createStore<{ hidden: boolean }>()(() => ({ hidden: false }));

/**
 * The current track's lyrics (TECHNICAL_ARCHITECTURE.md §5.4 `lyricsStore`). M3 fills it from the
 * fixture documents of the guide tracks; the lyrics loader writes it from M6.
 */
export const lyricsStore = createStore<{ trackKey: string | null; doc: LyricsDoc | null }>()(
  () => ({ trackKey: null, doc: null }),
);

/** The scrubber's time while it is dragged (LYRICS_EXPERIENCE.md §9.6 scrub mode), else null. */
export const scrubStore = createStore<{ ms: number | null }>()(() => ({ ms: null }));

/** Where the lyric field draws: set by the Lyrics view, mounted into by the engine. */
export const lyricHost = createStore<{ el: HTMLElement | null }>()(() => ({ el: null }));

/** Lyric preferences (Settings → Lyrics, M8): "Announce lyric lines" is opt-in, default off. */
export const lyricPrefs = createStore<{ announce: boolean }>()(() => ({ announce: false }));
