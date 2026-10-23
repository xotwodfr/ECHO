import type {
  AppError,
  FeatureSource,
  PlaybackProvider,
  ProviderState,
  Track,
  Unsubscribe,
} from '../../shared/types.ts';
import { type AudioPath, createAudioPath } from '../playback/audio.ts';
import { FAKE_CAPABILITIES, FakeProvider } from '../playback/fake.ts';
import { SILENT_FEATURES } from '../playback/features.ts';
import { featureTracks } from './feature-tracks.ts';
import { guideFeatures, guideFixtureOf } from './guide.ts';
import { guideTone, wav } from './guide-tone.ts';
import { lyricFixtures } from './lyrics.ts';

// FixtureProvider (IMPLEMENTATION_PLAN.md M3 task 3): guide tracks play their guide tone through a
// real <audio> element and the Web Audio path, so the SongClock re-anchors on `currentTime` and
// subtracts the output latency exactly as Navidrome will (M5). Every other fixture track keeps the
// FakeProvider's silent clock. Development builds only.

const RATE = 16_000;

type Events = { state: ProviderState; ended: undefined; error: AppError };

export class FixtureProvider implements PlaybackProvider {
  readonly id = 'navidrome' as const;
  readonly capabilities = FAKE_CAPABILITIES;
  readonly label = 'Fixtures';

  private readonly fake = new FakeProvider();
  private readonly audio: AudioPath;
  /** The lyric fixture now loaded as audio, or null while the fake plays. */
  private guide: string | null = null;
  private track: Track | null = null;
  private url: string | null = null;
  private loading = false;
  private loads = 0;
  private startMs = 0;
  private wantPlay = false;
  private waiting = false;
  private listeners: { [K in keyof Events]: Set<(e: Events[K]) => void> } = {
    state: new Set(),
    ended: new Set(),
    error: new Set(),
  };

  constructor(el: HTMLAudioElement = new Audio()) {
    this.audio = createAudioPath(el);
    this.fake.on('state', (s) => this.guide === null && this.emit('state', s));
    this.fake.on('ended', () => this.guide === null && this.emit('ended', undefined));
    this.fake.on('error', (e) => this.guide === null && this.emit('error', e));
    const sync = () => this.emitState();
    for (const e of ['play', 'pause', 'seeked'] as const) el.addEventListener(e, sync);
    el.addEventListener('waiting', () => {
      this.waiting = true;
      this.emitState();
    });
    el.addEventListener('playing', () => {
      this.waiting = false;
      this.emitState();
    });
    el.addEventListener('ended', () => {
      if (this.guide === null) return;
      this.emitState();
      this.emit('ended', undefined);
    });
    el.addEventListener('error', () => {
      if (this.guide === null || !el.error) return;
      this.emit('error', {
        code: 'fixture.audio',
        retriable: false,
        userMessage: 'The guide tone could not play.',
        detail: el.error.message,
      });
    });
  }

  async connect() {}

  async disconnect() {
    this.stopAudio();
    await this.fake.disconnect();
  }

  async load(track: Track, opts: { startMs?: number; autoplay: boolean }) {
    const name = guideFixtureOf(track);
    const doc = name ? lyricFixtures[name] : undefined;
    if (!name || !doc) {
      this.stopAudio();
      return this.fake.load(track, opts);
    }
    this.guide = name; // from here on the fake's events are not forwarded
    await this.fake.disconnect();
    const { el } = this.audio;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(
      new Blob([wav(guideTone(doc, RATE), RATE)], { type: 'audio/wav' }),
    );
    this.track = track;
    this.loading = true;
    this.startMs = opts.startMs ?? 0;
    this.wantPlay = opts.autoplay;
    const load = ++this.loads;
    el.src = this.url;
    this.emitState();
    await new Promise<void>((resolve) => {
      const done = () => {
        el.removeEventListener('loadedmetadata', done);
        el.removeEventListener('error', done);
        resolve();
      };
      el.addEventListener('loadedmetadata', done);
      el.addEventListener('error', done);
    });
    if (load !== this.loads || this.guide === null) return; // superseded by a newer load
    el.currentTime = this.startMs / 1000;
    this.loading = false;
    if (this.wantPlay) await this.play();
    else this.emitState();
  }

  async play() {
    if (this.guide === null) return this.fake.play();
    if (!this.track) return;
    this.wantPlay = true;
    if (this.loading) return; // plays when the load completes
    this.audio.start();
    await this.audio.el.play().catch((e: unknown) => {
      // NotAllowedError: no user gesture yet. The state stays paused; the next click plays.
      this.emitState();
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      this.emit('error', {
        code: 'fixture.audio',
        retriable: false,
        userMessage: 'The guide tone could not play.',
        detail: String(e),
      });
    });
  }

  async pause() {
    if (this.guide === null) return this.fake.pause();
    this.wantPlay = false;
    this.audio.el.pause();
  }

  async seek(ms: number) {
    if (this.guide === null) return this.fake.seek(ms);
    this.audio.el.currentTime = ms / 1000;
    this.emitState(); // optimistic; `seeked` confirms
  }

  async setVolume(v: number) {
    this.audio.setVolume(v);
    await this.fake.setVolume(v);
  }

  on<K extends keyof Events>(event: K, cb: (e: Events[K]) => void): Unsubscribe {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  features(): FeatureSource {
    if (this.guide === null) return SILENT_FEATURES;
    return featureTracks[guideFeatures[this.guide] ?? ''] ?? SILENT_FEATURES;
  }

  audioClock() {
    if (this.guide === null || this.loading) return null;
    return { positionMs: this.audio.el.currentTime * 1000, latencyMs: this.audio.latencyMs() };
  }

  private stopAudio() {
    if (this.guide === null) return;
    this.guide = null;
    this.track = null;
    this.audio.el.pause();
    this.audio.el.removeAttribute('src');
    this.audio.el.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private emitState() {
    if (this.guide === null) return;
    const { el } = this.audio;
    this.emit('state', {
      track: this.track,
      positionMs: this.loading ? this.startMs : el.currentTime * 1000,
      positionAt: performance.now(),
      paused: el.paused,
      buffering: this.loading || (this.waiting && !el.paused),
    });
  }

  private emit<K extends keyof Events>(event: K, e: Events[K]) {
    for (const cb of this.listeners[event]) cb(e);
  }
}
