import { describe, expect, it } from 'vitest';
import { type KeyTarget, shortcutFor } from './shortcuts.ts';

const key = (
  k: string,
  mods: Partial<Record<'shift' | 'ctrl' | 'meta' | 'alt', boolean>> = {},
) => ({
  key: k,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
});

describe('shortcutFor (PRODUCT_SPEC.md §7)', () => {
  it.each([
    [' ', {}, 'toggle'],
    ['ArrowLeft', {}, 'seekBack'],
    ['ArrowRight', {}, 'seekForward'],
    ['ArrowLeft', { shift: true }, 'seekBackFar'],
    ['ArrowRight', { shift: true }, 'seekForwardFar'],
    ['ArrowLeft', { ctrl: true }, 'previous'],
    ['ArrowRight', { meta: true }, 'next'],
    ['m', {}, 'mute'],
    ['M', { shift: true }, 'mute'],
    ['s', {}, 'shuffle'],
    ['r', {}, 'repeat'],
    ['q', {}, 'queue'],
    ['B', { alt: true, shift: true }, 'like'],
  ] as const)('%s %o → %s', (k, mods, action) => {
    expect(shortcutFor(key(k, mods), 'other', false)).toBe(action);
  });

  it('G then L / S / P navigates; F full screen; ? the shortcut list (A11Y-01)', () => {
    expect(shortcutFor(key('g'), 'other', false)).toBe('goPrefix');
    expect(shortcutFor(key('l'), 'other', false, true)).toBe('goLibrary');
    expect(shortcutFor(key('s'), 'other', true, true)).toBe('goSettings'); // not shuffle
    expect(shortcutFor(key('p'), 'other', false, true)).toBe('goListen');
    expect(shortcutFor(key('x'), 'other', false, true)).toBeNull();
    expect(shortcutFor(key('f'), 'other', true)).toBe('fullscreen');
    expect(shortcutFor(key('?', { shift: true }), 'other', false)).toBe('help');
    expect(shortcutFor(key('g'), 'text', false)).toBeNull();
    expect(shortcutFor(key('b', { alt: true }), 'other', false)).toBeNull(); // Alt+B: the browser's
  });

  it('[ and ] shift the lyrics on the Stage only (LYR-25)', () => {
    expect(shortcutFor(key('['), 'other', true)).toBe('lyricsEarlier');
    expect(shortcutFor(key(']'), 'other', true)).toBe('lyricsLater');
    expect(shortcutFor(key(']'), 'other', false)).toBeNull();
    expect(shortcutFor(key('['), 'text', true)).toBeNull();
  });

  it('view keys only on the Stage: V cycles, C cover, L lyrics', () => {
    expect(shortcutFor(key('v'), 'other', true)).toBe('viewCycle');
    expect(shortcutFor(key('c'), 'other', true)).toBe('viewCover');
    expect(shortcutFor(key('L', { shift: true }), 'other', true)).toBe('viewLyrics');
    expect(shortcutFor(key('v'), 'control', true)).toBe('viewCycle');
    for (const k of ['v', 'c', 'l']) expect(shortcutFor(key(k), 'other', false)).toBeNull();
    expect(shortcutFor(key('c', { ctrl: true }), 'other', true)).toBeNull(); // copy
  });

  it('volume on ↑/↓ only on the Stage', () => {
    expect(shortcutFor(key('ArrowUp'), 'other', true)).toBe('volumeUp');
    expect(shortcutFor(key('ArrowDown'), 'other', true)).toBe('volumeDown');
    expect(shortcutFor(key('ArrowUp'), 'other', false)).toBeNull();
    expect(shortcutFor(key('ArrowDown'), 'other', false)).toBeNull();
  });

  it('never fires in a text field, with Alt, or with Ctrl/⌘ on letters', () => {
    for (const k of [' ', 'ArrowLeft', 'm', 'q'])
      expect(shortcutFor(key(k), 'text', true)).toBeNull();
    expect(shortcutFor(key('m', { alt: true }), 'other', false)).toBeNull();
    expect(shortcutFor(key('r', { ctrl: true }), 'other', false)).toBeNull(); // browser reload
    expect(shortcutFor(key('q', { meta: true }), 'other', false)).toBeNull();
    expect(shortcutFor(key('x'), 'other', false)).toBeNull();
  });

  it('a focused control keeps Space and the arrows; letters still work', () => {
    const control: KeyTarget = 'control';
    for (const k of [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
      expect(shortcutFor(key(k), control, true)).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { ctrl: true }), control, false)).toBeNull();
    expect(shortcutFor(key('m'), control, false)).toBe('mute');
  });
});
