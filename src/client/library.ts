import type { Track } from '../shared/types.ts';

// The library as the shell reads it. In M2 the only source is the fixture library (dev builds);
// M5 replaces it with Navidrome data through TanStack Query.

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
