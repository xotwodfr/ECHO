import type { Track } from '../shared/types.ts';
import type { Album, ArtistRef, Library, Playlist, PlaylistDetail } from './library.ts';
import { isScopeError, SpotifyError, spotifyApi } from './spotify/api.ts';

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
  images?: SpImage[];
}

/** A connection without a newer scope (until the user reconnects): that part is empty, not an error. */
const noneWithoutScope = (e: unknown): null => {
  if (isScopeError(e)) return null;
  throw e;
};

const artistRef = (a: SpArtist): ArtistRef => ({
  id: PREFIX + a.id,
  name: a.name,
  ...(a.images?.[0] && { image: a.images[0].url }),
});
/** A Spotify URI from an ECHO id: `spotify:<kind>:<id>` (the Web API's library takes URIs). */
const uriOf = (kind: 'track' | 'album' | 'artist', id: string) => `spotify:${kind}:${raw(id)}`;
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
    artists: t.artists.map((a) => ({ id: PREFIX + a.id, name: a.name })),
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
    ...(a.artists[0] && { artistId: PREFIX + a.artists[0].id }),
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
  const saved = loadSaved();

  const lib: Library = {
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
    async playlist(id): Promise<PlaylistDetail | undefined> {
      const p = await spotifyApi<{
        name: string;
        description?: string | null;
        owner?: { display_name?: string | null; id: string };
      }>(`/v1/playlists/${encodeURIComponent(raw(id))}`, {
        query: { fields: 'name,description,owner(display_name,id)' },
      }).catch((e: unknown) => {
        if (e instanceof SpotifyError && e.appError.code === 'spotify.http_404') return null;
        throw e;
      });
      if (!p) return undefined;
      const entries = (await lib.playlistTracks?.(id)) ?? [];
      const covers = [
        ...new Set(entries.map((t) => t.artwork[0]?.url).filter((u): u is string => !!u)),
      ].slice(0, 4);
      return {
        id: PREFIX + raw(id),
        name: p.name,
        tracks: entries.length,
        ...(p.description && { comment: p.description }),
        owner: p.owner?.display_name ?? p.owner?.id,
        covers,
        durationMs: entries.reduce((n, t) => n + t.durationMs, 0),
        entries,
      };
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
      const r = await spotifyApi<{
        tracks?: { items: SpTrack[] };
        albums?: { items: SpAlbum[] };
        artists?: { items: SpArtist[] };
      }>('/v1/search', { query: { q, type: 'track,album,artist', limit: SEARCH_LIMIT } });
      for (const a of r?.albums?.items ?? []) if (!byId.has(PREFIX + a.id)) put(albumOf(a), false);
      return {
        tracks: (r?.tracks?.items ?? []).map((t) => trackOf(t)),
        albums: (r?.albums?.items ?? []).map(albumOf),
        artists: (r?.artists?.items ?? []).map(artistRef),
      };
    },
    // Liked Songs: the user's saved tracks.
    async starred() {
      const out: Track[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const r = await spotifyApi<{ items: { track: SpTrack | null }[]; next: string | null }>(
          '/v1/me/tracks',
          { query: { limit: PAGE, offset } },
        );
        for (const it of r?.items ?? [])
          if (it.track && !it.track.is_local) out.push(trackOf(it.track));
        if (!r?.next) break;
      }
      return out;
    },
    async starredAll() {
      const artists: ArtistRef[] = [];
      let after: string | undefined;
      for (;;) {
        const r = await spotifyApi<{
          artists: { items: SpArtist[]; next: string | null; cursors?: { after?: string } };
        }>('/v1/me/following', {
          query: { type: 'artist', limit: PAGE, ...(after && { after }) },
        }).catch(noneWithoutScope);
        artists.push(...(r?.artists.items ?? []).map(artistRef));
        after = r?.artists.cursors?.after;
        if (!r?.artists.next || !after) break;
      }
      const tracks = (await lib.starred?.()) ?? [];
      if (status === 'loading') await saved;
      return { tracks, albums, artists };
    },
    // Hearts save to the user's Spotify library: one generic endpoint for every kind (Feb 2026).
    async setStar(kind, id, on) {
      await spotifyApi('/v1/me/library', {
        method: on ? 'PUT' : 'DELETE',
        body: { uris: [uriOf(kind, id)] },
      });
      if (kind === 'album' && !on) {
        albums = albums.filter((a) => a.id !== id);
        changed();
      }
    },
    async artist(id) {
      const a = await spotifyApi<SpArtist>(`/v1/artists/${encodeURIComponent(raw(id))}`);
      if (!a) return undefined;
      let list: SpAlbum[];
      try {
        const r = await spotifyApi<{ items: SpAlbum[] }>(
          `/v1/artists/${encodeURIComponent(raw(id))}/albums`,
          { query: { include_groups: 'album,single', limit: PAGE } },
        );
        list = r?.items ?? [];
      } catch (e) {
        // The artist's album list closed to this app: their albums from search instead.
        if (!(e instanceof SpotifyError)) throw e;
        const r = await spotifyApi<{ albums?: { items: SpAlbum[] } }>('/v1/search', {
          query: { q: `artist:"${a.name}"`, type: 'album', limit: SEARCH_LIMIT },
        });
        list = r?.albums?.items ?? [];
      }
      const out = list.map(albumOf);
      for (const x of out) if (!byId.has(x.id)) put(x, false);
      return { name: a.name, albums: out };
    },
    // Home (docs/superpowers/specs/2026-11-02-source-switch-design.md): from the user's own history;
    // Spotify has no random or rated lists for this app.
    async albumList(kind, size) {
      const unique = (ts: SpTrack[]) => {
        const seen = new Map<string, Album>();
        for (const t of ts)
          if (t.album && !seen.has(t.album.id)) seen.set(t.album.id, albumOf(t.album));
        return [...seen.values()].slice(0, size);
      };
      if (kind === 'recent') {
        const r = await spotifyApi<{ items: { track: SpTrack }[] }>(
          '/v1/me/player/recently-played',
          { query: { limit: PAGE } },
        ).catch(noneWithoutScope);
        return unique((r?.items ?? []).map((i) => i.track));
      }
      if (kind === 'frequent') {
        const r = await spotifyApi<{ items: SpTrack[] }>('/v1/me/top/tracks', {
          query: { limit: PAGE, time_range: 'medium_term' },
        }).catch(noneWithoutScope);
        return unique(r?.items ?? []);
      }
      if (kind === 'newest' || kind === 'starred') {
        if (status === 'loading') await saved;
        return albums.slice(0, size);
      }
      return [];
    },
    async topArtists(count) {
      const r = await spotifyApi<{ items: SpArtist[] }>('/v1/me/top/artists', {
        query: { limit: Math.min(count, PAGE), time_range: 'medium_term' },
      }).catch(noneWithoutScope);
      return (r?.items ?? []).map(artistRef);
    },
    async artistInfo(id) {
      const a = await spotifyApi<SpArtist>(`/v1/artists/${encodeURIComponent(raw(id))}`);
      // No bio or related artists for this app (Development Mode): the picture only.
      return { similar: [], ...(a?.images?.[0] && { image: a.images[0].url }) };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    version: () => version,
  };
  return lib;
}
