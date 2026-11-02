import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Track } from '../../shared/types.ts';
import type { Album, ArtistRef, Playlist, StarKind, Starred } from '../library.ts';
import { type Libraries, type Source, sourceOf, sourceStore } from '../source.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';

// The user's playlists and everything they have hearted, shared by Your Library, the pages and
// every heart button: one fetch per source at start, refreshed after a change, hearts updated at
// once and put back if the server refuses. Kept per source (Navidrome, Spotify): pages show the
// active source's; a heart goes to its item's own source, whichever is active.

interface Lists {
  playlists: Playlist[] | 'error' | null;
  starred: Starred | 'error' | null;
}
type Collections = Record<Source, Lists>;

const NONE: Lists = { playlists: null, starred: null };
export const collections = createStore<Collections>()(() => ({ navidrome: NONE, spotify: NONE }));

let libraries: Libraries = { navidrome: null, spotify: null };
const active = () => sourceStore.getState().source;
const put = (s: Source, patch: Partial<Lists>) =>
  collections.setState((c) => ({ [s]: { ...c[s], ...patch } }) as Partial<Collections>);

export function startCollections(libs: Libraries) {
  libraries = libs;
  for (const s of ['navidrome', 'spotify'] as const) {
    if (!libs[s]) continue;
    void refreshPlaylists(s);
    void refreshStarred(s);
  }
}

/** A source, or the active one: also when called as an event handler (`onRetry={refreshPlaylists}`). */
const sourceOrActive = (s: unknown): Source =>
  s === 'navidrome' || s === 'spotify' ? s : active();

export async function refreshPlaylists(source?: Source) {
  const s = sourceOrActive(source);
  const lib = libraries[s];
  if (!lib?.playlists) return put(s, { playlists: [] });
  put(s, { playlists: await lib.playlists().catch(() => 'error' as const) });
}

export async function refreshStarred(source?: Source) {
  const s = sourceOrActive(source);
  const lib = libraries[s];
  if (!lib?.starredAll) return put(s, { starred: EMPTY });
  put(s, { starred: await lib.starredAll().catch(() => 'error' as const) });
}

const EMPTY: Starred = { tracks: [], albums: [], artists: [] };
const LIST = { track: 'tracks', album: 'albums', artist: 'artists' } as const;

type Item = { track: Track; album: Album; artist: ArtistRef };

/** An item's own source: a track by its provider, the rest by their id (Spotify's are prefixed). */
export function sourceOfItem<K extends StarKind>(kind: K, item: Item[K]): Source {
  if (kind === 'track') return (item as Track).provider === 'spotify' ? 'spotify' : 'navidrome';
  return sourceOf(item.id);
}

/** Whether `source`'s library can heart (the active one when not given). */
export const canStar = (source: Source = active()) => !!libraries[source]?.setStar;

/** Heart or un-heart; the heart changes at once and changes back if the server says no. */
export async function setStar<K extends StarKind>(kind: K, item: Item[K], on: boolean) {
  const s = sourceOfItem(kind, item);
  const lib = libraries[s];
  if (!lib?.setStar) return;
  const before = collections.getState()[s].starred;
  const now = before === 'error' || !before ? EMPTY : before;
  const list = now[LIST[kind]] as Item[K][];
  const next = on
    ? [item, ...list.filter((x) => x.id !== item.id)]
    : list.filter((x) => x.id !== item.id);
  put(s, { starred: { ...now, [LIST[kind]]: next } });
  toastStore.getState().show(on ? strings.liked.added : strings.liked.removed);
  try {
    await lib.setStar(kind, item.id, on);
  } catch {
    put(s, { starred: before });
    toastStore.getState().show(strings.liked.failed);
  }
}

/** Whether an item is hearted, in `source` (by default: a prefixed id's, else Navidrome). */
export function useStarred<K extends StarKind>(
  kind: K,
  id: string | undefined,
  source: Source = id ? sourceOf(id) : 'navidrome',
): boolean {
  return useStore(collections, (c) => {
    const st = c[source].starred;
    return id && st !== null && st !== 'error' ? st[LIST[kind]].some((x) => x.id === id) : false;
  });
}

const useActive = () => useStore(sourceStore, (s) => s.source);
export const usePlaylists = () => {
  const s = useActive();
  return useStore(collections, (c) => c[s].playlists);
};
export const useStarredAll = () => {
  const s = useActive();
  return useStore(collections, (c) => c[s].starred);
};

/** A new playlist ("My Playlist #n", as Spotify), optionally with tracks; resolves with its id. */
export async function createPlaylist(tracks: Track[] = []): Promise<string | null> {
  const library = libraries[active()];
  if (!library?.createPlaylist) return null;
  const have = collections.getState()[active()].playlists;
  const n = (Array.isArray(have) ? have.length : 0) + 1;
  try {
    const id = await library.createPlaylist(
      strings.playlist.defaultName(n),
      tracks.map((t) => t.id),
    );
    await refreshPlaylists();
    return id;
  } catch {
    toastStore.getState().show(strings.playlist.failed);
    return null;
  }
}

export async function addToPlaylist(playlist: Playlist, tracks: Track[]) {
  const library = libraries[active()];
  if (!library?.updatePlaylist) return;
  try {
    await library.updatePlaylist(playlist.id, { add: tracks.map((t) => t.id) });
    toastStore.getState().show(strings.playlist.added(playlist.name));
    await refreshPlaylists();
  } catch {
    toastStore.getState().show(strings.playlist.failed);
  }
}
