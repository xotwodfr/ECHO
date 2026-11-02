import { createStore } from 'zustand/vanilla';
import type {
  AppError,
  PlaybackProvider,
  PlayContext,
  ProviderCapabilities,
  ProviderState,
  Track,
  Unsubscribe,
} from '../../shared/types.ts';
import { assertSpotifyReady, SpotifyError, spotifyApi, spotifyToken } from '../spotify/api.ts';
import { strings } from '../strings.ts';
import { type Clock, realClock } from './clock.ts';
import { SILENT_FEATURES } from './features.ts';

// SpotifyProvider (PLAYBACK_ARCHITECTURE.md §4): the Web Playback SDK device "ECHO", loaded only
// once Spotify is connected, and the Web API for transfer, contexts, shuffle, repeat and the queue.
// Spotify owns its queue (§6.1): ECHO mirrors what the SDK says comes next. The SDK's state events
// arrive "at random intervals" with no timestamp, so the provider polls once a second while playing
// and stamps each sample on receipt (§4.3). No audio reaches ECHO: features are Ambient's.

export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 1000;
const REMOTE_POLL_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];
/** After this long reconnecting, the dock offers "Retry" (§8). */
export const OFFER_RETRY_MS = 60_000;

/** The parts of the SDK ECHO uses (developer.spotify.com/documentation/web-playback-sdk/reference). */
export interface SdkTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string; uri: string }[];
  album: { name: string; uri: string; images: { url: string; width?: number; height?: number }[] };
}
export interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  loading?: boolean;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2;
  track_window: { current_track: SdkTrack | null; next_tracks: SdkTrack[] };
}
export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: never) => void): boolean;
  getCurrentState(): Promise<SdkState | null>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  activateElement?(): Promise<void>;
}
export interface SdkNamespace {
  Player: new (opts: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SdkPlayer;
}

export type SpotifyStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'error';

/** What the dock and Settings show about the Spotify device. */
export const spotifyStore = createStore<{
  status: SpotifyStatus;
  error: AppError | null;
  /** Playback moved to another Spotify device (§4.7): its name. */
  remoteDevice: string | null;
  /** Reconnecting for longer than OFFER_RETRY_MS. */
  offerRetry: boolean;
}>()(() => ({ status: 'idle', error: null, remoteDevice: null, offerRetry: false }));

/** Loads the SDK script once and resolves with `window.Spotify`. */
export function loadSdk(): Promise<SdkNamespace> {
  const w = window as unknown as {
    Spotify?: SdkNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  };
  if (w.Spotify) return Promise.resolve(w.Spotify);
  return new Promise((resolve, reject) => {
    w.onSpotifyWebPlaybackSDKReady = () => resolve(w.Spotify as SdkNamespace);
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onerror = () => reject(new Error('sdk load failed'));
    document.head.append(s);
  });
}

/** Spotify album and playlist ids are base62, 22 characters. */
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const idOf = (uri: string) => uri.split(':').pop() ?? '';

export function trackFromSdk(t: SdkTrack): Track {
  const id = t.id ?? idOf(t.uri);
  return {
    key: `spotify:${id}`,
    provider: 'spotify',
    id,
    spotifyId: id,
    title: t.name,
    artists: t.artists.map((a) => ({ id: `spotify:${idOf(a.uri)}`, name: a.name })), // ECHO's artist id
    album: {
      id: `spotify:${idOf(t.album.uri)}`, // ECHO's album id (library-spotify.ts)
      title: t.album.name,
      key: `spotify:album:${idOf(t.album.uri)}`,
    },
    durationMs: t.duration_ms,
    artwork: t.album.images.map((i) => ({
      url: i.url,
      ...(i.width && { width: i.width }),
      ...(i.height && { height: i.height }),
    })),
  };
}

type Events = { state: ProviderState; ended: undefined; error: AppError };

export class SpotifyProvider implements PlaybackProvider {
  readonly id = 'spotify' as const;
  readonly label = 'Spotify';
  readonly capabilities: ProviderCapabilities;

