import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, ProviderState, Track } from '../../shared/types.ts';
import { forgetSpotifyToken } from '../spotify/api.ts';
import { ManualClock } from './clock.ts';
import {
  type SdkNamespace,
  type SdkPlayer,
  type SdkState,
  type SdkTrack,
  SpotifyProvider,
  spotifyStore,
  trackFromSdk,
} from './spotify.ts';

// PLAYBACK_ARCHITECTURE.md §4: the SDK device, transfer then play, state mapping, polling, the
// remote state, and the error states (REL-04), against a fake SDK and a fake Web API.

const sdkTrack = (n: number): SdkTrack => ({
  id: `${'t'.repeat(21)}${n}`,
  uri: `spotify:track:${'t'.repeat(21)}${n}`,
  name: `Song ${n}`,
  duration_ms: 200_000,
  artists: [{ name: 'Band', uri: 'spotify:artist:a1' }],
  album: {
    name: 'Record',
    uri: `spotify:album:${'a'.repeat(22)}`,
    images: [{ url: 'https://i.scdn.co/image/x', width: 640, height: 640 }],
  },
});

const state = (over: Partial<SdkState> = {}): SdkState => ({
  paused: false,
  position: 1000,
  duration: 200_000,
  shuffle: false,
  repeat_mode: 0,
  track_window: { current_track: sdkTrack(1), next_tracks: [sdkTrack(2), sdkTrack(3)] },
  ...over,
});

class FakePlayer implements SdkPlayer {
  static last: FakePlayer;
  listeners = new Map<string, (arg: never) => void>();
  calls: string[] = [];
  current: SdkState | null = null;
  readyOnConnect = true;
  readonly opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void };
  constructor(opts: FakePlayer['opts']) {
    this.opts = opts;
    FakePlayer.last = this;
  }
  fire(event: string, arg?: unknown) {
    this.listeners.get(event)?.(arg as never);
  }
  async connect() {
    this.calls.push('connect');
    if (this.readyOnConnect) queueMicrotask(() => this.fire('ready', { device_id: 'echo-device' }));
    return true;
  }
  disconnect() {
    this.calls.push('disconnect');
  }
  addListener(event: string, cb: (arg: never) => void) {
    this.listeners.set(event, cb);
    return true;
  }
  async getCurrentState() {
    this.calls.push('getCurrentState');
    return this.current;
  }
  async resume() {
    this.calls.push('resume');
  }
  async pause() {
    this.calls.push('pause');
  }
  async seek(ms: number) {
    this.calls.push(`seek ${ms}`);
  }
  async setVolume(v: number) {
    this.calls.push(`volume ${v.toFixed(3)}`);
  }
  async nextTrack() {
    this.calls.push('next');
  }
  async previousTrack() {
    this.calls.push('previous');
  }
  async activateElement() {
    this.calls.push('activate');
  }
}

const sdk = async () => ({ Player: FakePlayer }) as unknown as SdkNamespace;
let web: { method: string; url: URL; body: unknown }[];
let tokenStatus: number;
let webStatus: (url: URL) => number;
let player: { device?: { id: string; name: string } };

