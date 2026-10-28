import type { Track } from '../shared/types.ts';
import type { Album, Library, Playlist } from './library.ts';
import { spotifyApi } from './spotify/api.ts';

// The Spotify library subset (PLAYBACK_ARCHITECTURE.md §4.5): saved albums, the playlists the user
// owns or collaborates on (others' items are unreadable for Development Mode apps), and search at
// most 10 per type. Nothing is kept beyond memory (Terms IV.3.b). Inside ECHO, Spotify album and
// playlist ids carry a `spotify:` prefix so they never meet a Navidrome id.

export const SEARCH_LIMIT = 10; // the Web API maximum since February 2026
const PAGE = 50;
export const PREFIX = 'spotify:';
const raw = (id: string) => id.replace(/^spotify:/, '');

interface SpArtist {
  id: string;
  name: string;
}
interface SpImage {
  url: string;
  width?: number | null;
  height?: number | null;
}
interface SpTrack {
  id: string;
  name: string;
  duration_ms: number;
  artists: SpArtist[];
  album?: SpAlbum;
  is_local?: boolean;
  type?: string;
}
interface SpAlbum {
  id: string;
  name: string;
  artists: SpArtist[];
  images: SpImage[];
  release_date?: string;
  tracks?: { items: SpTrack[]; next?: string | null };
}

const images = (list: SpImage[] = []) =>
  list.map((i) => ({
    url: i.url,
    ...(i.width && { width: i.width }),
    ...(i.height && { height: i.height }),
  }));

export function trackOf(t: SpTrack, album: SpAlbum | undefined = t.album): Track {
  return {
    key: `spotify:${t.id}`,
    provider: 'spotify',
    id: t.id,
    spotifyId: t.id,
    title: t.name,
    artists: t.artists.map((a) => ({ id: a.id, name: a.name })),
    album: {
      id: album ? PREFIX + album.id : undefined,
      title: album?.name ?? '',
      key: `spotify:album:${album?.id ?? ''}`,
    },
    durationMs: t.duration_ms,
    artwork: images(album?.images),
  };
}

export function albumOf(a: SpAlbum): Album {
  return {
    id: PREFIX + a.id,
    title: a.name,
    artist: a.artists.map((x) => x.name).join(', '),
    year: a.release_date ? Number(a.release_date.slice(0, 4)) || undefined : undefined,
    cover: images(a.images)[0]?.url,
    tracks: (a.tracks?.items ?? []).map((t) => trackOf(t, a)),
  };
}

