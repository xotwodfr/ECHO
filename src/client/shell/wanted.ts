import { createStore } from 'zustand/vanilla';
import { api } from '../api.ts';

// The Wanted list (server: wanted.ts): one list for everyone on the server, of music that is not in
// Navidrome yet. Loaded at start and again when its page opens (the server then looks for what is
// still missing), and changed in place after an add or a remove.

export interface WantedItem {
  id: number;
  text: string;
  /** The username; null once that user is deleted. */
  addedBy: string | null;
  addedAt: number;
  found: {
    kind: 'album' | 'song';
    id: string;
    title: string;
    artist: string;
    albumId?: string;
  } | null;
}

export const wantedStore = createStore<{ items: WantedItem[] | null | 'error' }>()(() => ({
  items: null,
}));

const listed = () => {
  const items = wantedStore.getState().items;
  return Array.isArray(items) ? items : [];
};

export async function loadWanted() {
  try {
    wantedStore.setState({ items: await api<WantedItem[]>('/wanted') });
  } catch {
    // A list already on screen stays; only a first load that fails says so.
    if (!Array.isArray(wantedStore.getState().items)) wantedStore.setState({ items: 'error' });
  }
}

/** Adds `text`: the item, and whether it was already on the list; null when the server refused. */
export async function addWanted(text: string) {
  try {
    const item = await api<WantedItem>('/wanted', { method: 'POST', body: { text } });
    const known = listed().some((x) => x.id === item.id);
    wantedStore.setState({ items: [item, ...listed().filter((x) => x.id !== item.id)] });
    return { item, known };
  } catch {
    return null;
  }
}

/** Removes an item at once; it comes back if the server says no. Resolves false then. */
export async function removeWanted(id: number) {
  const before = wantedStore.getState().items;
  wantedStore.setState({ items: listed().filter((x) => x.id !== id) });
  try {
    await api(`/wanted/${id}`, { method: 'DELETE' });
    return true;
  } catch {
    wantedStore.setState({ items: before });
    return false;
  }
}

/** The same search on YouTube Music, for music that is not in Navidrome. */
export const youTubeMusicSearch = (q: string) =>
  `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const;

/** "yesterday", "3 days ago", "last week": when an item was added. */
export function ago(ms: number, now = Date.now()) {
  const d = now - ms;
  for (const [unit, size] of UNITS) if (d >= size) return rtf.format(-Math.floor(d / size), unit);
  return 'just now';
}
