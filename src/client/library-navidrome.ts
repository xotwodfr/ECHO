import { ApiError, api } from './api.ts';
import type {
  Album,
  AlbumSort,
  ArtistRef,
  Library,
  Playlist,
  PlaylistDetail,
  StarKind,
} from './library.ts';
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
interface SubArtist {
  id: string;
  name: string;
  coverArt?: string;
}
interface SubPlaylist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  entry?: SubSong[];
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
async function rest<T>(path: string, method = 'GET'): Promise<Rest<T>> {
  const r = await api<Rest<T & { status?: string; error?: { code?: number } }>>(
    path,
    method === 'GET' ? {} : { method, body: {} },
  );
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

const artistOf = (a: SubArtist): ArtistRef => ({
  id: a.id,
  name: a.name,
  image: cover(a.coverArt ?? `ar-${a.id}`),
});

const playlistOf = (p: SubPlaylist): Playlist => ({
  id: p.id,
  name: p.name,
  tracks: p.songCount ?? 0,
  ...(p.coverArt && { cover: cover(p.coverArt) }),
  ...(p.owner && { owner: p.owner }),
});

/** A Subsonic write: POST through the proxy, so its Origin check applies (routes.ts). */
const write = (method: string, params: [string, string][]) =>
  rest(`/navidrome/rest/${method}?${new URLSearchParams(params)}`, 'POST');

/** Text of an HTML snippet (Last.fm's biographies carry a link). */
const plain = (html: string) =>
  (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
    .replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
    .trim();

const STAR_PARAM: Record<StarKind, string> = { track: 'id', album: 'albumId', artist: 'artistId' };

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

  /** An album from a list: the library's own when it knows it (its tracks may be loaded). */
  const known = (a: SubAlbum) => {
    const have = byId.get(a.id);
    if (have) return have;
    const album = albumOf(a);
    byId.set(a.id, album);
    return album;
  };

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
      const r = await rest<{ playlists?: { playlist?: SubPlaylist[] } }>(
        '/navidrome/rest/getPlaylists',
      );
      return (r['subsonic-response'].playlists?.playlist ?? []).map(playlistOf);
    },
    async playlist(id): Promise<PlaylistDetail | undefined> {
      const r = await rest<{ playlist?: SubPlaylist }>(
        `/navidrome/rest/getPlaylist?id=${encodeURIComponent(id)}`,
      ).catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'subsonic.70') return null;
        throw err;
      });
      const p = r?.['subsonic-response'].playlist;
      if (!p) return undefined;
      const entries = songs(p.entry);
      const covers = [...new Set(entries.map((t) => t.artwork[0]?.url).filter(Boolean))];
      return {
        ...playlistOf(p),
        ...(p.comment && { comment: p.comment }),
        covers: (covers as string[]).slice(0, 4),
        durationMs: entries.reduce((t, x) => t + x.durationMs, 0),
        entries,
      };
    },
    async createPlaylist(name, trackIds = []) {
      const r = await write('createPlaylist', [
        ['name', name],
        ...trackIds.map((x): [string, string] => ['songId', x]),
      ]);
      return (r['subsonic-response'] as { playlist?: { id: string } }).playlist?.id ?? '';
    },
    async updatePlaylist(id, change) {
      await write('updatePlaylist', [
        ['playlistId', id],
        ...(change.name !== undefined ? [['name', change.name] as [string, string]] : []),
        ...(change.comment !== undefined ? [['comment', change.comment] as [string, string]] : []),
        ...(change.add ?? []).map((x): [string, string] => ['songIdToAdd', x]),
        ...(change.remove ?? []).map((i): [string, string] => ['songIndexToRemove', String(i)]),
      ]);
    },
    async deletePlaylist(id) {
      await write('deletePlaylist', [['id', id]]);
    },
    async setStar(kind, id, on) {
      await write(on ? 'star' : 'unstar', [[STAR_PARAM[kind], id]]);
    },
    async starredAll() {
      const r = await rest<{
        starred2?: { song?: SubSong[]; album?: SubAlbum[]; artist?: SubArtist[] };
      }>('/navidrome/rest/getStarred2');
      const st = r['subsonic-response'].starred2;
      return {
        tracks: songs(st?.song),
        albums: (st?.album ?? []).map(known),
        artists: (st?.artist ?? []).map(artistOf),
      };
    },
    async albumList(kind, size) {
      const r = await rest<{ albumList2?: { album?: SubAlbum[] } }>(
        `/navidrome/rest/getAlbumList2?type=${kind}&size=${size}`,
      );
      return (r['subsonic-response'].albumList2?.album ?? []).map(known);
    },
    async artistInfo(id) {
      const r = await rest<{
        artistInfo2?: { biography?: string; similarArtist?: SubArtist[] };
      }>(`/navidrome/rest/getArtistInfo2?id=${encodeURIComponent(id)}&count=12`);
      const info = r['subsonic-response'].artistInfo2;
      return {
        // Last.fm's biography ends in a "Read more on Last.fm" link: text only here.
        ...(info?.biography && { bio: plain(info.biography) }),
        image: cover(`ar-${id}`, 600),
        similar: (info?.similarArtist ?? []).filter((a) => a.id).map(artistOf),
      };
    },
    async topSongs(artist, count) {
      const r = await rest<{ topSongs?: { song?: SubSong[] } }>(
        `/navidrome/rest/getTopSongs?${new URLSearchParams({ artist, count: String(count) })}`,
      );
      return songs(r['subsonic-response'].topSongs?.song);
    },
    async similarSongs(track, count) {
      const r = await rest<{ similarSongs2?: { song?: SubSong[] } }>(
        `/navidrome/rest/getSimilarSongs2?id=${encodeURIComponent(track.id)}&count=${count}`,
      ).catch(() => null);
      const similar = songs(r?.['subsonic-response'].similarSongs2?.song);
      if (similar.length) return similar;
      // Without Last.fm, Navidrome knows no similar songs: random ones stand in.
      const random = await rest<{ randomSongs?: { song?: SubSong[] } }>(
        `/navidrome/rest/getRandomSongs?size=${count}`,
      );
      return songs(random['subsonic-response'].randomSongs?.song).filter((t) => t.id !== track.id);
    },
    async genres() {
      const r = await rest<{
        genres?: { genre?: { value: string; albumCount?: number; songCount?: number }[] };
      }>('/navidrome/rest/getGenres');
      return (r['subsonic-response'].genres?.genre ?? [])
        .map((g) => ({ name: g.value, albums: g.albumCount ?? 0, songs: g.songCount ?? 0 }))
        .filter((g) => g.name && g.albums > 0)
        .sort((a, b) => b.albums - a.albums);
    },
    async genreAlbums(genre) {
      const r = await rest<{ albumList2?: { album?: SubAlbum[] } }>(
        `/navidrome/rest/getAlbumList2?${new URLSearchParams({ type: 'byGenre', genre, size: '500' })}`,
      );
      return (r['subsonic-response'].albumList2?.album ?? []).map(known);
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
      const r = await rest<{
        searchResult3?: { album?: SubAlbum[]; song?: SubSong[]; artist?: SubArtist[] };
      }>(
        `/navidrome/rest/search3?query=${encodeURIComponent(q)}&artistCount=6&albumCount=6&songCount=6`,
      );
      const found = r['subsonic-response'].searchResult3;
      return {
        tracks: songs(found?.song),
        albums: (found?.album ?? []).map(albumOf),
        artists: (found?.artist ?? []).map(artistOf),
      };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    version: () => version,
  };
}
