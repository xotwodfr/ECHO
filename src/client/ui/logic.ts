import { createStore } from 'zustand/vanilla';

// Pure logic behind the UI components (DESIGN_SYSTEM.md §9), kept out of React so Vitest covers it.

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** `1:42`, `1:02:05`. Tabular in the UI (`.num`). */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Spoken form for `aria-valuetext`: "1 minute 42 seconds". */
export function spokenTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts: [number, string][] = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor((total % 3600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`);
  return words.length ? words.join(' ') : '0 seconds';
}

/** Scrubber `aria-valuetext` (§9.2): "1 minute 42 seconds of 4 minutes 5 seconds". */
export const scrubberText = (posMs: number, durMs: number) =>
  `${spokenTime(posMs)} of ${spokenTime(durMs)}`;

export interface SliderRange {
  min: number;
  max: number;
  step: number;
  /** Shift+Arrow and PageUp/PageDown. */
  bigStep: number;
}

/**
 * The value a key moves a slider to, or null when the key is not a slider key.
 * ←/↓ −step, →/↑ +step, Shift ±bigStep, PageUp/PageDown ±bigStep, Home/End to the ends.
 */
export function sliderKey(value: number, key: string, shift: boolean, r: SliderRange) {
  const step = shift ? r.bigStep : r.step;
  const moves: Record<string, number> = {
    ArrowLeft: value - step,
    ArrowDown: value - step,
    ArrowRight: value + step,
    ArrowUp: value + step,
    PageDown: value - r.bigStep,
    PageUp: value + r.bigStep,
    Home: r.min,
    End: r.max,
  };
  const next = moves[key];
  // Rounded so 0.4 + 0.05 is 0.45, not 0.45000000000000007.
  return next === undefined ? null : clamp(Math.round(next * 1e6) / 1e6, r.min, r.max);
}

/** The value under a pointer at `x` on a track spanning `left`…`left + width`. */
export const valueAt = (x: number, left: number, width: number, min: number, max: number) =>
  width <= 0 ? min : min + clamp((x - left) / width, 0, 1) * (max - min);

/** Perceptual volume curve (§9.2): the slider shows `v`, the audio gets `v³`. */
export const gain = (v: number) => clamp(v, 0, 1) ** 3;

/**
 * Roving focus in a menu: the next enabled item for a key, wrapping. `from` = -1 means nothing is
 * focused yet. Returns `from` for keys a menu does not handle.
 */
export function menuMove(from: number, key: string, disabled: readonly boolean[]): number {
  const n = disabled.length;
  const enabled = disabled.flatMap((d, i) => (d ? [] : [i]));
  if (!enabled.length) return -1;
  const first = enabled[0] as number;
  const last = enabled.at(-1) as number;
  if (key === 'Home') return first;
  if (key === 'End') return last;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return from;
  const dir = key === 'ArrowDown' ? 1 : -1;
  if (from < 0) return dir === 1 ? first : last;
  for (let i = 1; i <= n; i++) {
    const j = (((from + dir * i) % n) + n) % n;
    if (!disabled[j]) return j;
  }
  return from;
}

// Toast (§9.6): max 1 visible, 4 s, then out over --dur-toast before it is removed.
export const TOAST_VISIBLE_MS = 4000;
export const TOAST_EXIT_MS = 250; // = --dur-toast

export interface ToastState {
  toast: { id: number; message: string; leaving: boolean } | null;
  show(message: string): void;
}

export function createToastStore() {
  let id = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  return createStore<ToastState>()((set) => ({
    toast: null,
    show(message) {
      // A new toast replaces the visible one at once.
      for (const t of timers) clearTimeout(t);
      const mine = ++id;
      set({ toast: { id: mine, message, leaving: false } });
      timers = [
        setTimeout(() => set({ toast: { id: mine, message, leaving: true } }), TOAST_VISIBLE_MS),
        setTimeout(() => set({ toast: null }), TOAST_VISIBLE_MS + TOAST_EXIT_MS),
      ];
    },
  }));
}

export const toastStore = createToastStore();
