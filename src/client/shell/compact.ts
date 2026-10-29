import { useSyncExternalStore } from 'react';

// Phones (< 720px, DESIGN_SYSTEM.md §5) get a different arrangement in places CSS cannot reach:
// the queue as a sheet, the mini player opening the lyrics view, Your Library as a list. Below
// "wide" there is no right panel, so the queue is a sheet there too.

const COMPACT = '(max-width: 719.98px)';
/** Wide enough for the right panel beside the page (main.css: the panel shows from 1400px). */
const WIDE = '(min-width: 1400px)';

const query = (q: string) => {
  const subscribe = (f: () => void) => {
    const m = window.matchMedia(q);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  };
  return () => useSyncExternalStore(subscribe, () => window.matchMedia(q).matches);
};

export const useCompact = query(COMPACT);
export const useWide = query(WIDE);
