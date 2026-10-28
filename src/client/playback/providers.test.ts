import { describe, expect, it } from 'vitest';
import type {
  AppError,
  PlaybackProvider,
  PlayContext,
  ProviderState,
  Track,
} from '../../shared/types.ts';
import { ManualClock } from './clock.ts';
import { createPlaybackController } from './controller.ts';
import { FakeProvider } from './fake.ts';
import { SILENT_FEATURES } from './features.ts';

// Two providers, one queue (PLAYBACK_ARCHITECTURE.md §6.1): QUE-03 (never mixed; "Replace the
// queue?"), QUE-04 (Spotify's queue is add-only), SP-06 (no mixed queue), and the controller
// handing transport to the provider that owns its queue.

const track = (provider: 'navidrome' | 'spotify', n: number): Track => ({
  key: `${provider}:t${n}`,
  provider,
  id: `t${n}`,
  title: `${provider} ${n}`,
  artists: [{ name: 'A' }],
  album: { id: 'a', title: 'Album', key: `${provider}:a` },
  durationMs: 200_000,
  artwork: [],
});
const nd = [1, 2, 3].map((n) => track('navidrome', n));
const sp = [1, 2, 3].map((n) => track('spotify', n));
const albumCtx = { kind: 'album', id: 'a', title: 'Album' } as const;

/** A provider that owns its queue, as Spotify does, recording what it was asked. */
function ownQueueProvider() {
  const calls: string[] = [];
  const listeners = {
    state: new Set<(s: ProviderState) => void>(),
    ended: new Set<() => void>(),
    error: new Set<(e: AppError) => void>(),
  };
  const p: PlaybackProvider & { label: string } = {
    id: 'spotify',
    label: 'Spotify',
    capabilities: {
      canSeek: true,
      canSetVolume: true,
      canReorderQueue: false,
      canRemoveFromQueue: false,
      canCrossfade: false,
      audioFeatures: false,
      artPaletteAllowed: true,
      syncedLyricsAllowed: true,
      requiresAttribution: 'spotify',
    },
    connect: async () => {},
    disconnect: async () => {},
    load: async (t) => void calls.push(`load ${t.id}`),
    play: async () => void calls.push('play'),
    pause: async () => void calls.push('pause'),
    seek: async (ms) => void calls.push(`seek ${ms}`),
    setVolume: async () => {},
    playContext: async (ctx: PlayContext, offset: number, tracks: Track[]) =>
      void calls.push(`context ${ctx.kind} ${offset} ${tracks.length}`),
    enqueue: async (t) => void calls.push(`enqueue ${t.id}`),
    skipNext: async () => void calls.push('next'),
    skipPrevious: async () => void calls.push('previous'),
    setShuffle: async (on) => void calls.push(`shuffle ${on}`),
    setRepeat: async (m) => void calls.push(`repeat ${m}`),
    on: ((event: 'state' | 'ended' | 'error', cb: never) => {
      (listeners[event] as Set<unknown>).add(cb);
      return () => (listeners[event] as Set<unknown>).delete(cb);
    }) as unknown as PlaybackProvider['on'],
    features: () => SILENT_FEATURES,
  };
  const emit = (s: Partial<ProviderState>) => {
    for (const cb of listeners.state)
      cb({ track: null, positionMs: 0, positionAt: 0, paused: false, buffering: false, ...s });
  };
  return { p, calls, emit };
}

