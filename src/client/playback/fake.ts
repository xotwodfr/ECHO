import type {
  AppError,
  PlaybackProvider,
  ProviderCapabilities,
  ProviderState,
  Track,
  Unsubscribe,
} from '../../shared/types.ts';
import { type Clock, realClock } from './clock.ts';
import { SILENT_FEATURES } from './features.ts';

// FakeProvider (IMPLEMENTATION_PLAN.md M2 task 3): a PlaybackProvider that "plays" fixture tracks
// on a clock instead of audio, so the shell is usable without a server. It stands in for the
// Navidrome path (id 'navidrome', Navidrome's capabilities) until NavidromeProvider lands in M5.

export const FAKE_CAPABILITIES: ProviderCapabilities = {
  canSeek: true,
  canSetVolume: true,
  canReorderQueue: true,
  canRemoveFromQueue: true,
  canCrossfade: false,
  audioFeatures: false, // no audio, so no analyser
  artPaletteAllowed: true,
  syncedLyricsAllowed: true,
  requiresAttribution: null,
};

type Events = { state: ProviderState; ended: undefined; error: AppError };

export class FakeProvider implements PlaybackProvider {
  readonly id = 'navidrome' as const;
  readonly capabilities = FAKE_CAPABILITIES;
  /** Shown as the dock's provider mark. */
  readonly label = 'Fixtures';

  private readonly clock: Clock;
  /** Simulated time from load() to ready, so the loading state is visible. */
  private readonly loadMs: number;
  private track: Track | null = null;
  private positionMs = 0;
  private anchor = 0;
  private playing = false;
  private buffering = false;
  private wantPlay = false;
  private volume = 1;
  private loadTimer: ReturnType<Clock['setTimeout']> | null = null;
  private endTimer: ReturnType<Clock['setTimeout']> | null = null;
  private settleLoad: (() => void) | null = null;
  private listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = {
    state: new Set(),
    ended: new Set(),
    error: new Set(),
  };

  constructor(opts: { clock?: Clock; loadMs?: number } = {}) {
    this.clock = opts.clock ?? realClock;
    this.loadMs = opts.loadMs ?? 150;
  }

  async connect() {}

  async disconnect() {
    this.stopTimers();
    this.track = null;
    this.playing = false;
    this.emitState();
  }

  load(
    track: Track,
    opts: { startMs?: number; autoplay: boolean; replayGain?: 'album' | 'track' },
  ) {
    this.stopTimers();
    this.settleLoad?.(); // a newer load supersedes a pending one
    this.track = track;
    this.positionMs = this.clamp(opts.startMs ?? 0);
    this.anchor = this.clock.now();
    this.playing = false;
    this.buffering = true;
    this.wantPlay = opts.autoplay;
    this.emitState();
    return new Promise<void>((resolve) => {
      this.settleLoad = resolve;
      this.loadTimer = this.clock.setTimeout(() => {
        this.loadTimer = null;
        this.settleLoad = null;
        this.buffering = false;
        if (this.wantPlay) this.start();
        else this.emitState();
        resolve();
      }, this.loadMs);
    });
  }

  async play() {
    if (!this.track) return;
    if (this.buffering) {
      this.wantPlay = true;
      return;
    }
    if (!this.playing) this.start();
  }

  async pause() {
    this.wantPlay = false;
    if (!this.playing) return;
    this.positionMs = this.current();
    this.playing = false;
    this.clearEnd();
    this.emitState();
  }

  async seek(ms: number) {
    if (!this.track) return;
    this.positionMs = this.clamp(ms);
    this.anchor = this.clock.now();
    if (this.playing) this.scheduleEnd();
    this.emitState();
  }

  async setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
  }

  /** The UI volume last set (0..1); the fake has no audio to apply it to. */
  getVolume() {
    return this.volume;
  }

  on<K extends keyof Events>(event: K, cb: (e: Events[K]) => void): Unsubscribe {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  features() {
    return SILENT_FEATURES; // no audio, so nothing to analyse
  }

  private start() {
    this.anchor = this.clock.now();
    this.playing = true;
    this.scheduleEnd();
    this.emitState();
  }

  private current() {
    return this.playing
      ? this.clamp(this.positionMs + this.clock.now() - this.anchor)
      : this.positionMs;
  }

  private clamp(ms: number) {
    return Math.min(Math.max(0, ms), this.track?.durationMs ?? 0);
  }

  private scheduleEnd() {
    this.clearEnd();
    const remaining = (this.track?.durationMs ?? 0) - this.positionMs;
    this.endTimer = this.clock.setTimeout(() => {
      this.endTimer = null;
      this.positionMs = this.track?.durationMs ?? 0;
      this.anchor = this.clock.now();
      this.playing = false;
      this.emitState();
      for (const cb of this.listeners.ended) cb(undefined);
    }, remaining);
  }

  private clearEnd() {
    if (this.endTimer !== null) this.clock.clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  private stopTimers() {
    this.clearEnd();
    if (this.loadTimer !== null) this.clock.clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private emitState() {
    const now = this.clock.now();
    // Report the position now, anchored now, so receivers extrapolate from a fresh sample.
    if (this.playing) {
      this.positionMs = this.current();
      this.anchor = now;
    }
    const s: ProviderState = {
      track: this.track,
      positionMs: this.positionMs,
      positionAt: now,
      paused: !this.playing,
      buffering: this.buffering,
    };
    for (const cb of this.listeners.state) cb(s);
  }
}
