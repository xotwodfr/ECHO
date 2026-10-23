import { createStore } from 'zustand/vanilla';
import type { StageMode } from './loop.ts';

// What the Stage is showing, for the shell (data attributes, the Settings notice). Kept out of the
// lazily loaded engine so it costs nothing until the Stage opens.

export interface StageStatus {
  renderer: 'pending' | 'webgl' | 'css';
  /** Why the CSS room is showing (VISUALIZER_SPEC.md §9). */
  reason: 'no-webgl2' | 'context-lost' | 'error' | null;
  mode: StageMode;
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