export function createSpotifyLibrary(): Library {
  let albums: Album[] = [];
  const byId = new Map<string, Album>();
  const loaded = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  let status: 'loading' | 'ready' | 'error' = 'loading';
  const changed = () => {
    version++;
    for (const l of listeners) l();
  };
  const put = (a: Album, full: boolean) => {
    byId.set(a.id, a);
    if (full) loaded.add(a.id);
  };

  async function loadSaved() {
    for (let offset = 0; ; offset += PAGE) {
      const r = await spotifyApi<{ items: { album: SpAlbum }[]; next: string | null }>(
        '/v1/me/albums',
        { query: { limit: PAGE, offset } },
      ).catch(() => null);
      if (!r) {
        status = albums.length ? 'ready' : 'error';
        changed();
        return;
      }
      status = 'ready';
      const page = r.items ?? [];
      for (const { album } of page) {
        // Saved albums come with their first tracks; an album over 50 tracks loads the rest when opened.
        const a = albumOf(album);
        put(a, !album.tracks?.next);
        albums = [...albums.filter((x) => x.id !== a.id), a];
      }
      changed();
      if (!r.next) break;
    }
  }
  void loadSaved();

  return {
    get albums() {
      return albums;
    },
    album: (id) => byId.get(id),
    search: () => ({ tracks: [], albums: [] }),
    status: () => status,
    retry() {
      status = 'loading';
      changed();
      void loadSaved();
    },
    async loadAlbum(id) {
      if (loaded.has(id) || !id.startsWith(PREFIX)) return byId.get(id);
      const a = await spotifyApi<SpAlbum>(`/v1/albums/${encodeURIComponent(raw(id))}`);
      if (!a) return byId.get(id);
      // Albums over 50 tracks: the rest, page by page. A failed page fails the load: a partial
      // album is never stored as complete.
      let next = a.tracks?.next;
      while (next && a.tracks) {
        const page = await spotifyApi<{ items: SpTrack[]; next: string | null }>(
          new URL(next).pathname + new URL(next).search,
        );
        a.tracks.items.push(...(page?.items ?? []));
        next = page?.next;
      }
      const album = albumOf(a);
      put(album, true);
      changed();
      return album;
    },
    async playlists(): Promise<Playlist[]> {
      const me = await spotifyApi<{ id: string }>('/v1/me');
      const out: Playlist[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const r = await spotifyApi<{
          items: {
            id: string;
            name: string;
            collaborative: boolean;
            owner: { id: string };
            items?: { total: number };
            tracks?: { total: number };
          }[];
          next: string | null;
        }>('/v1/me/playlists', { query: { limit: PAGE, offset } });
        for (const p of r?.items ?? [])
          if (p.owner.id === me?.id || p.collaborative)
            out.push({
              id: PREFIX + p.id,
              name: p.name,
              tracks: p.items?.total ?? p.tracks?.total ?? 0,
            });
        if (!r?.next) break;
      }
      return out;
    },
    async playlistTracks(id) {
      const out: Track[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const r = await spotifyApi<{
          items: { item?: SpTrack | null; track?: SpTrack | null }[];
          next: string | null;
        }>(`/v1/playlists/${encodeURIComponent(raw(id))}/items`, {
          query: { limit: PAGE, offset },
        });
        for (const it of r?.items ?? []) {
          const t = it.item ?? it.track;
          // Episodes and local files cannot be played through the Web API by URI here.
          if (t && !t.is_local && (t.type ?? 'track') === 'track') out.push(trackOf(t));
        }
        if (!r?.next) break;
      }
      return out;
    },
    async searchRemote(q) {
      const r = await spotifyApi<{ tracks?: { items: SpTrack[] }; albums?: { items: SpAlbum[] } }>(
        '/v1/search',
        { query: { q, type: 'track,album', limit: SEARCH_LIMIT } },
      );
      for (const a of r?.albums?.items ?? []) if (!byId.has(PREFIX + a.id)) put(albumOf(a), false);
      return {
        tracks: (r?.tracks?.items ?? []).map((t) => trackOf(t)),
        albums: (r?.albums?.items ?? []).map(albumOf),
      };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    version: () => version,
  };
}

/** Both answers; one that failed counts as `none`. Both failing is an error, shown with Retry. */
async function eitherOf<T>(a: Promise<T> | T, b: Promise<T> | T, none: T): Promise<[T, T]> {
  const [x, y] = await Promise.allSettled([a, b]);
  if (x.status === 'rejected' && y.status === 'rejected') throw x.reason;
  return [x.status === 'fulfilled' ? x.value : none, y.status === 'fulfilled' ? y.value : none];
}

/**
 * Both libraries as one (SRCH-02): Navidrome's albums and results first, then Spotify's. Ids never
 * collide (Spotify's are prefixed), so each call goes to the library that owns the id.
 */
export function combineLibraries(nav: Library | null, sp: Library): Library {
  if (!nav) return sp;
  const owner = (id: string) => (id.startsWith(PREFIX) ? sp : nav);
  return {
    get albums() {
      return [...nav.albums, ...sp.albums];
    },
    album: (id) => owner(id).album(id),
    search: (q) => nav.search(q),
    // Ready once either has albums; an error only when both failed.
    status() {
      const a = nav.status?.() ?? 'ready';
      const b = sp.status?.() ?? 'ready';
      if (a === 'ready' || b === 'ready') return 'ready';
      return a === 'error' && b === 'error' ? 'error' : 'loading';
    },
    loadedAt: () => nav.loadedAt?.() ?? null,
    retry() {
      nav.retry?.();
      sp.retry?.();
    },
    loadAlbum: (id) => owner(id).loadAlbum?.(id) ?? Promise.resolve(owner(id).album(id)),
    // Artist pages are Navidrome's; Spotify's artists link to Spotify (its attribution rules).
    ...(nav.artist && { artist: nav.artist }),
    ...(nav.sort && { sort: nav.sort, setSort: nav.setSort }),
    async playlists() {
      const [a, b] = await eitherOf(nav.playlists?.() ?? [], sp.playlists?.() ?? [], []);
      return [...a, ...b];
    },
    playlistTracks: (id) => owner(id).playlistTracks?.(id) ?? Promise.resolve([]),
    ...(nav.starred && { starred: nav.starred }),
    async searchRemote(q) {
      const none = { tracks: [], albums: [] };
      const [a, b] = await eitherOf(
        nav.searchRemote?.(q) ?? nav.search(q),
        sp.searchRemote?.(q) ?? none,
        none,
      );
      return { tracks: [...a.tracks, ...b.tracks], albums: [...a.albums, ...b.albums] };
    },
    subscribe(onChange) {
      const u1 = nav.subscribe?.(onChange);
      const u2 = sp.subscribe?.(onChange);
      return () => {
        u1?.();
        u2?.();
      };
    },
    version: () => (nav.version?.() ?? 0) * 100_000 + (sp.version?.() ?? 0),
  };
}
