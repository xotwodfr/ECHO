import type { Track } from '../shared/types.ts';

// The library as the shell reads it: the fixture library (development builds) or the signed-in
// user's Navidrome (library-navidrome.ts), which loads album tracks on demand.

export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  cover?: string;
  tracks: Track[];
}

export interface Library {
  albums: Album[];
  album(id: string): Album | undefined;
  /** Case-insensitive substring match on titles and artists (a stand-in for server search). */
  search(q: string): { tracks: Track[]; albums: Album[] };
  /** Server libraries: fetches an album's tracks if they are not loaded yet. */
  loadAlbum?(id: string): Promise<Album | undefined>;
  /** Server libraries: called whenever more of the library has arrived. */
  subscribe?(onChange: () => void): () => void;
  /** Bumped on every change (with `subscribe`), so React can re-render. */
  version?(): number;
}

export function createLibrary(albums: Album[]): Library {
  const byId = new Map(albums.map((a) => [a.id, a]));
  return {
    albums,
    album: (id) => byId.get(id),
    search(q) {
      const needle = q.trim().toLowerCase();
      if (!needle) return { tracks: [], albums: [] };
      const hit = (...texts: string[]) => texts.some((t) => t.toLowerCase().includes(needle));
      return {
        tracks: albums
          .flatMap((a) => a.tracks)
          .filter((t) => hit(t.title, ...t.artists.map((x) => x.name))),
        albums: albums.filter((a) => hit(a.title, a.artist)),
      };
    },
  };
}

export const albumDurationMs = (a: Album) => a.tracks.reduce((sum, t) => sum + t.durationMs, 0);
