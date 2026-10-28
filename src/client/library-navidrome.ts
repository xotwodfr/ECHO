import { ApiError, api } from './api.ts';
import type { Album, AlbumSort, Library, Playlist } from './library.ts';
import type { NavidromeTrack } from './playback/navidrome.ts';

// The signed-in user's Navidrome library (PLAYBACK_ARCHITECTURE.md §5.4) through ECHO's proxy: the
// album list up front (getAlbumList2, paged), an album's tracks when it is opened or played
// (getAlbum). Search filters what is loaded, and searchRemote asks search3.

interface SubAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  year?: number;
  coverArt?: string;
  song?: SubSong[];
}
interface SubSong {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  contentType?: string;
  isrc?: string[] | string;
  replayGain?: NavidromeTrack['replayGain'];
}

type Rest<T> = { 'subsonic-response': T };

/**
 * A Subsonic call through ECHO's proxy. Navidrome refuses a request with HTTP 200 and
 * `status: "failed"`: that is an error here (`subsonic.<code>`), never an empty answer.
 */
async function rest<T>(path: string): Promise<Rest<T>> {
  const r = await api<Rest<T & { status?: string; error?: { code?: number } }>>(path);
  const sr = r['subsonic-response'];
  if (sr.status === 'failed') throw new ApiError(200, { code: `subsonic.${sr.error?.code ?? 0}` });
  return r;
}
const PAGE = 500;
const cover = (id: string | undefined, size = 300) =>
  id ? `/api/v1/navidrome/cover/${encodeURIComponent(id)}?size=${size}` : undefined;

function trackOf(s: SubSong, a: SubAlbum): NavidromeTrack {
  const art = cover(s.coverArt ?? a.coverArt, 600);
  return {
    key: `navidrome:${s.id}`,
    provider: 'navidrome',
    id: s.id,
    title: s.title,
    artists: [{ id: s.artistId, name: s.artist ?? a.artist ?? '' }],
    album: { id: a.id, title: s.album ?? a.name, key: `navidrome:${a.id}` },
    durationMs: (s.duration ?? 0) * 1000,
    artwork: art ? [{ url: art }] : [],
    isrc: Array.isArray(s.isrc) ? s.isrc[0] : s.isrc,
    replayGain: s.replayGain,
    contentType: s.contentType,
  };
}

const albumOf = (a: SubAlbum): Album => ({
  id: a.id,
  title: a.name,
  artist: a.artist ?? '',
  ...(a.artistId && { artistId: a.artistId }),
  year: a.year,
  cover: cover(a.coverArt),
  tracks: (a.song ?? []).map((s) => trackOf(s, a)),
});

