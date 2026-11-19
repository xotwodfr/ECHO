import { createStore } from 'zustand/vanilla';
import { api } from '../api.ts';
import { TOAST_VISIBLE_MS } from '../ui/logic.ts';

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
    const items = await api<WantedItem[]>('/wanted');
    // An item removed a moment ago is still on the server until its Undo has gone.
    wantedStore.setState({ items: items.filter((x) => !pending.has(x.id)) });
  } catch {
    // A list already on screen stays; only a first load that fails says so.
    if (!Array.isArray(wantedStore.getState().items)) wantedStore.setState({ items: 'error' });
  }
}

/** Adds `text`: the item, and whether it was already on the list; null when the server refused. */
export async function addWanted(text: string) {
  try {
    const item = await api<WantedItem>('/wanted', { method: 'POST', body: { text } });
    // Adding again what was just removed keeps it: the server answered with the same item.
    pending.get(item.id)?.cancel();
    const known = listed().some((x) => x.id === item.id);
    wantedStore.setState({ items: [item, ...listed().filter((x) => x.id !== item.id)] });
    return { item, known };
  } catch {
    return null;
  }
}

/** How long a removal can be undone: as long as its toast (and its Undo) is on screen. */
export const UNDO_MS = TOAST_VISIBLE_MS;

export type Removal = 'removed' | 'undone' | 'failed';

/** Removals waiting for their Undo to go: `cancel` puts the item back, `send` removes it now. */
const pending = new Map<number, { cancel: () => void; send: (leaving?: boolean) => void }>();

/** Closing the tab is not an undo: a removal still waiting goes to the server as the page leaves. */
export function sendWaitingRemovals() {
  for (const p of [...pending.values()]) p.send(true);
}
if (typeof addEventListener === 'function') addEventListener('pagehide', sendWaitingRemovals);

/** Puts `item` back where it was, unless the list already has it again. */
function restore(item: WantedItem, index: number) {
  const items = wantedStore.getState().items;
  if (!Array.isArray(items) || items.some((x) => x.id === item.id)) return;
  wantedStore.setState({ items: [...items.slice(0, index), item, ...items.slice(index)] });
}

/**
 * Removes an item from the list at once, and from the server once it can no longer be undone
 * (B8: one tap removed anyone's item for everyone, with no way back). `undo` before then puts it
 * back as it was, who added it and when included; nothing reached the server. Leaving the page
 * sends it at once. `done` says how it ended; on "failed" the item is back.
 */
export function removeWanted(id: number, delayMs = UNDO_MS) {
  const index = listed().findIndex((x) => x.id === id);
  const item = listed()[index];
  if (!item) return { undo: () => {}, done: Promise.resolve<Removal>('removed') };
  pending.get(id)?.cancel();
  wantedStore.setState({ items: listed().filter((x) => x.id !== id) });
  let finish: (r: Removal) => void = () => {};
  const done = new Promise<Removal>((resolve) => {
    finish = resolve;
  });
  const mine = () => pending.get(id)?.cancel === cancel; // not yet sent or undone
  const send = async (leaving = false) => {
    if (!mine()) return;
    clearTimeout(timer);
    pending.delete(id);
    try {
      await api(`/wanted/${id}`, { method: 'DELETE', ...(leaving && { keepalive: true }) });
      finish('removed');
    } catch {
      restore(item, index);
      finish('failed');
    }
  };
  const cancel = () => {
    if (!mine()) return;
    clearTimeout(timer);
    pending.delete(id);
    restore(item, index);
    finish('undone');
  };
  const timer = setTimeout(() => void send(), delayMs);
  pending.set(id, { cancel, send: (leaving) => void send(leaving) });
  return { undo: cancel, done };
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
