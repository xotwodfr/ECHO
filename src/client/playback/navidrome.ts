import type {
  AppError,
  FeatureSource,
  PlaybackProvider,
  ProviderCapabilities,
  ProviderState,
  Track,
  Unsubscribe,
} from '../../shared/types.ts';
import { api } from '../api.ts';
import { reportDown } from '../connection.ts';
import { AnalyserFeatures } from './analyser.ts';
import { type AudioPath, createAudioPath } from './audio.ts';

// NavidromeProvider (PLAYBACK_ARCHITECTURE.md §5): the signed-in user's own Navidrome through
// ECHO's proxy. Raw when the browser can play the file (native seeking over Range), else Opus 192
// transcoded by Navidrome, sought by reloading with `timeOffset`. ReplayGain, scrobbling and the
// Media Session. One <audio>; the A/B pair for gapless and crossfade is a follow-up.

export const NAVIDROME_CAPABILITIES: ProviderCapabilities = {
  canSeek: true,
  canSetVolume: true,
  canReorderQueue: true,
  canRemoveFromQueue: true,
  canCrossfade: false,
  audioFeatures: true,
  artPaletteAllowed: true,
  syncedLyricsAllowed: true,
  requiresAttribution: null,
};

type Events = { state: ProviderState; ended: undefined; error: AppError };
/** Navidrome song fields the library mapping keeps on the track (library-navidrome.ts). */
export type NavidromeTrack = Track & { contentType?: string };

const SCROBBLE_MS = 4 * 60_000;

export class NavidromeProvider implements PlaybackProvider {
  readonly id = 'navidrome' as const;
  readonly capabilities = NAVIDROME_CAPABILITIES;
  readonly label = 'Navidrome';

  private readonly audio: AudioPath;
  /** Live features from the analyser tap (VISUALIZER_SPEC.md §3), aligned to what is audible. */
  private readonly live: AnalyserFeatures;
  private track: NavidromeTrack | null = null;
  private loading = false;
  private loads = 0;
  private startMs = 0;
  /** Seconds the current transcode was started at (`timeOffset`); 0 for raw. */
  private offsetS = 0;
  private transcode = false;
  private wantPlay = false;
  private waiting = false;
  private scrobbled: 'none' | 'now' | 'done' = 'none';
  private retries = 0;
  private listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = {
    state: new Set(),
    ended: new Set(),
    error: new Set(),
  };

  private readonly opts: { transcodeOffset: boolean; scrobble: boolean };

  constructor(
    el: HTMLAudioElement = new Audio(),
    opts: { transcodeOffset: boolean; scrobble: boolean } = {
      transcodeOffset: true,
      scrobble: true,
    },
  ) {
    this.opts = opts;
    this.audio = createAudioPath(el);
    this.live = new AnalyserFeatures({
      tap: () => this.audio.analyser(),
      latencyMs: () => this.audio.latencyMs(),
      playing: () => !el.paused,
    });
    el.preload = 'auto';
    const sync = () => this.emitState();
    for (const e of ['play', 'pause', 'seeked'] as const) el.addEventListener(e, sync);
    el.addEventListener('waiting', () => {
      this.waiting = true;
      this.emitState();
    });
    el.addEventListener('playing', () => {
      this.waiting = false;
      this.emitState();
      this.scrobble();
    });
    el.addEventListener('timeupdate', () => this.scrobble());
    el.addEventListener('ended', () => {
      this.emitState();
      this.emit('ended', undefined);
    });
    el.addEventListener('error', () => {
      if (!el.error || !this.track) return;
      // REL-02: a broken stream is reloaded at its position up to 3 times (0.5, 1, 2 s apart);
      // then the controller skips it. The server's reachability is checked meanwhile.
      reportDown('navidrome');
      if (this.retries < 3) {
        const t = this.track;
        const at = (this.offsetS + el.currentTime) * 1000;
        const play = this.wantPlay;
        setTimeout(
          () => this.track === t && void this.load(t, { startMs: at, autoplay: play, retry: true }),
          500 * 2 ** this.retries,
        );
        this.retries++;
        return;
      }
      this.emit('error', {
        code: 'navidrome.stream',
        provider: 'navidrome',
        retriable: true,
        userMessage: 'This track could not be played from Navidrome.',
        detail: el.error.message,
      });
    });
    el.addEventListener('playing', () => {
      this.retries = 0;
    });
  }

  async connect() {}

  async disconnect() {
    const { el } = this.audio;
    el.pause();
    el.removeAttribute('src');
    el.load();
    this.track = null;
  }

  /** The stream URL, and whether it is a transcode (which cannot seek). */
  private srcFor(track: NavidromeTrack, offsetS: number) {
    const raw = !!track.contentType && this.audio.el.canPlayType(track.contentType) !== '';
    const q = new URLSearchParams(raw ? { format: 'raw' } : { format: 'opus', maxBitRate: '192' });
    if (!raw && offsetS > 0) q.set('timeOffset', String(Math.floor(offsetS)));
    return {
      src: `/api/v1/navidrome/stream/${encodeURIComponent(track.id)}?${q}`,
      transcode: !raw,
    };
  }