export function createNavidromeLibrary(): Library {
  let sort: AlbumSort = 'newest';
  let generation = 0;
  let albums: Album[] = [];
  const byId = new Map<string, Album>();
  const loaded = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  let status: 'loading' | 'ready' | 'error' = 'loading';
  let loadedAt: number | null = null;
  const changed = () => {
    version++;
    for (const l of listeners) l();
  };

  /** The whole album list in the chosen order, page by page; a newer sort supersedes it. */
  async function loadAll() {
    const gen = ++generation;
    const next: Album[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const r = await rest<{ albumList2?: { album?: SubAlbum[] } }>(
        // The year sort needs its range: newest first, albums without a year last.
        `/navidrome/rest/getAlbumList2?type=${sort}&size=${PAGE}&offset=${offset}${sort === 'byYear' ? '&fromYear=9999&toYear=0' : ''}`,
      ).catch(() => null);
      if (gen !== generation) return;
      if (!r) {
        // What was loaded stays on screen; with nothing loaded the block shows its error.
        status = albums.length ? 'ready' : 'error';
        changed();
        return;
      }
      const page = r['subsonic-response'].albumList2?.album ?? [];
      for (const a of page) {
        const known = byId.get(a.id);
        const album = known && loaded.has(a.id) ? known : albumOf(a);
        byId.set(a.id, album);
        next.push(album);
      }
      albums = [...next];
      status = 'ready';
      loadedAt = Date.now();
      changed();
      if (page.length < PAGE) break;
    }
  }
  void loadAll();

  const songs = (list: SubSong[] | undefined) =>
    (list ?? []).map((x) =>
      trackOf(x, { id: x.albumId ?? '', name: x.album ?? '', coverArt: x.coverArt }),
    );

  return {
    get albums() {
      return albums;
    },
    album: (id) => byId.get(id),
    search(q) {
      const needle = q.trim().toLowerCase();
      if (!needle) return { tracks: [], albums: [] };
      const hit = (...t: string[]) => t.some((x) => x.toLowerCase().includes(needle));
      return {
        tracks: albums
          .flatMap((a) => a.tracks)
          .filter((t) => hit(t.title, ...t.artists.map((x) => x.name))),
        albums: albums.filter((a) => hit(a.title, a.artist)),
      };
    },
    async loadAlbum(id) {
      if (loaded.has(id)) return byId.get(id);
      // Not found (Subsonic 70) is an answer: no such album. Anything else is an error, with Retry.
      const r = await rest<{ album?: SubAlbum }>(
        `/navidrome/rest/getAlbum?id=${encodeURIComponent(id)}`,
      ).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'subsonic.70') return null;
        throw err;
      });
      const a = r?.['subsonic-response'].album;
      if (!a) return byId.get(id);
      const album = albumOf(a);
      loaded.add(id);
      byId.set(id, album);
      albums = albums.some((x) => x.id === id)
        ? albums.map((x) => (x.id === id ? album : x))
        : [...albums, album];
      changed();
      return album;
    },
    status: () => status,
    loadedAt: () => loadedAt,
    retry() {
      status = 'loading';
      changed();
      void loadAll();
    },
    sort: () => sort,
    setSort(next) {
      if (next === sort) return;
      sort = next;
      void loadAll();
    },
    async artist(id) {
      // Not found (Subsonic 70) is an answer: no such artist. Anything else is an error, with Retry.
      const r = await rest<{ artist?: { name: string; album?: SubAlbum[] } }>(
        `/navidrome/rest/getArtist?id=${encodeURIComponent(id)}`,
      ).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'subsonic.70') return null;
        throw err;
      });
      const a = r?.['subsonic-response'].artist;
      if (!a) return undefined;
      // Known to the library from here on (their tiles open the album), without replacing an
      // album whose tracks are already loaded.
      const albums = (a.album ?? []).map((x) => {
        const known = byId.get(x.id);
        if (known) return known;
        const album = albumOf(x);
        byId.set(x.id, album);
        return album;
      });
      return { name: a.name, albums };
    },
    async playlists(): Promise<Playlist[]> {
      const r = await rest<{
        playlists?: { playlist?: { id: string; name: string; songCount?: number }[] };
      }>('/navidrome/rest/getPlaylists');
      return (r['subsonic-response'].playlists?.playlist ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        tracks: p.songCount ?? 0,
      }));
    },
    async playlistTracks(id) {
      const r = await rest<{ playlist?: { entry?: SubSong[] } }>(
        `/navidrome/rest/getPlaylist?id=${encodeURIComponent(id)}`,
      );
      return songs(r['subsonic-response'].playlist?.entry);
    },
    async starred() {
      const r = await rest<{ starred2?: { song?: SubSong[] } }>('/navidrome/rest/getStarred2');
      return songs(r['subsonic-response'].starred2?.song);
    },
    async searchRemote(q) {
      const r = await rest<{ searchResult3?: { album?: SubAlbum[]; song?: SubSong[] } }>(
        `/navidrome/rest/search3?query=${encodeURIComponent(q)}&artistCount=6&albumCount=6&songCount=6`,
      );
      const found = r['subsonic-response'].searchResult3;
      return { tracks: songs(found?.song), albums: (found?.album ?? []).map(albumOf) };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    version: () => version,
  };
}
