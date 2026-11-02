import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Spotify library (PLAYBACK_ARCHITECTURE.md §4.5, February 2026 API): Liked Songs, saved albums
// and followed artists, hearts through /v1/me/library with URIs, artist pages, and search. Ids
// inside ECHO carry the `spotify:` prefix (albums, playlists, artists); tracks keep Spotify's own.

type Call = {
  path: string;
  init?: { method?: string; body?: unknown; query?: Record<string, unknown> };
};
const calls: Call[] = [];
let answers: Record<string, unknown> = {};
vi.mock('./spotify/api.ts', () => {
  class SpotifyError extends Error {
    appError: { code: string };
    constructor(code: string) {
      super(code);
      this.appError = { code };
    }
  }
  return {
    SpotifyError,
    spotifyApi: async (path: string, init?: Call['init']) => {
      calls.push({ path, init });
      const a = answers[path];
      if (a instanceof Error) throw a;
      return a ?? null;
    },
  };
});
const { SpotifyError } = (await import('./spotify/api.ts')) as never as {
  SpotifyError: new (code: string) => Error;
};
const { createSpotifyLibrary, trackOf } = await import('./library-spotify.ts');

const artist = { id: 'kite', name: 'Kite Weather' };
const album = { id: 'ns', name: 'Northern Static', artists: [artist], images: [{ url: 'c' }] };
const track = (id: string) => ({ id, name: id, duration_ms: 1000, artists: [artist], album });

beforeEach(() => {
  calls.length = 0;
  answers = {
    '/v1/me/albums': { items: [{ album }], next: null },
    '/v1/me/tracks': { items: [{ track: track('t1') }, { track: track('t2') }], next: null },
    '/v1/me/following': {
      artists: { items: [{ ...artist, images: [{ url: 'face' }] }], next: null },
    },
  };
});

describe('createSpotifyLibrary', () => {
  it('trackOf prefixes artist ids', () => {
    expect(trackOf(track('t1')).artists).toEqual([{ id: 'spotify:kite', name: 'Kite Weather' }]);
  });

  it('starredAll: saved tracks, saved albums and followed artists, with prefixed ids', async () => {
    const lib = createSpotifyLibrary();
    const s = await lib.starredAll?.();
    expect(s?.tracks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(s?.albums.map((a) => a.id)).toEqual(['spotify:ns']);
    expect(s?.artists).toEqual([{ id: 'spotify:kite', name: 'Kite Weather', image: 'face' }]);
  });

  it('setStar sends the item’s URI to /v1/me/library: PUT to save, DELETE to remove', async () => {
    const lib = createSpotifyLibrary();
    await lib.setStar?.('track', 't1', true);
    await lib.setStar?.('album', 'spotify:ns', false);
    await lib.setStar?.('artist', 'spotify:kite', true);
    const lib2 = calls.filter((c) => c.path === '/v1/me/library');
    expect(lib2.map((c) => [c.init?.method, c.init?.body])).toEqual([
      ['PUT', { uris: ['spotify:track:t1'] }],
      ['DELETE', { uris: ['spotify:album:ns'] }],
      ['PUT', { uris: ['spotify:artist:kite'] }],
    ]);
  });

  it('artist(): name and albums', async () => {
    answers['/v1/artists/kite'] = { ...artist, images: [{ url: 'face' }] };
    answers['/v1/artists/kite/albums'] = { items: [album], next: null };
    const a = await createSpotifyLibrary().artist?.('spotify:kite');
    expect(a?.name).toBe('Kite Weather');
    expect(a?.albums.map((x) => x.id)).toEqual(['spotify:ns']);
  });

  it('artist(): albums from search when the albums call is refused', async () => {
    answers['/v1/artists/kite'] = artist;
    answers['/v1/artists/kite/albums'] = new SpotifyError('spotify.http_403');
    answers['/v1/search'] = { albums: { items: [album] } };
    const a = await createSpotifyLibrary().artist?.('spotify:kite');
    expect(a?.albums.map((x) => x.id)).toEqual(['spotify:ns']);
    const search = calls.find((c) => c.path === '/v1/search');
    expect(search?.init?.query).toMatchObject({ q: 'artist:"Kite Weather"', type: 'album' });
  });

  it('searchRemote returns artists too, at most 10 per type', async () => {
    answers['/v1/search'] = {
      tracks: { items: [track('t1')] },
      albums: { items: [album] },
      artists: { items: [{ ...artist, images: [] }] },
    };
    const r = await createSpotifyLibrary().searchRemote?.('kite');
    expect(r?.artists).toEqual([{ id: 'spotify:kite', name: 'Kite Weather' }]);
    const q = calls.find((c) => c.path === '/v1/search')?.init?.query;
    expect(q).toMatchObject({ type: 'track,album,artist', limit: 10 });
  });

  it('albumList recent: the albums played lately, each once, newest first', async () => {
    const other = { ...album, id: 'gw', name: 'Glass Weather' };
    answers['/v1/me/player/recently-played'] = {
      items: [
        { track: { ...track('a'), album } },
        { track: { ...track('b'), album: other } },
        { track: { ...track('c'), album } },
      ],
    };
    const r = await createSpotifyLibrary().albumList?.('recent', 10);
    expect(r?.map((a) => a.id)).toEqual(['spotify:ns', 'spotify:gw']);
  });

  it('albumList frequent: the albums of the top tracks', async () => {
    answers['/v1/me/top/tracks'] = { items: [track('a'), track('b')] };
    const r = await createSpotifyLibrary().albumList?.('frequent', 10);
    expect(r?.map((a) => a.id)).toEqual(['spotify:ns']);
  });

  it('albumList newest: the saved albums; random: none', async () => {
    const lib = createSpotifyLibrary();
    expect((await lib.albumList?.('newest', 10))?.map((a) => a.id)).toEqual(['spotify:ns']);
    expect(await lib.albumList?.('random', 10)).toEqual([]);
  });

  it('topArtists maps prefixed ids', async () => {
    answers['/v1/me/top/artists'] = { items: [{ ...artist, images: [{ url: 'face' }] }] };
    expect(await createSpotifyLibrary().topArtists?.(10)).toEqual([
      { id: 'spotify:kite', name: 'Kite Weather', image: 'face' },
    ]);
  });
});