beforeEach(() => {
  web = [];
  tokenStatus = 200;
  webStatus = () => 204;
  player = {};
  forgetSpotifyToken();
  spotifyStore.setState({ status: 'idle', error: null, remoteDevice: null, offerRetry: false });
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const u = String(input);
    if (u === '/api/v1/spotify/token')
      return tokenStatus === 200
        ? Response.json({ accessToken: 'at', expiresAt: Date.now() + 3_600_000 })
        : Response.json({ error: 'spotify.expired' }, { status: tokenStatus });
    const url = new URL(u);
    web.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.pathname === '/v1/me/player' && (init?.method ?? 'GET') === 'GET')
      return Response.json(player);
    return new Response(null, { status: webStatus(url) });
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const clock = new ManualClock();
  const p = new SpotifyProvider({ clock, sdk });
  const states: ProviderState[] = [];
  const errors: AppError[] = [];
  p.on('state', (s) => states.push(s));
  p.on('error', (e) => errors.push(e));
  return { p, clock, states, errors };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const tr = (n: number): Track => trackFromSdk(sdkTrack(n));

describe('SpotifyProvider', () => {
  it('creates the device "ECHO" with a token from ECHO, and reports ready', async () => {
    const { p } = setup();
    await p.connect();
    expect(FakePlayer.last.opts.name).toBe('ECHO');
    const token = await new Promise((r) => FakePlayer.last.opts.getOAuthToken(r));
    expect(token).toBe('at');
    expect(spotifyStore.getState().status).toBe('ready');
    expect(p.capabilities).toMatchObject({
      canReorderQueue: false,
      canRemoveFromQueue: false,
      canCrossfade: false,
      audioFeatures: false,
      requiresAttribution: 'spotify',
    });
  });

  it('transfers to ECHO once, then plays an album by its context URI from the offset', async () => {
    const { p } = setup();
    const ctx = { kind: 'album' as const, id: 'a'.repeat(22), title: 'Record' };
    await p.playContext(ctx, 2, [tr(1), tr(2), tr(3)]);
    await p.playContext(ctx, 0, [tr(1), tr(2), tr(3)]);
    const calls = web.map((w) => `${w.method} ${w.url.pathname}`);
    expect(calls).toEqual([
      'PUT /v1/me/player',
      'PUT /v1/me/player/play',
      'PUT /v1/me/player/play',
    ]);
    expect(web[0]?.body).toEqual({ device_ids: ['echo-device'], play: false });
    expect(web[1]?.url.searchParams.get('device_id')).toBe('echo-device');
    expect(web[1]?.body).toEqual({
      context_uri: `spotify:album:${'a'.repeat(22)}`,
      offset: { position: 2 },
    });
    expect(FakePlayer.last.calls).toContain('activate');
  });

  it('plays other lists (search results) as track URIs', async () => {
    const { p } = setup();
    await p.playContext({ kind: 'search', title: 'q' }, 1, [tr(1), tr(2)]);
    expect(web.at(-1)?.body).toEqual({
      uris: [tr(1), tr(2)].map((t) => `spotify:track:${t.id}`),
      offset: { position: 1 },
    });
  });

  it('maps SDK state, stamps it on receipt, and polls every second while playing', async () => {
    const { p, clock, states } = setup();
    await p.connect();
    clock.advance(500);
    FakePlayer.last.fire('player_state_changed', state());
    const s = states.at(-1) as ProviderState;
    expect(s).toMatchObject({ positionMs: 1000, positionAt: 500, paused: false, buffering: false });
    expect(s.track).toMatchObject({
      key: `spotify:${'t'.repeat(21)}1`,
      spotifyId: `${'t'.repeat(21)}1`,
      album: { key: `spotify:album:${'a'.repeat(22)}` },
      artwork: [{ url: 'https://i.scdn.co/image/x', width: 640, height: 640 }],
    });
    expect(s.upcoming?.map((t) => t.title)).toEqual(['Song 2', 'Song 3']);
    FakePlayer.last.current = state({ position: 2000 });
    clock.advance(1000);
    await flush();
    expect(FakePlayer.last.calls.filter((c) => c === 'getCurrentState')).toHaveLength(1);
    expect(states.at(-1)?.positionMs).toBe(2000);
    // Paused: polling stops.
    FakePlayer.last.fire('player_state_changed', state({ paused: true }));
    clock.advance(5000);
    await flush();
    expect(FakePlayer.last.calls.filter((c) => c === 'getCurrentState')).toHaveLength(1);
  });

  it('transport goes to the SDK; shuffle and repeat to the Web API; volume is perceptual', async () => {
    const { p } = setup();
    await p.connect();
    await p.seek(42_000.4);
    await p.skipNext();
    await p.skipPrevious();
    await p.setVolume(0.5);
    await p.setShuffle(true);
    await p.setRepeat('one');
    await p.enqueue(tr(4));
    expect(FakePlayer.last.calls).toEqual(
      expect.arrayContaining(['seek 42000', 'next', 'previous', 'volume 0.125']),
    );
    expect(web.map((w) => `${w.method} ${w.url.pathname}${w.url.search}`)).toEqual([
      'PUT /v1/me/player/shuffle?state=true',
      'PUT /v1/me/player/repeat?state=track',
      `POST /v1/me/player/queue?uri=spotify%3Atrack%3A${tr(4).id}&device_id=echo-device`,
    ]);
  });

  it('remote state: playback moved away shows the device; "Play here" takes it back (§4.7)', async () => {
    const { p, clock } = setup();
    await p.playContext({ kind: 'album', id: 'a'.repeat(22), title: 'R' }, 0, [tr(1)]);
    FakePlayer.last.fire('player_state_changed', state());
    player = { device: { id: 'phone', name: 'Kitchen speaker' } };
    FakePlayer.last.fire('player_state_changed', null);
    await flush();
    expect(spotifyStore.getState().remoteDevice).toBe('Kitchen speaker');
    clock.advance(5000);
    await flush();
    expect(web.filter((w) => w.method === 'GET').length).toBe(2); // polled every 5 s
    await p.playHere();
    expect(web.at(-1)?.body).toEqual({ device_ids: ['echo-device'], play: true });
    expect(spotifyStore.getState().remoteDevice).toBeNull();
  });

  it('not_ready: reconnects with backoff and offers Retry after 60 s', async () => {
    const { p, clock } = setup();
    await p.connect();
    FakePlayer.last.readyOnConnect = false;
    FakePlayer.last.fire('not_ready', { device_id: 'echo-device' });
    expect(spotifyStore.getState()).toMatchObject({ status: 'reconnecting', offerRetry: false });
    clock.advance(1000);
    await flush();
    expect(FakePlayer.last.calls.filter((c) => c === 'connect')).toHaveLength(2);
    clock.advance(61_000);
    FakePlayer.last.fire('not_ready', {});
    expect(spotifyStore.getState().offerRetry).toBe(true);
    FakePlayer.last.readyOnConnect = true;
    p.retry();
    await flush();
    await flush();
    expect(spotifyStore.getState()).toMatchObject({ status: 'ready', offerRetry: false });
  });

  it('account_error → Premium; authentication_error refreshes once, then "sign-in expired"', async () => {
    const { p, errors } = setup();
    await p.connect();
    FakePlayer.last.fire('account_error', { message: 'premium' });
    expect(errors.at(-1)?.code).toBe('spotify.premium');
    tokenStatus = 401;
    FakePlayer.last.fire('authentication_error', { message: 'bad token' });
    await flush();
    await flush();
    expect(errors.at(-1)).toMatchObject({ code: 'spotify.expired', retriable: false });
    expect(spotifyStore.getState().error?.code).toBe('spotify.expired');
  });

  it('a 403 from the Web API names the missing user-list entry', async () => {
    const { p, errors } = setup();
    webStatus = () => 403;
    await p.playContext({ kind: 'album', id: 'a'.repeat(22), title: 'R' }, 0, [tr(1)]);
    expect(errors.at(-1)?.code).toBe('spotify.not_on_user_list');
  });
});
