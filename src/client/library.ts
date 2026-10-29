import type { Track } from '../shared/types.ts';

// The library as the shell reads it: the fixture library (development builds) or the signed-in
// user's Navidrome (library-navidrome.ts), which loads album tracks on demand.

export interface Album {
  id: string;
  title: string;
  artist: string;
  /** The album artist's id, where the library has one (Navidrome): their page (S6). */
  artistId?: string;
  year?: number;
  cover?: string;
  tracks: Track[];
}

export interface Library {
  albums: Album[];
  album(id: string): Album | undefined;
  /** Case-insensitive substring match on titles and artists (a stand-in for server search). */
  search(q: string): { tracks: Track[]; albums: Album[] };
  /**
   * Server libraries: fetches an album's tracks if they are not loaded yet. Rejects when it could
   * not ask (an error to show with Retry); undefined when the server has no such album.
   */
  loadAlbum?(id: string): Promise<Album | undefined>;
  /** Server libraries: an artist and their albums (S6). Rejects when it could not ask. */
  artist?(id: string): Promise<{ name: string; albums: Album[] } | undefined>;
  /** Server libraries: called whenever more of the library has arrived. */
  subscribe?(onChange: () => void): () => void;
  /** Bumped on every change (with `subscribe`), so React can re-render. */
  version?(): number;
  /**
   * Server libraries: the album list's state (DESIGN_SYSTEM.md §10) and when it last loaded, so
   * a block can show its skeleton, its error with Retry, or a freshness note.
   */
  status?(): 'loading' | 'ready' | 'error';
  loadedAt?(): number | null;
  retry?(): void;
  /** Server libraries: the album order (PRODUCT_SPEC.md §6.3). */
  sort?(): AlbumSort;
  setSort?(sort: AlbumSort): void;
  playlists?(): Promise<Playlist[]>;
  playlistTracks?(id: string): Promise<Track[]>;
  starred?(): Promise<Track[]>;
  /** Server-side search (Navidrome `search3`). */
  searchRemote?(q: string): Promise<{ tracks: Track[]; albums: Album[]; artists?: ArtistRef[] }>;

  // The Spotify-style pages (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md).
  /** Home's shelves: albums by kind (`getAlbumList2`). */
  albumList?(kind: AlbumListKind, size: number): Promise<Album[]>;
  /** Bio, picture and similar artists (`getArtistInfo2`, Last.fm through Navidrome). */
  artistInfo?(id: string): Promise<ArtistInfo>;
  /** An artist's most played songs (`getTopSongs`, by name). */
  topSongs?(artist: string, count: number): Promise<Track[]>;
  /** Song radio: songs like this one (`getSimilarSongs2`), or random ones of the genre. */
  similarSongs?(track: Track, count: number): Promise<Track[]>;
  genres?(): Promise<Genre[]>;
  genreAlbums?(genre: string): Promise<Album[]>;
  playlist?(id: string): Promise<PlaylistDetail | undefined>;
  createPlaylist?(name: string, trackIds?: string[]): Promise<string>;
  updatePlaylist?(id: string, change: PlaylistChange): Promise<void>;
  deletePlaylist?(id: string): Promise<void>;
  /** Hearts: star or unstar a song, an album or an artist. */
  setStar?(kind: StarKind, id: string, on: boolean): Promise<void>;
  /** Everything starred, for the hearts and Your Library. */
  starredAll?(): Promise<Starred>;
}

export type AlbumListKind = 'recent' | 'frequent' | 'newest' | 'random' | 'starred' | 'highest';
export type StarKind = 'track' | 'album' | 'artist';

export interface ArtistRef {
  id: string;
  name: string;
  image?: string;
}

export interface ArtistInfo {
  bio?: string;
  image?: string;
  similar: ArtistRef[];
}

export interface Genre {
  name: string;
  albums: number;
  songs: number;
}

export interface PlaylistDetail extends Playlist {
  comment?: string;
  owner?: string;
  /** Covers of the first four distinct albums: the playlist's mosaic. */
  covers: string[];
  durationMs: number;
  entries: Track[];
}