  private player: SdkPlayer | null = null;
  private deviceId: string | null = null;
  private connecting: Promise<void> | null = null;
  private active = false;
  private last: ProviderState | null = null;
  private volume = 1;
  private pollTimer: ReturnType<Clock['setTimeout']> | null = null;
  private remoteTimer: ReturnType<Clock['setTimeout']> | null = null;
  private retryTimer: ReturnType<Clock['setTimeout']> | null = null;
  private attempt = 0;
  private reconnectingSince: number | null = null;
  private authRetried = false;
  private listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = {
    state: new Set(),
    ended: new Set(),
    error: new Set(),
  };
  private readonly clock: Clock;
  private readonly sdk: () => Promise<SdkNamespace>;

  constructor(
    opts: {
      gates?: { artPalette: boolean; syncedLyrics: boolean };
      clock?: Clock;
      sdk?: () => Promise<SdkNamespace>;
    } = {},
  ) {
    this.clock = opts.clock ?? realClock;
    this.sdk = opts.sdk ?? loadSdk;
    const gates = opts.gates ?? { artPalette: true, syncedLyrics: true };
    this.capabilities = {
      canSeek: true,
      canSetVolume: true,
      canReorderQueue: false,
      canRemoveFromQueue: false,
      canCrossfade: false, // Policy III.7
      audioFeatures: false, // DRM: no PCM, and Policy III.13
      artPaletteAllowed: gates.artPalette,
      syncedLyricsAllowed: gates.syncedLyrics,
      requiresAttribution: 'spotify',
    };
  }

  connect(): Promise<void> {
    if (this.deviceId) return Promise.resolve();
    this.connecting ??= this.start().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async start() {
    assertSpotifyReady(); // the SDK's own calls to Spotify count against the same app limit
    spotifyStore.setState({ status: this.reconnectingSince ? 'reconnecting' : 'connecting' });
    const Spotify = await this.sdk();
    if (!this.player) {
      const p = new Spotify.Player({
        name: 'ECHO',
        volume: this.volume ** 3,
        getOAuthToken: (cb) => {
          spotifyToken(this.authRetried).then(cb, (e: unknown) => this.fail(e));
        },
      });
      this.player = p;
      p.addListener('ready', ({ device_id }: { device_id: string }) => this.onReady(device_id));
      p.addListener('not_ready', () => this.onNotReady());
      p.addListener('player_state_changed', (s: SdkState | null) => this.onSdkState(s));
      p.addListener('autoplay_failed', () => this.onSdkState(null, true));
      p.addListener('initialization_error', ({ message }: { message: string }) =>
        this.emitError('spotify.init', strings.spotify.drm.other, false, message),
      );
      p.addListener('authentication_error', () => void this.onAuthError());
      p.addListener('account_error', () =>
        this.emitError('spotify.premium', strings.spotify.premium, false),
      );
      p.addListener('playback_error', ({ message }: { message: string }) =>
        this.emitError('spotify.playback', strings.spotify.playbackFailed, true, message),
      );
    }
    if (this.readyTimer) this.clock.clearTimeout(this.readyTimer);
    const ready = new Promise<void>((resolve, reject) => {
      this.readyTimer = this.clock.setTimeout(() => {
        this.readyTimer = null;
        reject(new Error('ready timeout'));
      }, READY_TIMEOUT_MS);
      this.onReadyOnce = resolve;
    });
    if (!(await this.player.connect())) throw new Error('connect refused');
    await ready;
  }

  private onReadyOnce: (() => void) | null = null;
  private readyTimer: ReturnType<Clock['setTimeout']> | null = null;
  private gen = 0;

  private onReady(deviceId: string) {
    this.deviceId = deviceId;
    this.attempt = 0;
    this.reconnectingSince = null;
    this.authRetried = false;
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.readyTimer) this.clock.clearTimeout(this.readyTimer);
    this.readyTimer = null;
    spotifyStore.setState({ status: 'ready', error: null, offerRetry: false });
    this.onReadyOnce?.();
    this.onReadyOnce = null;
  }