  async load(track: Track, opts: { startMs?: number; autoplay: boolean; retry?: boolean }) {
    const t = track as NavidromeTrack;
    const { el } = this.audio;
    this.track = t;
    this.loading = true;
    this.startMs = opts.startMs ?? 0;
    this.wantPlay = opts.autoplay;
    if (!opts.retry) {
      this.scrobbled = 'none';
      this.retries = 0;
    }
    this.audio.setReplayGain(t.replayGain?.trackGain, t.replayGain?.trackPeak);
    const load = ++this.loads;
    const { src, transcode } = this.srcFor(t, this.startMs / 1000);
    this.transcode = transcode;
    this.offsetS = transcode ? Math.floor(this.startMs / 1000) : 0;
    el.src = src;
    this.emitState();
    this.mediaSession(t);
    await new Promise<void>((resolve) => {
      const done = () => {
        el.removeEventListener('loadedmetadata', done);
        el.removeEventListener('error', done);
        resolve();
      };
      el.addEventListener('loadedmetadata', done);
      el.addEventListener('error', done);
    });
    if (load !== this.loads) return; // superseded by a newer load
    if (!this.transcode && this.startMs) el.currentTime = this.startMs / 1000;
    this.loading = false;
    if (this.wantPlay) await this.play();
    else this.emitState();
  }

  async play() {
    if (!this.track) return;
    this.wantPlay = true;
    if (this.loading) return; // plays when the load completes
    this.audio.start();
    await this.audio.el.play().catch((e: unknown) => {
      this.emitState();
      // NotAllowedError: no user gesture yet; the next click plays.
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      this.emit('error', {
        code: 'navidrome.stream',
        provider: 'navidrome',
        retriable: true,
        userMessage: 'This track could not be played from Navidrome.',
        detail: String(e),
      });
    });
  }

  async pause() {
    this.wantPlay = false;
    this.audio.el.pause();
  }

  async seek(ms: number) {
    if (!this.track) return;
    if (!this.transcode) {
      this.audio.el.currentTime = ms / 1000;
      this.emitState();
      return;
    }
    // A live transcode cannot seek: reload it from the new position (§5.5).
    if (!this.opts.transcodeOffset) return;
    await this.load(this.track, { startMs: ms, autoplay: !this.audio.el.paused || this.wantPlay });
  }

  async setVolume(v: number) {
    this.audio.setVolume(v);
  }

  async preload(next: Track) {
    // Warms the next stream's first bytes, so it starts without a gap in practice (§5.6).
    const warm = new Audio();
    warm.preload = 'auto';
    warm.src = this.srcFor(next as NavidromeTrack, 0).src;
  }

  on<K extends keyof Events>(event: K, cb: (e: Events[K]) => void): Unsubscribe {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  features(): FeatureSource {
    return this.live;
  }

  audioClock() {
    if (this.loading || !this.track) return null;
    return {
      positionMs: (this.offsetS + this.audio.el.currentTime) * 1000,
      latencyMs: this.audio.latencyMs(),
    };
  }

  /** Now playing at the start; a play once half the track or 4 minutes have played (§5.7). */
  private scrobble() {
    const t = this.track;
    if (!t || !this.opts.scrobble || this.audio.el.paused) return;
    const at = (this.offsetS + this.audio.el.currentTime) * 1000;
    const post = (submission: boolean) =>
      api(`/navidrome/rest/scrobble?id=${encodeURIComponent(t.id)}&submission=${submission}`, {
        method: 'POST',
        body: {},
      }).catch(() => undefined);
    if (this.scrobbled === 'none') {
      this.scrobbled = 'now';
      void post(false);
    }
    if (this.scrobbled === 'now' && (at >= t.durationMs / 2 || at >= SCROBBLE_MS)) {
      this.scrobbled = 'done';
      void post(true);
    }
  }

  private mediaSession(t: Track) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album.title,
      artwork: t.artwork.map((a) => ({ src: a.url })),
    });
    navigator.mediaSession.setActionHandler('play', () => void this.play());
    navigator.mediaSession.setActionHandler('pause', () => void this.pause());
    navigator.mediaSession.setActionHandler(
      'seekto',
      (d) => d.seekTime !== undefined && void this.seek(d.seekTime * 1000),
    );
  }

  private emitState() {
    const { el } = this.audio;
    this.emit('state', {
      track: this.track,
      positionMs: this.loading ? this.startMs : (this.offsetS + el.currentTime) * 1000,
      positionAt: performance.now(),
      paused: el.paused,
      buffering: this.loading || (this.waiting && !el.paused),
    });
  }

  private emit<K extends keyof Events>(event: K, e: Events[K]) {
    for (const cb of this.listeners[event]) cb(e);
  }
}
