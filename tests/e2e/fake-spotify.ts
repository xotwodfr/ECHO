import { readFileSync } from 'node:fs';
import type { Page, Request, Route } from '@playwright/test';

// A fake Spotify for E2E (IMPLEMENTATION_PLAN.md M7: "E with a fake Spotify provider"): Playwright
// serves a stand-in Web Playback SDK at sdk.scdn.co, answers api.spotify.com from a small
// catalogue, and serves i.scdn.co covers. ECHO's code is the production code; only the network is
// fake. The SDK stand-in plays on a wall clock and reports state like the real one.

const id = (s: string) => s.padEnd(22, '0').slice(0, 22);
const COVER = readFileSync('src/client/shell/gallery-cover.svg');

export const SP_ALBUM = {
  id: id('northernstatic'),
  name: 'Northern Static',
  artists: [{ id: id('kiteweather'), name: 'Kite Weather' }],
  images: [{ url: 'https://i.scdn.co/image/northern-static', width: 640, height: 640 }],
  release_date: '2024-03-01',
};
export const SP_TRACKS = ['Signal Fires', 'Long Wave', 'Dial Tone'].map((name, i) => ({
  id: id(`ns${i + 1}track`),
  name,
  duration_ms: 180_000 + i * 10_000,
  artists: SP_ALBUM.artists,
  type: 'track',
}));
export const SP_PLAYLIST = { id: id('nightdrive'), name: 'Night Drive' };
/** Named like the mock Navidrome's album the mock LRCLIB knows, so Spotify tracks get lyrics. */
export const SP_GLASS = {
  id: id('glassweather'),
  name: 'Glass Weather',
  artists: [{ id: id('mirasole'), name: 'Mira Sole' }],
  images: [{ url: 'https://i.scdn.co/image/glass-weather-300', width: 300, height: 300 }],
  release_date: '2023-01-01',
};
export const SP_GLASS_TRACKS = [1, 2].map((n) => ({
  id: id(`gw${n}track`),
  name: `Glass Weather ${n}`,
  duration_ms: (20 + (n - 1) * 5) * 1000,
  artists: SP_GLASS.artists,
  type: 'track',
}));

type SpTrack = (typeof SP_TRACKS)[number];
const ALBUMS = [
  { album: SP_ALBUM, tracks: SP_TRACKS },
  { album: SP_GLASS, tracks: SP_GLASS_TRACKS },
];
const albumFull = (a = ALBUMS[0] as (typeof ALBUMS)[number]) => ({
  ...a.album,
  tracks: { items: a.tracks, next: null },
});
const albumOfTrack = (t: SpTrack) =>
  (ALBUMS.find((a) => a.tracks.includes(t)) ?? ALBUMS[0])?.album as typeof SP_ALBUM;
const ALL_TRACKS = ALBUMS.flatMap((a) => a.tracks);
const sdkTrack = (t: SpTrack) => ({
  id: t.id,
  uri: `spotify:track:${t.id}`,
  name: t.name,
  duration_ms: t.duration_ms,
  artists: t.artists.map((a) => ({ name: a.name, uri: `spotify:artist:${a.id}` })),
  album: {
    name: albumOfTrack(t).name,
    uri: `spotify:album:${albumOfTrack(t).id}`,
    images: albumOfTrack(t).images,
  },
});

/** The stand-in SDK, as page script. `window.__fakeSpotify` lets a test drive it. */
const SDK = `(() => {
  const listeners = {};
  const fire = (e, a) => (listeners[e] || []).forEach((cb) => cb(a));
  let tracks = [], idx = 0, paused = true, anchor = 0, base = 0, active = false;
  const pos = () => (paused ? base : base + Date.now() - anchor);
  const snap = () => tracks.length ? {
    paused, position: Math.round(pos()), duration: tracks[idx].duration_ms, loading: false,
    shuffle: false, repeat_mode: 0,
    track_window: { current_track: tracks[idx], next_tracks: tracks.slice(idx + 1, idx + 3), previous_tracks: [] },
  } : null;
  const emit = () => fire('player_state_changed', active ? snap() : null);
  class Player {
    constructor(o) { this.o = o; window.__fakeSpotify.options = o; }
    addListener(e, cb) { (listeners[e] = listeners[e] || []).push(cb); return true; }
    connect() { setTimeout(() => fire('ready', { device_id: 'fake-echo-device' }), 20); return Promise.resolve(true); }
    disconnect() {}
    getCurrentState() { return Promise.resolve(active ? snap() : null); }
    resume() { if (paused) { anchor = Date.now(); paused = false; } emit(); return Promise.resolve(); }
    pause() { base = pos(); paused = true; emit(); return Promise.resolve(); }
    seek(ms) { base = ms; anchor = Date.now(); emit(); return Promise.resolve(); }
    setVolume(v) { window.__fakeSpotify.volume = v; return Promise.resolve(); }
    nextTrack() { if (idx < tracks.length - 1) { idx++; base = 0; anchor = Date.now(); } emit(); return Promise.resolve(); }
    previousTrack() { if (idx > 0) idx--; base = 0; anchor = Date.now(); emit(); return Promise.resolve(); }
    activateElement() { return Promise.resolve(); }
  }
  window.__fakeSpotify = {
    fire,
    play(list, offset, positionMs) {
      tracks = list; idx = offset; base = positionMs || 0; anchor = Date.now(); paused = false; active = true;
      setTimeout(emit, 30);
    },
    /** Playback moved to another device: this one goes quiet. */
    moveAway() { base = pos(); paused = true; active = false; emit(); },
    transferHere(play) { active = true; if (play) { paused = false; anchor = Date.now(); } emit(); },
  };
  window.Spotify = { Player };
  setTimeout(() => window.onSpotifyWebPlaybackSDKReady && window.onSpotifyWebPlaybackSDKReady(), 0);
})();`;

