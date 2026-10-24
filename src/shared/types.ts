// Shared types (TECHNICAL_ARCHITECTURE.md §5.1, PLAYBACK_ARCHITECTURE.md §2 and §6,
// VISUALIZER_SPEC.md §3.4, LYRICS_INTEGRATION.md §5). Written as specified there.

export type ProviderId = 'navidrome' | 'spotify';

export interface Track {
  key: string; // `${provider}:${providerTrackId}`
  provider: ProviderId;
  id: string;
  title: string;
  artists: { id?: string; name: string }[];
  album: { id?: string; title: string; key: string }; // album key for palette cache
  durationMs: number;
  artwork: { url: string; width?: number; height?: number }[];
  isrc?: string;
  spotifyId?: string;
  replayGain?: { trackGain?: number; albumGain?: number; trackPeak?: number; albumPeak?: number };
}

export interface AppError {
  code: string;
  provider?: ProviderId;
  retriable: boolean;
  userMessage: string;
  detail?: string;
}

export interface ProviderCapabilities {
  canSeek: boolean;
  canSetVolume: boolean;
  canReorderQueue: boolean; // Spotify: false
  canRemoveFromQueue: boolean; // Spotify: false
  canCrossfade: boolean; // Navidrome only
  audioFeatures: boolean; // VISUALIZER_SPEC.md §2.1
  artPaletteAllowed: boolean; // PLAYBACK_ARCHITECTURE.md §4.6 gate G1
  syncedLyricsAllowed: boolean; // §4.6 gate G2
  requiresAttribution: 'spotify' | null;
}

export interface PlaybackState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  track: Track | null;
  positionMs: number;
  positionAt: number; // performance.now() at observation
  volume: number; // 0..1 UI value
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  capabilities: ProviderCapabilities;
  error?: AppError;
}

/** What a provider reports; the controller maps it into PlaybackState. */
export interface ProviderState {
  track: Track | null;
  positionMs: number;
  positionAt: number;
  paused: boolean;
  buffering: boolean;
}

export interface Features {
  available: boolean; // false → all below are 0 except intensity = 0.6
  sub: number;
  bass: number;
  mid: number;
  high: number; // 0..1, smoothed, normalised
  onset: number; // 0..1 impulse on the frame of an onset, else 0
  intensity: number; // 0..1, slow
  bassImpulse: number; // max(0, d(bass)/dt) normalised, for impulse springs
}

/** Sampled once per Stage frame (TECHNICAL_ARCHITECTURE.md §4.2). */
export interface FeatureSource {
  sample(tMs: number, dtMs: number): Features;
}

export interface PlayContext {
  kind: 'album' | 'playlist' | 'artist' | 'search' | 'starred';
  id?: string;
  title: string;
}

export type SyncLevel = 'word' | 'line' | 'none';

/** Rendered on the stage; removing it is a defect (LYRICS_INTEGRATION.md §8). */
export interface Attribution {
  text: string;
  links?: { label: string; href: string }[];
}

export interface LyricWord {
  text: string; // as displayed, without trailing space
  start: number; // ms
  end: number;
  isPartOfWord: boolean; // true → no space before the next word (syllables)
}

export interface LyricLine {
  text: string; // full display text (words joined)
  start: number; // ms from track start (sync != 'none'); 0 for static
  end?: number; // optional for line-timed sources
  agent?: string;
  oppositeAligned?: boolean;
  words?: LyricWord[]; // present iff sync === 'word'
  background?: { text: string; start?: number; end?: number; words?: LyricWord[] }[];
}

export interface LyricsDoc {
  version: 1;
  trackKey: string;
  sync: SyncLevel;
  source: 'navidrome' | 'spicy' | 'lrclib' | 'navidrome-plain' | 'fixture'; // fixture: M3, dev only
  attribution: Attribution;
  language?: string; // BCP-47 when known
  offsetMs: number; // source-declared offset; 0 if none
  durationMs?: number;
  agents?: { id: string; name?: string; kind: 'person' | 'group' | 'other' }[];
  lines: LyricLine[];
  translations?: { lang: string; lines: string[] }[]; // same indexing as lines
  romanisation?: { lines: LyricLine[] };
  fetchedAt: string; // ISO
}

export type Unsubscribe = () => void;

export interface PlaybackProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** `replayGain`: album gain in album context, else track gain (PLAY-05, ReplayGain `auto`). */
  load(
    track: Track,
    opts: { startMs?: number; autoplay: boolean; replayGain?: 'album' | 'track' },
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>; // 0..1 UI value
  preload?(next: Track): Promise<void>;

  playContext?(ctx: PlayContext, offset: number): Promise<void>;
  enqueue?(track: Track): Promise<void>;

  on(event: 'state', cb: (s: ProviderState) => void): Unsubscribe;
  on(event: 'ended', cb: () => void): Unsubscribe;
  on(event: 'error', cb: (e: AppError) => void): Unsubscribe;

  features(): FeatureSource;
  /** Providers playing an <audio> element: its position and the output latency (TECHNICAL_ARCHITECTURE.md §5.2). */
  audioClock?(): { positionMs: number; latencyMs: number } | null;
}

export interface QueueState {
  provider: ProviderId | null;
  now: Track | null;
  nextUp: Track[]; // user-added ("Play next" inserts at 0, "Add to queue" appends)
  context: Track[]; // remainder of the album/playlist/search list being played
  contextSource?: PlayContext;
  history: Track[]; // last 50, for Previous (Navidrome)
  shuffleOrder?: number[];
}
