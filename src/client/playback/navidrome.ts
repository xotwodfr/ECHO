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
import { createAudioGraph } from './audio.ts';

// NavidromeProvider (PLAYBACK_ARCHITECTURE.md §5): the signed-in user's own Navidrome through
// ECHO's proxy. Raw when the browser can play the file (native seeking over Range), else Opus 192
// transcoded by Navidrome, sought by reloading with `timeOffset`. ReplayGain, scrobbling, the Media
// Session, and two voices (A/B) for gapless hand-overs; crossfade is a follow-up.

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

  private readonly graph = createAudioGraph();
  /** Two voices (A/B): one plays, the other buffers the next track for a gapless hand-over (§5.6). */
  private readonly voices: {
    el: HTMLAudioElement;
    setReplayGain(db?: number, peak?: number): void;
  }[];
  private cur = 0;
  /** The track buffering in the other voice, if any. */
  private next: { track: NavidromeTrack; src: string; transcode: boolean } | null = null;
  private endedAt = 0;
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
  private gainMode: 'album' | 'track' | 'off' = 'track';
  private listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = {
    state: new Set(),
    ended: new Set(),
    error: new Set(),
  };

  /** Read on each use, so Settings → Playback changes apply to the next stream (getters welcome). */
  private readonly opts: {
    transcodeOffset: boolean;
    scrobble: boolean;
    /** Settings → Playback → Quality (per device): `auto` and `raw` play the file when possible. */
    quality?: 'auto' | 'raw' | '320' | '192' | '128';
  };

  constructor(
    els: [HTMLAudioElement, HTMLAudioElement] = [new Audio(), new Audio()],
    opts: NavidromeProvider['opts'] = {
      transcodeOffset: true,
      scrobble: true,
    },
  ) {
    this.opts = opts;
    this.voices = els.map((el) => {
      el.preload = 'auto';
      this.listen(el);
      return this.graph.attach(el);
    });
    this.live = new AnalyserFeatures({
      tap: () => this.graph.analyser(),
      latencyMs: () => this.graph.latencyMs(),
      playing: () => !this.el.paused,
    });
  }

  /** The playing voice's element. */
  private get el() {
    return (this.voices[this.cur] as (typeof this.voices)[number]).el;
  }

  /** Events count only from the playing voice; the buffering one stays silent. */
  private listen(el: HTMLAudioElement) {
    const mine = () => el === this.el;
    const sync = () => mine() && this.emitState();
    for (const e of ['play', 'pause', 'seeked'] as const) el.addEventListener(e, sync);
    el.addEventListener('waiting', () => {
      if (!mine()) return;
      this.waiting = true;
      this.emitState();
    });
    el.addEventListener('playing', () => {
      if (!mine()) return;
      this.waiting = false;
      this.retries = 0;
      if (__ECHO_FIXTURES__ && this.endedAt) {
        // PLAY-04: how long the hand-over took, for E2E.
        const w = window as unknown as { __echoGaps?: number[] };
        w.__echoGaps ??= [];
        w.__echoGaps.push(performance.now() - this.endedAt);
        this.endedAt = 0;
      }
      this.emitState();
      this.scrobble();
    });
    el.addEventListener('timeupdate', () => mine() && this.scrobble());
    el.addEventListener('ended', () => {
      if (!mine()) return;
      this.endedAt = performance.now();
      this.emitState();
      this.emit('ended', undefined);
    });
    el.addEventListener('error', () => {
      if (!el.error) return;
      if (!mine()) {
        this.next = null; // the next track failed to buffer: it loads normally when its turn comes
        return;
      }
      if (!this.track) return;
      // REL-02: a broken stream is reloaded at its position up to 3 times (0.5, 1, 2 s apart);
      // then the controller skips it. The server's reachability is checked meanwhile.
      reportDown('navidrome');
      if (this.retries < 3) {
        const t = this.track;
        const at = (this.offsetS + el.currentTime) * 1000;
        const play = this.wantPlay;
        setTimeout(
          () =>
            this.track === t &&
            void this.load(t, {
              startMs: at,
              autoplay: play,
              retry: true,
              replayGain: this.gainMode,
            }),
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
  }

  async connect() {}

  async disconnect() {
    for (const v of this.voices) {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load();
    }
    this.track = null;
    this.next = null;
  }

  /** The stream URL, and whether it is a transcode (which cannot seek). */
  private srcFor(track: NavidromeTrack, offsetS: number) {
    const quality = this.opts.quality ?? 'auto';
    const playable = !!track.contentType && this.el.canPlayType(track.contentType) !== '';
    const raw = playable && (quality === 'auto' || quality === 'raw');
    const bitRate = quality === 'auto' || quality === 'raw' ? '192' : quality;
    const q = new URLSearchParams(
      raw ? { format: 'raw' } : { format: 'opus', maxBitRate: bitRate },
    );
    if (!raw && offsetS > 0) q.set('timeOffset', String(Math.floor(offsetS)));
    return {
      src: `/api/v1/navidrome/stream/${encodeURIComponent(track.id)}?${q}`,
      transcode: !raw,
    };
  }

  private applyGain(t: NavidromeTrack, mode: 'album' | 'track' | 'off') {
    const rg = t.replayGain;
    const v = this.voices[this.cur] as (typeof this.voices)[number];
    if (mode === 'off') return v.setReplayGain(undefined, undefined); // Settings → Playback
    // Album gain keeps an album's own dynamics between its tracks; track gain evens out a mix.
    if (mode === 'album' && rg?.albumGain !== undefined)
      v.setReplayGain(rg.albumGain, rg.albumPeak);
    else v.setReplayGain(rg?.trackGain, rg?.trackPeak);
  }

  async load(
    track: Track,
    opts: {
      startMs?: number;
      autoplay: boolean;
      retry?: boolean;
      replayGain?: 'album' | 'track' | 'off';
    },
  ) {
    const t = track as NavidromeTrack;
    // The next track is already buffered in the other voice: hand over at once (gapless, §5.6).
    if (!opts.retry && !opts.startMs && this.next?.track.key === t.key) {
      const old = this.el;
      this.cur = 1 - this.cur;
      old.pause();
      this.transcode = this.next.transcode;
      this.next = null;
      this.track = t;
      this.loading = false;
      this.offsetS = 0;
      this.startMs = 0;
      this.wantPlay = opts.autoplay;
      this.scrobbled = 'none';
      this.retries = 0;
      this.gainMode = opts.replayGain ?? 'track';
      this.applyGain(t, this.gainMode);
      this.mediaSession(t);
      if (this.wantPlay) await this.play();
      else this.emitState();
      return;
    }
    const el = this.el;
    this.track = t;
    this.loading = true;
    this.startMs = opts.startMs ?? 0;
    this.wantPlay = opts.autoplay;
    if (!opts.retry) {
      this.scrobbled = 'none';
      this.retries = 0;
      this.gainMode = opts.replayGain ?? 'track';
    }
    this.applyGain(t, this.gainMode);
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
    // The source failed before its metadata: the error listener reloads it (REL-02) or reports it.
    if (el.error) return;
    if (!this.transcode && this.startMs) el.currentTime = this.startMs / 1000;
    this.loading = false;
    if (this.wantPlay) await this.play();
    else this.emitState();
  }

  async play() {
    if (!this.track) return;
    this.wantPlay = true;
    if (this.loading) return; // plays when the load completes
    this.graph.start();
    await this.el.play().catch((e: unknown) => {
      this.emitState();
      // NotAllowedError: no user gesture yet; the next click plays. AbortError: a pause or a new
      // source interrupted this play, which is not a broken stream.
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError'))
        return;
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
    this.el.pause();
  }

  async seek(ms: number) {
    if (!this.track) return;
    if (!this.transcode) {
      this.el.currentTime = ms / 1000;
      this.emitState();
      return;
    }
    // A live transcode cannot seek: reload it from the new position (§5.5).
    if (!this.opts.transcodeOffset) return;
    // The same play: scrobble state, retries and the gain mode carry over.
    await this.load(this.track, {
      startMs: ms,
      autoplay: !this.el.paused || this.wantPlay,
      retry: true,
      replayGain: this.gainMode,
    });
  }

  async setVolume(v: number) {
    this.graph.setVolume(v);
  }

  /** Buffers `next` in the other voice, so `load(next)` hands over without a gap (§5.6). */
  async preload(next: Track) {
    const t = next as NavidromeTrack;
    if (t.key === this.track?.key || t.key === this.next?.track.key) return;
    const { src, transcode } = this.srcFor(t, 0);
    const other = (this.voices[1 - this.cur] as (typeof this.voices)[number]).el;
    other.src = src;
    other.load();
    this.next = { track: t, src, transcode };
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
      positionMs: (this.offsetS + this.el.currentTime) * 1000,
      latencyMs: this.graph.latencyMs(),
    };
  }

  /** Now playing at the start; a play once half the track or 4 minutes have played (§5.7). */
  private scrobble() {
    const t = this.track;
    if (!t || !this.opts.scrobble || this.el.paused) return;
    const at = (this.offsetS + this.el.currentTime) * 1000;
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
    const el = this.el;
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
