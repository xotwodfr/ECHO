import { createStore } from 'zustand/vanilla';
import type { PlayContext, Track } from '../../shared/types.ts';

// Search from the keyboard (SRCH-01): with the search field focused, ↑/↓ move a highlight over the
// songs in the results, Enter plays the highlighted one, Shift+Enter adds it to the queue, and →
// opens its album. Focus stays in the field, so typing goes on refining the search. Nothing is
// highlighted at first: the arrows' -1 is the typed text, and past either end they wrap back to it.

export type SearchKeyAction =
  | { kind: 'move'; to: number }
  | { kind: 'play' | 'queue' | 'album'; at: number };

type Key = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

/** What a key in the search field does, given the highlight (-1: none) and the songs shown. */
export function searchKeyFor(e: Key, active: number, count: number): SearchKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || count === 0) return null;
  const on = active >= 0 && active < count;
  switch (e.key) {
    case 'ArrowDown':
      return { kind: 'move', to: active + 1 >= count ? -1 : active + 1 };
    case 'ArrowUp':
      return { kind: 'move', to: active <= -1 ? count - 1 : active - 1 };
    case 'Enter':
      return on ? { kind: e.shiftKey ? 'queue' : 'play', at: active } : null;
    // With nothing highlighted, → and Escape keep their meaning in a text field (the caret; clear).
    case 'ArrowRight':
      return on && !e.shiftKey ? { kind: 'album', at: active } : null;
    case 'Escape':
      return on ? { kind: 'move', to: -1 } : null;
  }
  return null;
}

export interface SearchSongs {
  /** The songs the results show, in order, and what playing one of them plays from. */
  tracks: Track[];
  context: PlayContext | null;
  active: number;
}

/** The results publish their songs here; the search field moves the highlight over them. */
export const searchSongs = createStore<SearchSongs>()(() => ({
  tracks: [],
  context: null,
  active: -1,
}));

/** New results: the highlight goes back to the typed text unless the same songs are shown. */
export function showSearchSongs(tracks: Track[], context: PlayContext | null) {
  const was = searchSongs.getState();
  const same =
    was.tracks.length === tracks.length && was.tracks.every((t, i) => t.key === tracks[i]?.key);
  searchSongs.setState({ tracks, context, active: same ? was.active : -1 });
}

/** The id of the row for song `i` of the results (the highlight scrolls it into view). */
export const searchRowId = (i: number) => `search-song-${i}`;
