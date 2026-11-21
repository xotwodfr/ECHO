import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types.ts';
import { searchKeyFor, searchSongs, showSearchSongs } from './searchKeys.ts';

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

describe('searchKeyFor (SRCH-01)', () => {
  it('↓ and ↑ move the highlight, wrapping through the typed text (-1)', () => {
    expect(searchKeyFor(key('ArrowDown'), -1, 3)).toEqual({ kind: 'move', to: 0 });
    expect(searchKeyFor(key('ArrowDown'), 1, 3)).toEqual({ kind: 'move', to: 2 });
    expect(searchKeyFor(key('ArrowDown'), 2, 3)).toEqual({ kind: 'move', to: -1 });
    expect(searchKeyFor(key('ArrowUp'), -1, 3)).toEqual({ kind: 'move', to: 2 });
    expect(searchKeyFor(key('ArrowUp'), 0, 3)).toEqual({ kind: 'move', to: -1 });
  });

  it('Enter plays, Shift+Enter queues, → opens the album: only with a song highlighted', () => {
    expect(searchKeyFor(key('Enter'), 1, 3)).toEqual({ kind: 'play', at: 1 });
    expect(searchKeyFor(key('Enter', { shift: true }), 1, 3)).toEqual({ kind: 'queue', at: 1 });
    expect(searchKeyFor(key('ArrowRight'), 0, 3)).toEqual({ kind: 'album', at: 0 });
    // Nothing highlighted: the keys keep their meaning in the field.
    expect(searchKeyFor(key('Enter'), -1, 3)).toBeNull();
    expect(searchKeyFor(key('ArrowRight'), -1, 3)).toBeNull();
    expect(searchKeyFor(key('Escape'), -1, 3)).toBeNull();
    // Shift+→ selects text.
    expect(searchKeyFor(key('ArrowRight', { shift: true }), 0, 3)).toBeNull();
  });

  it('Escape drops the highlight; modifiers and an empty result leave the field alone', () => {
    expect(searchKeyFor(key('Escape'), 2, 3)).toEqual({ kind: 'move', to: -1 });
    expect(searchKeyFor(key('ArrowDown'), -1, 0)).toBeNull();
    expect(searchKeyFor(key('ArrowDown', { ctrl: true }), -1, 3)).toBeNull();
    expect(searchKeyFor(key('Enter', { meta: true }), 0, 3)).toBeNull();
    expect(searchKeyFor(key('ArrowUp', { alt: true }), 0, 3)).toBeNull();
    expect(searchKeyFor(key('a'), 0, 3)).toBeNull();
  });
});

describe('showSearchSongs', () => {
  const t = (k: string) => ({ key: k }) as Track;
  beforeEach(() => searchSongs.setState({ tracks: [], context: null, active: -1 }));

  it('keeps the highlight while the same songs are shown, and drops it for new ones', () => {
    showSearchSongs([t('a'), t('b')], null);
    searchSongs.setState({ active: 1 });
    showSearchSongs([t('a'), t('b')], null);
    expect(searchSongs.getState().active).toBe(1);
    showSearchSongs([t('a'), t('c')], null);
    expect(searchSongs.getState().active).toBe(-1);
  });
});
