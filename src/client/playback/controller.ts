import { createStore } from 'zustand/vanilla';
import type {
  FeatureSource,
  PlaybackProvider,
  PlaybackState,
  PlayContext,
  ProviderCapabilities,
  QueueState,
  Track,
} from '../../shared/types.ts';
import { strings } from '../strings.ts';
import { type Clock, realClock } from './clock.ts';
import { SILENT_FEATURES } from './features.ts';
import * as Q from './queue.ts';
import { createSongClock, positionNow } from './songClock.ts';

// PlaybackController (PLAYBACK_ARCHITECTURE.md §1, §3): the only thing the UI talks to. It owns
// playerStore and queueStore and drives one provider. Providers never touch the stores.

const NO_CAPABILITIES: ProviderCapabilities = {
  canSeek: false,
  canSetVolume: false,
  canReorderQueue: false,
  canRemoveFromQueue: false,
  canCrossfade: false,
  audioFeatures: false,
  artPaletteAllowed: false,
  syncedLyricsAllowed: false,
  requiresAttribution: null,
};

/** Previous restarts the track when more than this has played (§3). */
export const RESTART_AFTER_MS = 3000;

export { positionNow };

export function createPlaybackController(opts: {
  provider: (PlaybackProvider & { label?: string }) | null;
  clock?: Clock;
  random?: () => number;
  /** Short confirmations ("Added to queue"), shown as a toast by the shell. */
  notify?: (message: string) => void;
  /** Deterministic mode's recorded Features (VISUALIZER_SPEC.md §10), in place of the provider's. */
  features?: FeatureSource;
}) {
  const { provider } = opts;
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? Math.random;
  const notify = opts.notify ?? (() => {});

  const player = createStore<PlaybackState>()(() => ({
    status: 'idle',
    track: null,
    positionMs: 0,
    positionAt: clock.now(),
    volume: 1,
    shuffle: false,
    repeat: 'off',
    capabilities: provider?.capabilities ?? NO_CAPABILITIES,
  }));
  const queue = createStore<QueueState>()(Q.emptyQueue);
  /** The whole list being played, for repeat-all to wrap around. */
  let source: { tracks: Track[]; context: PlayContext } | null = null;
  let loading = false;
  /** The volume to return to when unmuting. */
  let unmuted = 1;
  const songClock = createSongClock(
    () => player.getState(),
    () => provider?.audioClock?.() ?? null,
    () => clock.now(),
  );

  provider?.on('state', (s) => {
    if (!s.buffering) loading = false;
    const status: PlaybackState['status'] = s.buffering
      ? loading
        ? 'loading'
        : 'buffering'
      : s.paused
        ? player.getState().status === 'ended'
          ? 'ended'
          : 'paused'
        : 'playing';
    player.setState({ track: s.track, positionMs: s.positionMs, positionAt: s.positionAt, status });
  });
  provider?.on('ended', () => void onEnded());
  provider?.on('error', (e) => {
    // REL-02: a stream that fails after its reloads is skipped, with a toast.
    if (e.code === 'navidrome.stream') {
      notify(strings.dock.skipped);
      const next = Q.advance(queue.getState());
      if (next) return load(next, true);
    }
    player.setState({ status: 'error', error: e });
  });

  const isActive = () => ['playing', 'loading', 'buffering'].includes(player.getState().status);

  /** The next track is buffered 20 s before this one ends, for a gapless hand-over (§5.6). */
  let preloadTimer: ReturnType<Clock['setTimeout']> | null = null;
  function schedulePreload(track: Track, startMs: number) {
    if (preloadTimer) clock.clearTimeout(preloadTimer);
    preloadTimer = null;
    if (!provider?.preload) return;
    preloadTimer = clock.setTimeout(
      () => {
        preloadTimer = null;
        const q = queue.getState();
        const next = Q.upcoming(q)[0];
        if (q.now?.key === track.key && next && player.getState().repeat !== 'one')
          void provider.preload?.(next);
      },
      Math.max(0, track.durationMs - startMs - 20_000),
    );
  }

  function load(q: QueueState, autoplay: boolean, startMs = 0) {
    queue.setState(q, true);
    if (!provider || !q.now) return;
    schedulePreload(q.now, startMs);
    loading = true;
    player.setState({
      status: 'loading',
      track: q.now,
      positionMs: startMs,
      positionAt: clock.now(),
    });
    void provider.load(q.now, {
      autoplay,
      startMs,
      replayGain: q.contextSource?.kind === 'album' ? 'album' : 'track',
    });
  }

  /** Repeat-all: start the source list again (reshuffled if shuffle is on). */
  function wrap(): QueueState | null {
    if (!source || !provider) return null;
    const s = player.getState().shuffle;
    const start = s ? Math.floor(random() * source.tracks.length) : 0;
    return Q.startContext(
      queue.getState(),
      source.tracks,
      start,
      source.context,
      provider.id,
      s,
      random,
    );
  }

  async function onEnded() {
    const { repeat } = player.getState();
    if (repeat === 'one') {
      await provider?.seek(0);
      await provider?.play();
      return;
    }
    const next = Q.advance(queue.getState()) ?? (repeat === 'all' ? wrap() : null);
    if (next) return load(next, true);
    // End of queue (§3): stop on the last track; the playing indicators clear.
    player.setState({ status: 'ended' });
  }

  // Seeks are optimistic and one in flight; the latest request wins (§3).
  let seeking = false;
  let pendingSeek: number | null = null;
  async function sendSeek(ms: number) {
    seeking = true;
    await provider?.seek(ms);
    seeking = false;
    if (pendingSeek !== null) {
      const next = pendingSeek;
      pendingSeek = null;
      await sendSeek(next);
    }
  }

  /**
   * Queueing with nothing loaded cues the first queued track, paused, so the dock has something
   * to play instead of a queue that nothing can start.
   */
  function enqueue(q: QueueState) {
    if (q.now || !provider) return queue.setState(q);
    const cued = Q.advance(q);
    if (cued) load({ ...cued, provider: provider.id }, false);
  }

  function seek(ms: number) {
    const s = player.getState();
    if (!provider || !s.track || !s.capabilities.canSeek) return;
    const to = Math.min(Math.max(0, ms), s.track.durationMs);
    player.setState({ positionMs: to, positionAt: clock.now() });
    if (seeking) pendingSeek = to;
    else void sendSeek(to);
  }

  function toggle() {
    const s = player.getState();
    if (!provider || !s.track) return;
    if (isActive()) return void provider.pause();
    if (s.status === 'ended') {
      player.setState({ status: 'paused' });
      void provider.seek(0);
    }
    void provider.play();
  }

  function setVolume(v: number) {
    const volume = Math.min(1, Math.max(0, v));
    if (volume > 0) unmuted = volume;
    player.setState({ volume });
    void provider?.setVolume(volume);
  }

  return {
    player,
    queue,
    /** Song time for the Stage and the lyric field: smooth, re-anchored on audio, latency-corrected. */
    songTime: () => songClock.now(),
    /** The active provider's features (Stage loop step 2). */
    features: () => opts.features ?? provider?.features() ?? SILENT_FEATURES,
    /** Text for the dock's provider mark. */
    providerLabel: provider?.label ?? null,

    /**
     * Play a list (album, playlist, results) from `index`. `'shuffle'` turns shuffle on and starts
     * from a random track (the Detail "Shuffle" button).
     */
    playList(tracks: Track[], index: number | 'shuffle', context: PlayContext) {
      if (index === 'shuffle') {
        player.setState({ shuffle: true });
        index = Math.floor(random() * tracks.length);
      }
      if (!provider || !tracks[index]) return;
      source = { tracks, context };
      const { shuffle } = player.getState();
      load(
        Q.startContext(queue.getState(), tracks, index, context, provider.id, shuffle, random),
        true,
      );
    },

    /** Load `tracks[index]` paused at `startMs` (deterministic mode, VISUALIZER_SPEC.md §10). */
    /** A saved queue (another session, another device), loaded paused at `positionMs`. */
    restore(q: QueueState, positionMs: number) {
      if (!provider) return;
      if (!q.now) return queue.setState({ ...q, provider: provider.id }, true);
      load({ ...q, provider: provider.id }, false, positionMs);
    },

    cue(tracks: Track[], index: number, context: PlayContext, startMs: number) {
      if (!provider || !tracks[index]) return;
      source = { tracks, context };
      load(
        Q.startContext(queue.getState(), tracks, index, context, provider.id, false, random),
        false,
        startMs,
      );
    },

    toggle,

    next() {
      const next =
        Q.advance(queue.getState()) ?? (player.getState().repeat === 'all' ? wrap() : null);
      if (next) load(next, isActive());
    },

    /** True when Next has somewhere to go (§3: nextUp, then the context, then repeat-all). */
    hasNext() {
      const q = queue.getState();
      return Q.upcoming(q).length > 0 || (player.getState().repeat === 'all' && source !== null);
    },

    /** Start or resume without ever pausing (a click on the "Now playing" row). */
    resume() {
      if (!isActive()) toggle();
    },

    previous() {
      const s = player.getState();
      if (!s.track) return;
      const prev = positionNow(s, clock.now()) > RESTART_AFTER_MS ? null : Q.back(queue.getState());
      if (prev) return load(prev, isActive());
      seek(0);
    },

    seek,

    setVolume,

    /** M: mute, or return to the volume before muting (§9.2). */
    toggleMute() {
      setVolume(player.getState().volume > 0 ? 0 : unmuted);
    },

    toggleShuffle() {
      const shuffle = !player.getState().shuffle;
      player.setState({ shuffle });
      queue.setState(Q.setShuffle(queue.getState(), shuffle, random), true);
    },

    cycleRepeat() {
      const order = { off: 'all', all: 'one', one: 'off' } as const;
      player.setState({ repeat: order[player.getState().repeat] });
    },

    /** "Play next": before anything already queued. `label` names it in the notice. */
    playNext(tracks: Track[], label: string) {
      let q = queue.getState();
      for (const t of [...tracks].reverse()) q = Q.playNext(q, t);
      enqueue(q);
      notify(strings.playback.playingNext(label));
    },

    /** "Add to queue": after everything already queued. */
    addToQueue(tracks: Track[], label: string) {
      let q = queue.getState();
      for (const t of tracks) q = Q.addToQueue(q, t);
      enqueue(q);
      notify(strings.playback.added(label));
    },

    /** Play an upcoming track now (`index` into `upcoming()`), skipping the ones before it. */
    jump(index: number) {
      const next = Q.jump(queue.getState(), index);
      if (next) load(next, true);
    },

    /** Queue edits (QUE-01), by position in `upcoming()`. */
    move(from: number, to: number) {
      queue.setState(Q.moveTo(queue.getState(), from, to), true);
    },
    remove(index: number) {
      queue.setState(Q.removeAt(queue.getState(), index), true);
    },
    clear() {
      queue.setState(Q.clearUpcoming(queue.getState()), true);
    },
  };
}

export type PlaybackController = ReturnType<typeof createPlaybackController>;
