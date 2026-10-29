import { createStore } from 'zustand/vanilla';

// What the frame shows around the page (DESIGN_SYSTEM.md §5): the right panel (Now Playing, the
// queue, or closed) and Your Library's filter, order and view. Kept on this device between visits.

export type RightPanel = 'nowPlaying' | 'queue' | null;
export type LibraryFilter = 'all' | 'playlists' | 'albums' | 'artists';
export type LibrarySort = 'recents' | 'added' | 'alpha' | 'year';

interface Panels {
  right: RightPanel;
  filter: LibraryFilter;
  sort: LibrarySort;
  /** The Library panel narrowed to covers only. */
  collapsed: boolean;
}

const KEY = 'echo.panels';
const DEFAULTS: Panels = { right: 'nowPlaying', filter: 'all', sort: 'recents', collapsed: false };

function load(): Panels {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export const panels = createStore<Panels>()(load);

panels.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode or storage full: the panels still work, they just don't persist
  }
});

/** The queue button: shows the queue, or closes the panel when it already shows it. */
export const toggleRight = (which: Exclude<RightPanel, null>) =>
  panels.setState((s) => ({ right: s.right === which ? null : which }));
