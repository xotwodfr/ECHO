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
// playerStore and queueStore and drives one provider at a time: the library's (Navidrome, or the
// fixtures) and, once connected, Spotify. A queue never mixes them (§6.1, QUE-03): playing the other
// provider's music asks to replace the queue. Spotify owns its queue, so the controller sends it
// transport and additions and mirrors what it reports. Providers never touch the stores.

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

type Provider = PlaybackProvider & { label?: string };

export function createPlaybackController(opts: {
  provider: Provider | null;
  /** Spotify, when the user has connected it (M7). */
  spotify?: Provider | null;
  /** Asks before the queue is replaced by the other provider's music; resolves true to go ahead. */
  confirmReplace?: (provider: Provider) => Promise<boolean>;
  clock?: Clock;
  random?: () => number;
  /** Short confirmations ("Added to queue"), shown as a toast by the shell. */
  notify?: (message: string) => void;
  /** Settings → Playback → ReplayGain; `auto`: album gain in album context, else track gain. */
  replayGain?: () => 'off' | 'track' | 'album' | 'auto';
  /** Deterministic mode's recorded Features (VISUALIZER_SPEC.md §10), in place of the provider's. */
  features?: FeatureSource;
}) {
  const primary = opts.provider;
  /** The provider playing the current queue. */
  let provider = primary;
  const providers = [primary, opts.spotify].filter((p): p is Provider => !!p);
  const confirmReplace = opts.confirmReplace ?? (async () => true);
  const clock = opts.clock ?? realClock;
  const random = opts.random ?? Math.random;
  const notify = opts.notify ?? (() => {});
  const gainFor = (q: QueueState) => {
    const mode = opts.replayGain?.() ?? 'auto';
    if (mode !== 'auto') return mode;
    return q.contextSource?.kind === 'album' ? 'album' : 'track';
  };

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

  /** Events count only from the provider playing the current queue. */
  const fromActive =
    <T>(p: Provider, cb: (e: T) => void) =>
    (e: T) => {
      if (p === provider) cb(e);
    };
  for (const p of providers) {
    p.on('state', fromActive(p, onState));
    p.on('ended', () => {
      if (p === provider) void onEnded();
    });
    p.on('error', fromActive(p, onError));
  }

  function onState(s: import('../../shared/types.ts').ProviderState) {
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
    player.setState({
      track: s.track,
      positionMs: s.positionMs,
      positionAt: s.positionAt,
      status,
      ...(s.shuffle !== undefined && { shuffle: s.shuffle }),
      ...(s.repeat !== undefined && { repeat: s.repeat }),
    });
    // A provider that owns its queue reports it: mirror it (§6.3).
    if (s.upcoming && provider)
      queue.setState({
        ...queue.getState(),
        provider: provider.id,
        now: s.track,
        nextUp: [],
        context: s.upcoming,
      });
  }

  function onError(e: import('../../shared/types.ts').AppError) {
    // REL-02: a stream that fails after its reloads is skipped, with a toast; with nothing after
    // it, the toast says what failed (Play asks for it again), never that it skipped.
    if (e.code === 'navidrome.stream') {
      const next = Q.advance(queue.getState());
      notify(next ? strings.dock.skipped : e.userMessage);
      if (next) return load(next, true);
    }
    player.setState({ status: 'error', error: e });
  }

  /** Makes `want` the provider of a fresh, empty queue. */
  function switchTo(want: Provider) {
    if (want === provider) return;
    void provider?.pause();
    provider = want;
    source = null;
    queue.setState(Q.emptyQueue(), true);
    player.setState({
      status: 'idle',
      track: null,
      positionMs: 0,
      positionAt: clock.now(),
      capabilities: want.capabilities,
      error: undefined,
    });
  }

  const isActive = () => ['playing', 'loading', 'buffering'].includes(player.getState().status);

  /** The next track is buffered 20 s before this one ends, for a gapless hand-over (§5.6). */
  let preloadTimer: ReturnType<Clock['setTimeout']> | null = null;
  function schedulePreload(track: Track, startMs: number) {
    if (preloadTimer) clock.clearTimeout(preloadTimer);
    preloadTimer = null;
    const p = provider;
    if (!p?.preload) return;
    preloadTimer = clock.setTimeout(
      () => {
        preloadTimer = null;
        const q = queue.getState();
        const next = Q.upcoming(q)[0];
        if (q.now?.key === track.key && next && player.getState().repeat !== 'one')
          void p.preload?.(next);
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
      replayGain: gainFor(q),
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
    schedulePreload(s.track, to); // from the new position, or the hand-over has a gap
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

  /** Starts `tracks` at once, or after asking when they would replace the other provider's queue. */
  function playList(
    tracks: Track[],
    index: number | 'shuffle',
    context: PlayContext,
  ): Promise<void> | undefined {
    const want = providers.find((p) => p.id === tracks[0]?.provider);
    if (!want) return;
    if (want !== provider && queue.getState().now)
      return confirmReplace(want).then((ok) => {
        if (ok) start(want, tracks, index, context);
      });
    start(want, tracks, index, context);
  }

  function start(p: Provider, tracks: Track[], index: number | 'shuffle', context: PlayContext) {
    switchTo(p);
    if (index === 'shuffle') {
      player.setState({ shuffle: true });
      void p.setShuffle?.(true);
      index = Math.floor(random() * tracks.length);
    }
    if (!tracks[index]) return;
    source = { tracks, context };
    const { shuffle } = player.getState();
    const q = Q.startContext(queue.getState(), tracks, index, context, p.id, shuffle, random);
    if (p.playContext) {
      // Spotify plays the list itself; the queue shows it until Spotify reports its own.
      queue.setState(q, true);
      loading = true;
      player.setState({
        status: 'loading',
        track: q.now,
        positionMs: 0,
        positionAt: clock.now(),
      });
      return void p.playContext(context, index, tracks);
    }
    load(q, true);
  }

  /** Music from the provider not playing the queue is played (asking first), never mixed in. */
  const otherProvider = (tracks: Track[]) =>
    !!provider && !!tracks[0] && tracks[0].provider !== provider.id;

  /**
   * Additions to a queue its provider owns (Spotify): sent there, one by one. Music from the other
   * provider is never added (§6.1); the caller plays it instead, which asks to replace the queue.
   */
  function spotifyQueue(tracks: Track[]) {
    if (!provider?.enqueue || !queue.getState().now) return false;
    if (tracks[0]?.provider !== provider.id) return false;
    for (const t of tracks) if (t.provider === provider.id) void provider.enqueue(t);
    return true;
  }

  return {
    player,
    queue,
    /** Song time for the Stage and the lyric field: smooth, re-anchored on audio, latency-corrected. */
    songTime: () => songClock.now(),
    /** The active provider's features (Stage loop step 2). */
    features: () => opts.features ?? provider?.features() ?? SILENT_FEATURES,
    /** Text for the dock's provider mark. */
    get providerLabel() {
      return provider?.label ?? null;
    },
    /** The provider playing the current queue (the dock's Spotify parts read it). */
    get provider() {
      return provider;
    },

    /**
     * Play a list (album, playlist, results) from `index`. `'shuffle'` turns shuffle on and starts
     * from a random track (the Detail "Shuffle" button).
     */
    playList,

    /** A saved queue (another session, another device), loaded paused at `positionMs`. */
    restore(q: QueueState, positionMs: number) {
      // Spotify keeps its own queue across devices; a saved queue is the library's.
      if (!provider || provider !== primary || (q.provider && q.provider !== primary?.id)) return;
      // A shuffled queue comes back shuffled, and the dock says so.
      player.setState({ shuffle: !!q.shuffleOrder });
      if (!q.now) return queue.setState({ ...q, provider: provider.id }, true);
      load({ ...q, provider: provider.id }, false, positionMs);
    },

    /** Load `tracks[index]` paused at `startMs` (deterministic mode, VISUALIZER_SPEC.md §10). */
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
      if (provider?.skipNext) return void provider.skipNext();
      const next =
        Q.advance(queue.getState()) ?? (player.getState().repeat === 'all' ? wrap() : null);
      if (next) load(next, isActive());
    },

    /** True when Next has somewhere to go (§3: nextUp, then the context, then repeat-all). */
    hasNext() {
      const q = queue.getState();
      if (provider?.skipNext) return q.context.length > 0;
      return Q.upcoming(q).length > 0 || (player.getState().repeat === 'all' && source !== null);
    },

    /** Start or resume without ever pausing (a click on the "Now playing" row). */
    resume() {
      if (!isActive()) toggle();
    },

    previous() {
      const s = player.getState();
      if (!s.track) return;
      if (provider?.skipPrevious && positionNow(s, clock.now()) <= RESTART_AFTER_MS)
        return void provider.skipPrevious();
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
      if (provider?.setShuffle) return void provider.setShuffle(shuffle);
      queue.setState(Q.setShuffle(queue.getState(), shuffle, random), true);
    },

    cycleRepeat() {
      const order = { off: 'all', all: 'one', one: 'off' } as const;
      const repeat = order[player.getState().repeat];
      player.setState({ repeat });
      void provider?.setRepeat?.(repeat);
    },

    /** "Play next": before anything already queued. `label` names it in the notice. */
    playNext(tracks: Track[], label: string) {
      if (otherProvider(tracks)) return void playList(tracks, 0, { kind: 'search', title: label });
      if (spotifyQueue(tracks)) {
        // Spotify's queue only appends (§6.1): "Play next" becomes "Add to queue", with a note.
        notify(`${strings.playback.added(label)} ${strings.spotify.playNextBecomesAdd}`);
        return;
      }
      let q = queue.getState();
      for (const t of [...tracks].reverse()) q = Q.playNext(q, t);
      enqueue(q);
      notify(strings.playback.playingNext(label));
    },

    /** "Add to queue": after everything already queued. */
    addToQueue(tracks: Track[], label: string) {
      if (otherProvider(tracks)) return void playList(tracks, 0, { kind: 'search', title: label });
      if (spotifyQueue(tracks)) return notify(strings.playback.added(label));
      let q = queue.getState();
      for (const t of tracks) q = Q.addToQueue(q, t);
      enqueue(q);
      notify(strings.playback.added(label));
    },

    /** Play an upcoming track now (`index` into `upcoming()`), skipping the ones before it. */
    jump(index: number) {
      // A provider that owns its queue (Spotify) skips through it: loading the one track would
      // replace its context (QUE-04).
      const own = provider;
      if (own?.skipNext) {
        void (async () => {
          for (let i = 0; i <= index; i++) await own.skipNext?.();
        })();
        return;
      }
      const next = Q.jump(queue.getState(), index);
      if (next) load(next, true);
    },

    /** Queue edits (QUE-01), by position in `upcoming()`. */
    move(from: number, to: number) {
      if (!player.getState().capabilities.canReorderQueue) return;
      queue.setState(Q.moveTo(queue.getState(), from, to), true);
    },
    remove(index: number) {
      if (!player.getState().capabilities.canRemoveFromQueue) return;
      queue.setState(Q.removeAt(queue.getState(), index), true);
    },
    clear() {
      if (!player.getState().capabilities.canRemoveFromQueue) return;
      queue.setState(Q.clearUpcoming(queue.getState()), true);
    },
  };
}

export type PlaybackController = ReturnType<typeof createPlaybackController>;
