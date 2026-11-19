import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Album, ArtistEntry, ArtistRef, Library } from '../library.ts';
import { useLibrary } from '../playback/context.tsx';
import { useStarredAll } from './collections.ts';

// Your Library's artists (LIB-01): a server library's own list (Navidrome `getArtists`), so the
// counts are true before every album page has loaded and each artist has their own picture. The
// fixture library has no such list: its artists are the albums', as the side panel's are until the
// server's arrives. Either way the artists the user follows are added (hearts), A–Z.

export interface ArtistRow {
  key: string;
  /** Missing for an album artist the library has no id for: no page to open. */
  id?: string;
  name: string;
  image?: string;
  /** Their albums on the server, or among the albums loaded so far. */
  albums: number;
  /** On the list only because the user follows them. */
  followedOnly?: boolean;
}

/** The albums' artists, by id where the library has one (S6), else by name. */
export function artistsFromAlbums(albums: Album[]): ArtistRow[] {
  const by = new Map<string, ArtistRow>();
  for (const a of albums) {
    const key = a.artistId ?? `name:${a.artist}`;
    const known = by.get(key);
    if (known) known.albums++;
    else by.set(key, { key, id: a.artistId, name: a.artist.trim(), image: a.cover, albums: 1 });
  }
  return [...by.values()];
}

export const serverArtists = (list: ArtistEntry[]): ArtistRow[] =>
  list.map((a) => ({ key: a.id, id: a.id, name: a.name, image: a.image, albums: a.albumCount }));

/** Adds the followed artists `rows` lacks, then sorts A–Z. */
export function withFollowed(rows: ArtistRow[], followed: ArtistRef[]): ArtistRow[] {
  const have = new Set(rows.map((r) => r.id));
  const extra = followed
    .filter((f) => !have.has(f.id))
    .map((f) => ({
      key: f.id,
      id: f.id,
      name: f.name,
      image: f.image,
      albums: 0,
      followedOnly: true,
    }));
  return [...rows, ...extra].sort((a, b) => a.name.localeCompare(b.name));
}

/** The server's list: asked for once, the first time a view needs it, and again on Retry. */
const server = createStore<{ from: Library | null; list: ArtistEntry[] | 'error' | null }>()(
  () => ({ from: null, list: null }),
);

export function loadArtists(library: Library) {
  if (!library.artists) return;
  server.setState({ from: library, list: null });
  // An answer for a library that has since been replaced (another server) is dropped.
  library.artists().then(
    (list) => server.getState().from === library && server.setState({ list }),
    () => server.getState().from === library && server.setState({ list: 'error' }),
  );
}

/**
 * Your Library's artists. `state` is the server list's ('ready' at once for a library without
 * one). `rows` is that list once it has arrived, else the albums' artists so far, so the side panel
 * has rows while it loads; the Artists page waits for it instead (`state`). The list is asked for
 * only once `shown` (the side panel is always there, its Artists chip not always on).
 */
export function useArtists(shown = true) {
  const library = useLibrary();
  const followed = useStarredAll();
  const { from, list } = useStore(server);
  const own = !!library?.artists;
  useEffect(() => {
    if (shown && library?.artists && from !== library) loadArtists(library);
  }, [shown, library, from]);
  const mine = own && from === library ? list : null;
  const albums = library?.albums;
  const rows = useMemo(
    () =>
      withFollowed(
        Array.isArray(mine) ? serverArtists(mine) : artistsFromAlbums(albums ?? []),
        followed && followed !== 'error' ? followed.artists : [],
      ),
    [mine, albums, followed],
  );
  const state: 'loading' | 'ready' | 'error' = !own
    ? 'ready'
    : mine === 'error'
      ? 'error'
      : mine
        ? 'ready'
        : 'loading';
  return { state, rows, retry: () => library && loadArtists(library) };
}
