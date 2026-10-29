import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Track } from '../../shared/types.ts';
import type { Album, ArtistRef, Library, Playlist, StarKind, Starred } from '../library.ts';
import { strings } from '../strings.ts';
import { toastStore } from '../ui/logic.ts';

// The user's playlists and everything they have hearted, shared by Your Library, the pages and
// every heart button: one fetch at start, refreshed after a change, hearts updated at once and put
// back if the server refuses.

interface Collections {
  playlists: Playlist[] | 'error' | null;
  starred: Starred | 'error' | null;
}

export const collections = createStore<Collections>()(() => ({ playlists: null, starred: null }));

let library: Library | null = null;

export function startCollections(lib: Library | null) {
  library = lib;
  void refreshPlaylists();
  void refreshStarred();
}

export async function refreshPlaylists() {
  if (!library?.playlists) return collections.setState({ playlists: [] });
  const playlists = await library.playlists().catch(() => 'error' as const);
  collections.setState({ playlists });
}

export async function refreshStarred() {
  if (!library?.starredAll) return collections.setState({ starred: EMPTY });
  const starred = await library.starredAll().catch(() => 'error' as const);
  collections.setState({ starred });
}

const EMPTY: Starred = { tracks: [], albums: [], artists: [] };
const LIST = { track: 'tracks', album: 'albums', artist: 'artists' } as const;

type Item = { track: Track; album: Album; artist: ArtistRef };

export const canStar = () => !!library?.setStar;

/** Heart or un-heart; the heart changes at once and changes back if the server says no. */
export async function setStar<K extends StarKind>(kind: K, item: Item[K], on: boolean) {
  if (!library?.setStar) return;
  const before = collections.getState().starred;
  const now = before === 'error' || !before ? EMPTY : before;
  const list = now[LIST[kind]] as Item[K][];
  const next = on
    ? [item, ...list.filter((x) => x.id !== item.id)]
    : list.filter((x) => x.id !== item.id);
  collections.setState({ starred: { ...now, [LIST[kind]]: next } });
  toastStore.getState().show(on ? strings.liked.added : strings.liked.removed);
  try {
    await library.setStar(kind, item.id, on);
  } catch {
    collections.setState({ starred: before });
    toastStore.getState().show(strings.liked.failed);
  }
}

export function useStarred<K extends StarKind>(kind: K, id: string | undefined): boolean {
  return useStore(collections, (s) =>
    id && s.starred !== null && s.starred !== 'error'
      ? s.starred[LIST[kind]].some((x) => x.id === id)
      : false,
  );
}

export const usePlaylists = () => useStore(collections, (s) => s.playlists);
export const useStarredAll = () => useStore(collections, (s) => s.starred);

/** A new playlist ("My Playlist #n", as Spotify), optionally with tracks; resolves with its id. */
export async function createPlaylist(tracks: Track[] = []): Promise<string | null> {
  if (!library?.createPlaylist) return null;
  const have = collections.getState().playlists;
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
  if (!library?.updatePlaylist) return;
  try {
    await library.updatePlaylist(playlist.id, { add: tracks.map((t) => t.id) });
    toastStore.getState().show(strings.playlist.added(playlist.name));
    await refreshPlaylists();
  } catch {
    toastStore.getState().show(strings.playlist.failed);
  }
}
