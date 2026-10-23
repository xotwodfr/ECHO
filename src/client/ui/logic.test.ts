import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createToastStore,
  formatTime,
  gain,
  menuMove,
  scrubberText,
  sliderKey,
  spokenTime,
  TOAST_EXIT_MS,
  TOAST_VISIBLE_MS,
  valueAt,
} from './logic.ts';

describe('time', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [102_000, '1:42'],
    [245_000, '4:05'],
    [3_725_000, '1:02:05'],
    [-5, '0:00'],
  ])('formatTime(%i) = %s', (ms, text) => expect(formatTime(ms)).toBe(text));

  it.each([
    [0, '0 seconds'],
    [1000, '1 second'],
    [60_000, '1 minute'],
    [102_000, '1 minute 42 seconds'],
    [3_601_000, '1 hour 1 second'],
  ])('spokenTime(%i) = %s', (ms, text) => expect(spokenTime(ms)).toBe(text));

  // A11Y-10 / DESIGN_SYSTEM.md §9.2 wording.
  it('scrubber value text', () => {
    expect(scrubberText(102_000, 245_000)).toBe('1 minute 42 seconds of 4 minutes 5 seconds');
  });
});

describe('sliderKey', () => {
  const scrub = { min: 0, max: 245_000, step: 5000, bigStep: 15_000 };
  it.each([
    ['ArrowRight', false, 107_000],
    ['ArrowUp', false, 107_000],
    ['ArrowLeft', false, 97_000],
    ['ArrowDown', false, 97_000],
    ['ArrowRight', true, 117_000],
    ['ArrowLeft', true, 87_000],
    ['PageUp', false, 117_000],
    ['PageDown', false, 87_000],
    ['Home', false, 0],
    ['End', false, 245_000],
  ] as const)('%s (shift %s) from 1:42 → %i', (key, shift, to) => {
    expect(sliderKey(102_000, key, shift, scrub)).toBe(to);
  });

  it('clamps at the ends and ignores other keys', () => {
    expect(sliderKey(2000, 'ArrowLeft', false, scrub)).toBe(0);
    expect(sliderKey(243_000, 'ArrowRight', true, scrub)).toBe(245_000);
    expect(sliderKey(1000, 'a', false, scrub)).toBeNull();
    expect(sliderKey(1000, 'Enter', false, scrub)).toBeNull();
  });

  it('keeps volume steps exact', () => {
    const vol = { min: 0, max: 1, step: 0.05, bigStep: 0.2 };
    expect(sliderKey(0.4, 'ArrowRight', false, vol)).toBe(0.45);
    expect(sliderKey(0.1, 'ArrowLeft', false, vol)).toBe(0.05);
  });
});

describe('pointer and volume maths', () => {
  it('valueAt maps and clamps the pointer', () => {
    expect(valueAt(150, 100, 200, 0, 1000)).toBe(250);
    expect(valueAt(50, 100, 200, 0, 1000)).toBe(0);
    expect(valueAt(400, 100, 200, 0, 1000)).toBe(1000);
    expect(valueAt(150, 100, 0, 0, 1000)).toBe(0);
  });

  it('gain is perceptual (v³) and clamped', () => {
    expect(gain(0.5)).toBe(0.125);
    expect(gain(1)).toBe(1);
    expect(gain(2)).toBe(1);
    expect(gain(-1)).toBe(0);
  });
});

describe('menuMove', () => {
  const none = [false, false, false, false];
  const some = [false, true, false, true]; // items 1 and 3 disabled

  it('opens on the first or last enabled item', () => {
    expect(menuMove(-1, 'ArrowDown', some)).toBe(0);
    expect(menuMove(-1, 'ArrowUp', some)).toBe(2);
    expect(menuMove(-1, 'Home', [true, false])).toBe(1);
  });

  it('wraps and skips disabled items', () => {
    expect(menuMove(3, 'ArrowDown', none)).toBe(0);
    expect(menuMove(0, 'ArrowUp', none)).toBe(3);
    expect(menuMove(0, 'ArrowDown', some)).toBe(2);
    expect(menuMove(2, 'ArrowDown', some)).toBe(0);
    expect(menuMove(2, 'End', some)).toBe(2);
  });

  it('leaves other keys and all-disabled menus alone', () => {
    expect(menuMove(1, 'a', none)).toBe(1);
    expect(menuMove(-1, 'ArrowDown', [true, true])).toBe(-1);
  });
});

describe('toast store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows one toast for 4 s, then leaves over the exit duration', () => {
    const store = createToastStore();
    store.getState().show('Lyrics −100 ms');
    expect(store.getState().toast).toMatchObject({ message: 'Lyrics −100 ms', leaving: false });
    vi.advanceTimersByTime(TOAST_VISIBLE_MS - 1);
    expect(store.getState().toast?.leaving).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.getState().toast?.leaving).toBe(true);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(store.getState().toast).toBeNull();
  });

  it('a new toast replaces the visible one and gets its own full time', () => {
    const store = createToastStore();
    store.getState().show('Added to queue');
    vi.advanceTimersByTime(3000);
    store.getState().show('Saved');
    expect(store.getState().toast?.message).toBe('Saved');
    vi.advanceTimersByTime(3000);
    expect(store.getState().toast).toMatchObject({ message: 'Saved', leaving: false });
    vi.advanceTimersByTime(1000 + TOAST_EXIT_MS);
    expect(store.getState().toast).toBeNull();
  });
});