export interface PlaylistChange {
  name?: string;
  comment?: string;
  add?: string[];
  /** Positions in the playlist to remove. */
  remove?: number[];
}

export interface Starred {
  tracks: Track[];
  albums: Album[];
  artists: ArtistRef[];
}

export const ALBUM_SORTS = ['newest', 'alphabeticalByName', 'byYear', 'frequent'] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];

export interface Playlist {
  id: string;
  name: string;
  tracks: number;
  cover?: string;
  owner?: string;
}

/**
 * The fixture library (development builds and tests): the albums it is given, with playlists and
 * hearts kept in memory, so every page has something to show without a server.
 */
export function createLibrary(albums: Album[]): Library {
  const byId = new Map(albums.map((a) => [a.id, a]));
  const tracks = albums.flatMap((a) => a.tracks);
  const stars = { track: new Set<string>(), album: new Set<string>(), artist: new Set<string>() };
  const lists = new Map<string, { name: string; comment: string; ids: string[] }>();
  let nextList = 1;
  const detail = (id: string): PlaylistDetail | undefined => {
    const p = lists.get(id);
    if (!p) return undefined;
    const entries = p.ids.flatMap((x) => tracks.filter((t) => t.id === x));
    const covers = [...new Set(entries.map((t) => t.artwork[0]?.url).filter(Boolean))];
    return {
      id,
      name: p.name,
      comment: p.comment,
      tracks: entries.length,
      covers: (covers as string[]).slice(0, 4),
      durationMs: entries.reduce((t, x) => t + x.durationMs, 0),
      entries,
    };
  };
  const artists = () =>
    [
      ...new Map(albums.filter((a) => a.artistId).map((a) => [a.artistId as string, a])).values(),
    ].map((a) => ({ id: a.artistId as string, name: a.artist, image: a.cover }));
  return {
    albums,
    album: (id) => byId.get(id),
    async albumList(kind, size) {
      const order =
        kind === 'random'
          ? [...albums].reverse()
          : kind === 'starred'
            ? albums.filter((a) => stars.album.has(a.id))
            : kind === 'frequent'
              ? [...albums].sort((a, b) => b.tracks.length - a.tracks.length)
              : albums;
      return order.slice(0, size);
    },
    async playlists() {
      return [...lists.keys()].map((id) => detail(id) as PlaylistDetail);
    },
    async playlistTracks(id) {
      return detail(id)?.entries ?? [];
    },
    async playlist(id) {
      return detail(id);
    },
    async createPlaylist(name, ids = []) {
      const id = `pl-${nextList++}`;
      lists.set(id, { name, comment: '', ids: [...ids] });
      return id;
    },
    async updatePlaylist(id, change) {
      const p = lists.get(id);
      if (!p) return;
      if (change.name !== undefined) p.name = change.name;
      if (change.comment !== undefined) p.comment = change.comment;
      const drop = new Set(change.remove ?? []);
      p.ids = [...p.ids.filter((_, i) => !drop.has(i)), ...(change.add ?? [])];
    },
    async deletePlaylist(id) {
      lists.delete(id);
    },
    async setStar(kind, id, on) {
      if (on) stars[kind].add(id);
      else stars[kind].delete(id);
    },
    async starred() {
      return tracks.filter((t) => stars.track.has(t.id));
    },
    async starredAll() {
      return {
        tracks: tracks.filter((t) => stars.track.has(t.id)),
        albums: albums.filter((a) => stars.album.has(a.id)),
        artists: artists().filter((a) => stars.artist.has(a.id)),
      };
    },
    async artistInfo(id) {
      return { similar: artists().filter((a) => a.id !== id) };
    },
    async topSongs(artist, count) {
      return tracks.filter((t) => t.artists.some((a) => a.name === artist)).slice(0, count);
    },
    async similarSongs(track, count) {
      return tracks.filter((t) => t.album.key !== track.album.key).slice(0, count);
    },
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
