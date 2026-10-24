import { api } from './api.ts';
import type { Album, Library } from './library.ts';
import type { NavidromeTrack } from './playback/navidrome.ts';

// The signed-in user's Navidrome library (PLAYBACK_ARCHITECTURE.md §5.4) through ECHO's proxy: the
// album list up front (getAlbumList2, paged), an album's tracks when it is opened or played
// (getAlbum). Search filters what is loaded; server-side search3 is a follow-up.

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
  year: a.year,
  cover: cover(a.coverArt),
  tracks: (a.song ?? []).map((s) => trackOf(s, a)),
});

export function createNavidromeLibrary(): Library {
  let albums: Album[] = [];
  const byId = new Map<string, Album>();
  const loaded = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version++;
    for (const l of listeners) l();
  };

  void (async () => {
    for (let offset = 0; ; offset += PAGE) {
      const r = await api<Rest<{ albumList2?: { album?: SubAlbum[] } }>>(
        `/navidrome/rest/getAlbumList2?type=alphabeticalByName&size=${PAGE}&offset=${offset}`,
      ).catch(() => null);
      const page = r?.['subsonic-response'].albumList2?.album ?? [];
      for (const a of page) {
        const album = albumOf(a);
        if (!byId.has(album.id)) albums.push(album);
        byId.set(album.id, byId.get(album.id) ?? album);
      }
      albums = [...albums];
      changed();
      if (page.length < PAGE) break;
    }
  })();

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
      const r = await api<Rest<{ album?: SubAlbum }>>(
        `/navidrome/rest/getAlbum?id=${encodeURIComponent(id)}`,
      ).catch(() => null);
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
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    version: () => version,
  };
}