function setup(answer = true) {
  const clock = new ManualClock();
  const nav = new FakeProvider({ clock, loadMs: 0 });
  const spotify = ownQueueProvider();
  const asked: string[] = [];
  const notes: string[] = [];
  const c = createPlaybackController({
    provider: nav,
    spotify: spotify.p,
    clock,
    notify: (m) => notes.push(m),
    confirmReplace: async (p) => {
      asked.push(p.id);
      return answer;
    },
  });
  return { c, nav, spotify, clock, asked, notes };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('one provider per queue', () => {
  it('QUE-03: Spotify music over a Navidrome queue asks first; "no" keeps the queue', async () => {
    const { c, asked, clock } = setup(false);
    c.playList(nd, 0, albumCtx);
    clock.advance(10);
    await c.playList(sp, 0, albumCtx);
    expect(asked).toEqual(['spotify']);
    expect(c.queue.getState()).toMatchObject({
      provider: 'navidrome',
      now: { key: 'navidrome:t1' },
    });
  });

  it('"yes" replaces the queue, pauses Navidrome, and takes Spotify’s capabilities', async () => {
    const { c, nav, spotify, clock } = setup(true);
    c.playList(nd, 0, albumCtx);
    clock.advance(10);
    expect(c.player.getState().status).toBe('playing');
    await c.playList(sp, 1, albumCtx);
    expect(c.queue.getState().provider).toBe('spotify');
    expect(c.queue.getState().now?.key).toBe('spotify:t2');
    expect(c.queue.getState().history).toEqual([]);
    expect(spotify.calls).toEqual(['context album 1 3']);
    expect(c.player.getState().capabilities.requiresAttribution).toBe('spotify');
    expect(c.providerLabel).toBe('Spotify');
    // Navidrome was paused and its late events no longer move the player.
    clock.advance(1000);
    expect(nav.getVolume()).toBe(1);
    expect(c.player.getState().track?.key).toBe('spotify:t2');
  });

  it('with nothing playing, no question is asked', async () => {
    const { c, asked, spotify } = setup();
    c.playList(sp, 0, albumCtx);
    await tick();
    expect(asked).toEqual([]);
    expect(spotify.calls).toEqual(['context album 0 3']);
  });

  it('SP-06: adding Navidrome tracks to a Spotify queue plays them instead (asking), never mixes', async () => {
    const { c, asked, spotify } = setup(false);
    c.playList(sp, 0, albumCtx);
    c.addToQueue([nd[0] as Track], 'Song');
    c.playNext([nd[1] as Track], 'Song');
    await tick();
    expect(asked).toEqual(['navidrome', 'navidrome']);
    expect(spotify.calls.filter((x) => x.startsWith('enqueue'))).toEqual([]);
    expect(c.queue.getState().provider).toBe('spotify');
  });
});

describe('a provider that owns its queue (Spotify)', () => {
  it('transport, shuffle and repeat go to it', async () => {
    const { c, spotify } = setup();
    c.playList(sp, 0, albumCtx);
    spotify.emit({ track: sp[0] as Track, positionMs: 500 });
    c.next();
    c.previous();
    c.toggleShuffle();
    c.cycleRepeat();
    expect(spotify.calls.slice(1)).toEqual(['next', 'previous', 'shuffle true', 'repeat all']);
  });

  it('mirrors what it reports: the current track, what comes next, shuffle and repeat', () => {
    const { c, spotify } = setup();
    c.playList(sp, 0, albumCtx);
    spotify.emit({
      track: sp[1] as Track,
      upcoming: [sp[2] as Track],
      shuffle: true,
      repeat: 'one',
    });
    expect(c.queue.getState()).toMatchObject({
      provider: 'spotify',
      now: { key: 'spotify:t2' },
      context: [{ key: 'spotify:t3' }],
    });
    expect(c.player.getState()).toMatchObject({ shuffle: true, repeat: 'one', status: 'playing' });
    expect(c.hasNext()).toBe(true);
  });

  // ON-INT-1: a click on an upcoming row loaded that one track, replacing Spotify's context: the
  // rest of the album was gone and playback stopped after it.
  it('playing an upcoming row skips to it, keeping Spotify’s context', async () => {
    const { c, spotify } = setup();
    c.playList(sp, 0, albumCtx);
    spotify.emit({ track: sp[0] as Track, upcoming: [sp[1] as Track, sp[2] as Track] });
    const before = spotify.calls.length;
    c.jump(1); // the second upcoming track
    await tick();
    expect(spotify.calls.slice(before)).toEqual(['next', 'next']);
  });

  it('QUE-04: add-only; "Play next" becomes "Add to queue" with a note; no reorder/remove/clear', () => {
    const { c, spotify, notes } = setup();
    c.playList(sp, 0, albumCtx);
    spotify.emit({ track: sp[0] as Track, upcoming: [sp[1] as Track, sp[2] as Track] });
    c.addToQueue([track('spotify', 7)], 'Seven');
    c.playNext([track('spotify', 8)], 'Eight');
    expect(spotify.calls.filter((x) => x.startsWith('enqueue'))).toEqual([
      'enqueue t7',
      'enqueue t8',
    ]);
    expect(notes.at(-1)).toMatch(/only add to the end/);
    const before = c.queue.getState();
    c.move(0, 1);
    c.remove(0);
    c.clear();
    expect(c.queue.getState()).toBe(before);
  });
});