export interface FakeSpotify {
  requests: { method: string; path: string; query: URLSearchParams; body: unknown }[];
  /** What GET /v1/me/player reports (the remote device), when set. */
  device: { id: string; name: string } | null;
}

/** Installs the fake on `page`; call before the first navigation. */
export async function fakeSpotify(page: Page): Promise<FakeSpotify> {
  const fake: FakeSpotify = { requests: [], device: null };
  // Widevine present: the real check runs against this stand-in (BRW-02 stubs it off itself).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMediaKeySystemAccess', {
      configurable: true,
      value: async () => ({}),
    });
  });
  await page.route('https://sdk.scdn.co/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: SDK }),
  );
  await page.route('https://i.scdn.co/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: COVER }),
  );
  await page.route('https://api.spotify.com/**', (route, req) => answer(page, fake, route, req));
  return fake;
}

async function answer(page: Page, fake: FakeSpotify, route: Route, req: Request) {
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData() as string) : undefined;
  const method = req.method();
  fake.requests.push({ method, path: url.pathname, query: url.searchParams, body });
  const json = (data: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const p = url.pathname;
  if (method === 'GET' && p === '/v1/me') return json({ id: 'mock-user', product: 'premium' });
  if (method === 'GET' && p === '/v1/me/albums')
    return json({ items: ALBUMS.map((a) => ({ album: albumFull(a) })), next: null });
  const album = ALBUMS.find((a) => p === `/v1/albums/${a.album.id}`);
  if (method === 'GET' && album) return json(albumFull(album));
  if (method === 'GET' && p === '/v1/me/playlists')
    return json({
      items: [
        { ...SP_PLAYLIST, collaborative: false, owner: { id: 'mock-user' }, items: { total: 2 } },
        // Followed but not owned: unreadable for Development Mode apps, so not listed.
        { id: id('someoneelse'), name: 'Not Mine', collaborative: false, owner: { id: 'x' } },
      ],
      next: null,
    });
  if (method === 'GET' && p === `/v1/playlists/${SP_PLAYLIST.id}/items`)
    return json({
      items: SP_TRACKS.slice(0, 2).map((t) => ({ item: { ...t, album: SP_ALBUM } })),
      next: null,
    });
  if (method === 'GET' && p === '/v1/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const limit = Number(url.searchParams.get('limit'));
    if (limit > 10) return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
    const hit = (s: string) => s.toLowerCase().includes(q);
    return json({
      tracks: {
        items: SP_TRACKS.filter((t) => hit(t.name) || hit('kite weather')).map((t) => ({
          ...t,
          album: SP_ALBUM,
        })),
      },
      albums: { items: hit(SP_ALBUM.name) || hit('kite weather') ? [SP_ALBUM] : [] },
    });
  }
  if (method === 'PUT' && p === '/v1/me/player') {
    if (body?.play)
      await page.evaluate(() => (window as never as Fake).__fakeSpotify.transferHere(true));
    return route.fulfill({ status: 204 });
  }
  if (method === 'GET' && p === '/v1/me/player')
    return json(fake.device ? { device: fake.device } : {});
  if (method === 'PUT' && p === '/v1/me/player/play') {
    const offset = body?.offset?.position ?? 0;
    const list = body?.context_uri
      ? (ALBUMS.find((a) => body.context_uri.endsWith(a.album.id))?.tracks ?? SP_TRACKS)
      : (body.uris as string[]).map(
          (u) => ALL_TRACKS.find((t) => u.endsWith(t.id)) ?? SP_TRACKS[0],
        );
    await page.evaluate(
      ([tracks, o, ms]) => (window as never as Fake).__fakeSpotify.play(tracks, o, ms),
      [
        list.map((t) => sdkTrack(t as (typeof SP_TRACKS)[number])),
        offset,
        body?.position_ms ?? 0,
      ] as const,
    );
    return route.fulfill({ status: 204 });
  }
  if (method === 'GET' && p === '/v1/me/player/queue')
    return json({ currently_playing: null, queue: [] });
  return route.fulfill({ status: 204 });
}

type Fake = {
  __fakeSpotify: {
    play(t: unknown[], o: number, ms: number): void;
    transferHere(play: boolean): void;
  };
};