  /** §8: "Reconnecting to Spotify…" with backoff; after 60 s the dock offers Retry. */
  private onNotReady() {
    if (this.retryTimer) return; // a reconnect is already scheduled
    this.deviceId = null;
    this.active = false;
    this.reconnectingSince ??= this.clock.now();
    spotifyStore.setState({
      status: 'reconnecting',
      offerRetry: this.clock.now() - this.reconnectingSince >= OFFER_RETRY_MS,
    });
    const wait = BACKOFF_MS[Math.min(this.attempt++, BACKOFF_MS.length - 1)] as number;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.player?.disconnect();
      this.reconnect();
    }, wait);
  }

  /** A connect attempt whose failure counts only while it is still the latest one. */
  private reconnect() {
    const gen = ++this.gen;
    void this.connect().catch(() => {
      if (gen === this.gen && !this.deviceId) this.onNotReady();
    });
  }

  /** "Retry" in the dock: reconnect now. */
  retry() {
    this.attempt = 0;
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.player?.disconnect();
    this.connecting = null; // a fresh attempt, not the one still waiting for "ready"
    this.reconnect();
  }

  /** §8: refresh once through ECHO; when that fails too, "sign-in expired". */
  private async onAuthError() {
    if (this.authRetried) return this.emitError('spotify.expired', strings.spotify.expired, false);
    this.authRetried = true;
    try {
      await spotifyToken(true);
      this.player?.disconnect();
      this.deviceId = null;
      await this.connect();
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    if (e instanceof SpotifyError)
      this.emitError(e.appError.code, e.appError.userMessage, e.appError.retriable);
    else this.emitError('spotify.unavailable', strings.spotify.unavailable, true, String(e));
  }

  private emitError(code: string, userMessage: string, retriable: boolean, detail?: string) {
    const e: AppError = {
      code,
      provider: 'spotify',
      retriable,
      userMessage,
      ...(detail && { detail }),
    };
    spotifyStore.setState({ status: 'error', error: e });
    for (const cb of this.listeners.error) cb(e);
  }

  async disconnect() {
    this.stopPolling();
    if (this.remoteTimer) this.clock.clearTimeout(this.remoteTimer);
    if (this.retryTimer) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this.active = false;
    spotifyStore.setState({ status: 'idle', remoteDevice: null, error: null, offerRetry: false });
  }

  /** Makes ECHO's device the active one, then plays `body` on it (§4.3 step 4). */
  private async playOnDevice(body: Record<string, unknown>) {
    try {
      await this.connect();
      await this.player?.activateElement?.(); // inside the user's gesture (autoplay policy)
      const device = this.deviceId as string;
      if (!this.active) {
        await spotifyApi('/v1/me/player', {
          method: 'PUT',
          body: { device_ids: [device], play: false },
        });
        this.active = true;
      }
      await spotifyApi('/v1/me/player/play', { method: 'PUT', query: { device_id: device }, body });
      this.leaveRemote();
    } catch (e) {
      this.fail(e);
    }
  }

  async load(track: Track, opts: { startMs?: number; autoplay: boolean }) {
    this.emit({
      track,
      positionMs: opts.startMs ?? 0,
      positionAt: this.clock.now(),
      paused: true,
      buffering: true,
    });
    await this.playOnDevice({
      uris: [`spotify:track:${track.id}`],
      position_ms: Math.round(opts.startMs ?? 0),
    });
    if (!opts.autoplay) await this.player?.pause();
  }

  async playContext(ctx: PlayContext, offset: number, tracks: Track[]) {
    const id = (ctx.id ?? '').replace(/^spotify:/, ''); // ECHO prefixes Spotify ids
    const byUri = (ctx.kind === 'album' || ctx.kind === 'playlist') && SPOTIFY_ID.test(id);
    const first = tracks[offset];
    if (first)
      this.emit({
        track: first,
        positionMs: 0,
        positionAt: this.clock.now(),
        paused: true,
        buffering: true,
      });
    await this.playOnDevice(
      byUri
        ? { context_uri: `spotify:${ctx.kind}:${id}`, offset: { position: offset } }
        : { uris: tracks.map((t) => `spotify:track:${t.id}`), offset: { position: offset } },
    );
  }

  async play() {
    await this.player?.activateElement?.();
    await this.player?.resume();
  }

  async pause() {
    await this.player?.pause();
  }

  async seek(ms: number) {
    await this.player?.seek(Math.round(ms));
  }

  async setVolume(v: number) {
    this.volume = v;
    await this.player?.setVolume(v ** 3); // §3: perceptual, per device
  }

  async skipNext() {
    await this.player?.nextTrack();
  }

  async skipPrevious() {
    await this.player?.previousTrack();
  }

  async setShuffle(on: boolean) {
    await spotifyApi('/v1/me/player/shuffle', {
      method: 'PUT',
      query: { state: String(on) },
    }).catch((e: unknown) => this.fail(e));
  }

  async setRepeat(mode: 'off' | 'all' | 'one') {
    const state = { off: 'off', all: 'context', one: 'track' }[mode];
    await spotifyApi('/v1/me/player/repeat', { method: 'PUT', query: { state } }).catch(
      (e: unknown) => this.fail(e),
    );
  }

  /** Spotify's queue takes additions at the end only (§6.1). */
  async enqueue(track: Track) {
    await spotifyApi('/v1/me/player/queue', {
      method: 'POST',
      query: {
        uri: `spotify:track:${track.id}`,
        ...(this.deviceId && { device_id: this.deviceId }),
      },
    }).catch((e: unknown) => this.fail(e));
  }

  /** "Play here" (§4.7): take playback back from the other device. */
  async playHere() {
    await this.connect();
    await this.player?.activateElement?.();
    await spotifyApi('/v1/me/player', {
      method: 'PUT',
      body: { device_ids: [this.deviceId], play: true },
    }).catch((e: unknown) => this.fail(e));
    this.active = true;
    this.leaveRemote();
  }

  on<K extends keyof Events>(event: K, cb: (e: Events[K]) => void): Unsubscribe {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  features() {
    return SILENT_FEATURES; // Ambient (VISUALIZER_SPEC.md §2.2)
  }

  // ---- state ----------------------------------------------------------------------------------

  /** A null state means this device is no longer playing: playback moved elsewhere (§4.7). */
  private onSdkState(s: SdkState | null, autoplayBlocked = false) {
    if (!s) {
      if (autoplayBlocked && this.last) this.emit({ ...this.last, paused: true, buffering: false });
      else if (this.active) void this.enterRemote();
      return;
    }
    const current = s.track_window.current_track;
    this.emit({
      track: current ? trackFromSdk(current) : null,
      positionMs: s.position,
      positionAt: this.clock.now(),
      paused: s.paused,
      buffering: !!s.loading,
      upcoming: s.track_window.next_tracks.map(trackFromSdk),
      shuffle: s.shuffle,
      repeat: (['off', 'all', 'one'] as const)[s.repeat_mode],
    });
    if (!s.paused) this.schedulePoll();
    else this.stopPolling();
  }

  private schedulePoll() {
    if (this.pollTimer) return;
    this.pollTimer = this.clock.setTimeout(async () => {
      this.pollTimer = null;
      const s = await this.player?.getCurrentState();
      if (s !== undefined) this.onSdkState(s);
    }, POLL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async enterRemote() {
    this.active = false;
    this.stopPolling();
    if (this.last) this.emit({ ...this.last, paused: true, buffering: false });
    const pollRemote = async () => {
      this.remoteTimer = null;
      const p = await spotifyApi<{ device?: { name: string; id: string } }>('/v1/me/player').catch(
        () => null,
      );
      const device = p?.device && p.device.id !== this.deviceId ? p.device.name : null;
      spotifyStore.setState({ remoteDevice: device });
      if (device) this.remoteTimer = this.clock.setTimeout(pollRemote, REMOTE_POLL_MS);
    };
    await pollRemote();
  }

  private leaveRemote() {
    if (this.remoteTimer) this.clock.clearTimeout(this.remoteTimer);
    this.remoteTimer = null;
    spotifyStore.setState({ remoteDevice: null });
  }

  private emit(s: ProviderState) {
    this.last = s;
    for (const cb of this.listeners.state) cb(s);
  }
}
