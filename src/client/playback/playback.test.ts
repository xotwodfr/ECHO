import { describe, expect, it } from 'vitest';
import type { QueueState, Track } from '../../shared/types.ts';
import { ManualClock } from './clock.ts';
import { createPlaybackController, positionNow, RESTART_AFTER_MS } from './controller.ts';
import { FakeProvider } from './fake.ts';
import * as Q from './queue.ts';

const track = (n: number, durationMs = 200_000): Track => ({
  key: `navidrome:t${n}`,
  provider: 'navidrome',
  id: `t${n}`,
  title: `Track ${n}`,
  artists: [{ name: 'Artist' }],
  album: { id: 'a', title: 'Album', key: 'navidrome:a' },
  durationMs,
  artwork: [],
});
const album = [1, 2, 3, 4, 5].map((n) => track(n));
const ctx = { kind: 'album', id: 'a', title: 'Album' } as const;
const titles = (ts: Track[]) => ts.map((t) => t.id);
const random = () => Q.seededRandom(7);

describe('queue', () => {
  const start = (index = 0, shuffle = false) =>
    Q.startContext(Q.emptyQueue(), album, index, ctx, 'navidrome', shuffle, random());

  it('starting an album from an index plays it and queues the rest', () => {
    const q = start(2);
    expect(q.now?.id).toBe('t3');
    expect(titles(Q.upcoming(q))).toEqual(['t4', 't5']);
    expect(q.contextSource).toEqual(ctx);
  });

  it('advances through nextUp first, then the context, keeping history', () => {
    let q: QueueState | null = Q.addToQueue(Q.playNext(start(), track(9)), track(8));
    expect(titles(Q.upcoming(q))).toEqual(['t9', 't8', 't2', 't3', 't4', 't5']);
    const seen: string[] = [];
    while (q) {
      seen.push(q.now?.id ?? '');
      q = Q.advance(q);
    }
    expect(seen).toEqual(['t1', 't9', 't8', 't2', 't3', 't4', 't5']);
  });

  it('"Play next" goes before earlier "Play next"s; "Add to queue" appends', () => {
    const q = Q.playNext(Q.playNext(Q.addToQueue(start(), track(7)), track(8)), track(9));
    expect(titles(q.nextUp)).toEqual(['t9', 't8', 't7']);
  });

  it('back returns to the previous track and puts the current one next', () => {
    const q = Q.advance(Q.advance(start()) as QueueState) as QueueState; // now t3
    const b = Q.back(q) as QueueState;
    expect(b.now?.id).toBe('t2');
    expect(titles(Q.upcoming(b))).toEqual(['t3', 't4', 't5']);
    expect(Q.back(start())).toBeNull();
  });

  it('history keeps the last 50', () => {
    let q = start();
    for (let i = 0; i < 60; i++) q = Q.startContext(q, album, 0, ctx, 'navidrome', false, random());
    expect(q.history).toHaveLength(Q.HISTORY_MAX);
  });

  // QUE-02 (M5) behaviour, implemented here: shuffle only reorders the context.
  it('shuffle reorders only the context and turning it off restores the order', () => {
    const base = Q.addToQueue(start(), track(9));
    const on = Q.setShuffle(base, true, random());
    expect(titles(on.nextUp)).toEqual(['t9']);
    expect(titles(on.context)).toEqual(['t2', 't3', 't4', 't5']); // source order kept
    const order = titles(Q.orderedContext(on));
    expect(order).not.toEqual(['t2', 't3', 't4', 't5']);
    expect([...order].sort()).toEqual(['t2', 't3', 't4', 't5']);
    const played = Q.advance(Q.advance(on) as QueueState) as QueueState; // t9, then 1st shuffled
    expect(played.now?.id).toBe(order[0]);
    const off = Q.setShuffle(played, false, random());
    expect(titles(Q.upcoming(off))).toEqual(['t2', 't3', 't4', 't5'].filter((t) => t !== order[0]));
  });

  it('starting with shuffle on plays every other track of the list, once each', () => {
    let q: QueueState | null = start(2, true);
    const seen: string[] = [];
    while (q) {
      seen.push(q.now?.id ?? '');
      q = Q.advance(q);
    }
    expect(seen[0]).toBe('t3');
    expect([...seen].sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('jump skips the tracks before the target', () => {
    const q = Q.addToQueue(start(), track(9));
    const j = Q.jump(q, 3) as QueueState; // upcoming: t9, t2, t3, t4 → t4
    expect(j.now?.id).toBe('t4');
    expect(titles(Q.upcoming(j))).toEqual(['t5']);
    expect(titles(j.history)).toEqual(['t1']);
    expect((Q.jump(q, 0) as QueueState).now?.id).toBe('t9');
    expect(Q.jump(q, 99)).toBeNull();
  });

  it('jump respects the shuffle order', () => {
    const on = Q.setShuffle(start(), true, random());
    const order = titles(Q.orderedContext(on));
    const j = Q.jump(on, 1) as QueueState;
    expect(j.now?.id).toBe(order[1]);
    expect(titles(Q.upcoming(j))).toEqual(order.slice(2));
  });
});

describe('FakeProvider on a manual clock', () => {
  const setup = () => {
    const clock = new ManualClock();
    const p = new FakeProvider({ clock, loadMs: 100 });
    const states: { paused: boolean; buffering: boolean; positionMs: number }[] = [];
    let ended = 0;
    p.on('state', (s) => states.push(s));
    p.on('ended', () => ended++);
    return { clock, p, states, last: () => states.at(-1), ended: () => ended };
  };

  it('loads (buffering), then plays from the start position', async () => {
    const { clock, p, last } = setup();
    const done = p.load(track(1, 10_000), { autoplay: true, startMs: 2000 });
    expect(last()).toMatchObject({ buffering: true, paused: true, positionMs: 2000 });
    clock.advance(100);
    await done;
    expect(last()).toMatchObject({ buffering: false, paused: false, positionMs: 2000 });
  });

  it('time moves only on the clock; pause freezes it; seek moves it', async () => {
    const { clock, p, last } = setup();
    void p.load(track(1, 10_000), { autoplay: true });
    clock.advance(100);
    clock.advance(3000);
    await p.pause();
    expect(last()).toMatchObject({ paused: true, positionMs: 3000 });
    clock.advance(5000);
    await p.play();
    expect(last()?.positionMs).toBe(3000);
    await p.seek(9000);
    expect(last()).toMatchObject({ paused: false, positionMs: 9000 });
  });

  it('ends exactly at the track duration, once', async () => {
    const { clock, p, last, ended } = setup();
    void p.load(track(1, 10_000), { autoplay: true });
    clock.advance(100 + 9999);
    expect(ended()).toBe(0);
    clock.advance(1);
    expect(ended()).toBe(1);
    expect(last()).toMatchObject({ paused: true, positionMs: 10_000 });
    clock.advance(60_000);
    expect(ended()).toBe(1);
  });

  it('a newer load replaces a pending one', async () => {
    const { clock, p, last } = setup();
    const first = p.load(track(1), { autoplay: true });
    void p.load(track(2), { autoplay: false });
    await first; // settled, not left hanging
    clock.advance(100);
    expect(last()).toMatchObject({ paused: true, buffering: false });
  });

  it('reports no audio features', () => {
    expect(new FakeProvider().features().sample(0, 16)).toMatchObject({
      available: false,
      intensity: 0.6,
    });
  });
});

describe('PlaybackController (§3 transport rules)', () => {
  const setup = () => {
    const clock = new ManualClock();
    const provider = new FakeProvider({ clock, loadMs: 100 });
    const notes: string[] = [];
    const c = createPlaybackController({
      provider,
      clock,
      random: Q.seededRandom(3),
      notify: (m) => notes.push(m),
    });
    const at = () => positionNow(c.player.getState(), clock.now());
    const flush = () => new Promise((r) => setTimeout(r));
    return { clock, provider, c, notes, at, flush, s: () => c.player.getState() };
  };

  it('plays a list: loading, then playing with the position advancing', () => {
    const { clock, c, s, at } = setup();
    c.playList(album, 1, ctx);
    expect(s()).toMatchObject({ status: 'loading', track: { id: 't2' } });
    clock.advance(100);
    expect(s().status).toBe('playing');
    clock.advance(4000);
    expect(at()).toBe(4000);
    c.toggle();
    expect(s().status).toBe('paused');
    clock.advance(4000);
    expect(at()).toBe(4000);
  });

  it('previous restarts after 3 s, otherwise goes back', async () => {
    const { clock, c, s, at, flush } = setup();
    c.playList(album, 0, ctx);
    clock.advance(100);
    c.next();
    clock.advance(100);
    expect(s().track?.id).toBe('t2');
    clock.advance(RESTART_AFTER_MS + 1);
    c.previous();
    await flush();
    expect(s().track?.id).toBe('t2');
    expect(at()).toBe(0);
    clock.advance(1000);
    c.previous();
    clock.advance(100);
    expect(s()).toMatchObject({ status: 'playing', track: { id: 't1' } });
  });

  it('natural end advances; repeat-one replays; Next still advances under repeat-one', async () => {
    const { clock, c, s, flush } = setup();
    c.playList([track(1, 5000), track(2, 5000), track(3, 5000)], 0, ctx);
    clock.advance(100 + 5000);
    clock.advance(100);
    expect(s()).toMatchObject({ status: 'playing', track: { id: 't2' } });
    c.cycleRepeat();
    c.cycleRepeat();
    expect(s().repeat).toBe('one');
    clock.advance(5000);
    await flush();
    expect(s()).toMatchObject({ status: 'playing', track: { id: 't2' } });
    c.next();
    clock.advance(100);
    expect(s().track?.id).toBe('t3');
  });

  it('end of queue stops on the last track; repeat-all wraps to the start', async () => {
    const { clock, c, s } = setup();
    const short = [track(1, 5000), track(2, 5000)];
    c.playList(short, 1, ctx);
    clock.advance(100 + 5000);
    expect(s()).toMatchObject({ status: 'ended', track: { id: 't2' } });
    c.cycleRepeat(); // all
    c.toggle(); // restart the last track
    clock.advance(5000);
    clock.advance(100);
    expect(s()).toMatchObject({ status: 'playing', track: { id: 't1' } });
  });

  it('seek is optimistic and clamped; volume is stored', async () => {
    const { clock, c, s, at, provider } = setup();
    c.playList(album, 0, ctx);
    clock.advance(100);
    c.seek(150_000);
    expect(at()).toBe(150_000);
    c.seek(10_000_000);
    expect(at()).toBe(200_000 - 0);
    c.setVolume(0.4);
    expect(s().volume).toBe(0.4);
    expect(provider.getVolume()).toBe(0.4);
  });

  it('queue commands notify and feed what plays next', () => {
    const { clock, c, notes } = setup();
    c.playList(album, 0, ctx);
    clock.advance(100);
    c.addToQueue([track(9)], 'Track 9');
    c.playNext([track(7), track(8)], 'Album B');
    expect(notes).toEqual(['Added “Track 9” to the queue', 'Playing “Album B” next']);
    expect(titles(Q.upcoming(c.queue.getState())).slice(0, 3)).toEqual(['t7', 't8', 't9']);
    c.jump(2);
    clock.advance(100);
    expect(c.player.getState().track?.id).toBe('t9');
  });

  it('shuffle-play turns shuffle on and plays every track once', () => {
    const { clock, c, s } = setup();
    c.playList(album, 'shuffle', ctx);
    expect(s().shuffle).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < album.length; i++) {
      clock.advance(100);
      seen.add(s().track?.id ?? '');
      c.next();
    }
    expect([...seen].sort()).toEqual(titles(album));
  });

  it('queueing with nothing loaded cues the first queued track, paused', () => {
    const { clock, c, s } = setup();
    c.addToQueue([track(7), track(8)], 'Album B');
    expect(s()).toMatchObject({ status: 'loading', track: { id: 't7' } });
    clock.advance(100);
    expect(s().status).toBe('paused');
    expect(titles(Q.upcoming(c.queue.getState()))).toEqual(['t8']);
    c.toggle();
    expect(s().status).toBe('playing');
  });

  it('cue loads a track paused at a position, and time stays there (deterministic mode)', () => {
    const { clock, c, s, at } = setup();
    c.cue(album, 1, ctx, 42_000);
    expect(s()).toMatchObject({ status: 'loading', track: { id: 't2' }, positionMs: 42_000 });
    clock.advance(100);
    expect(s().status).toBe('paused');
    clock.advance(5000);
    expect(at()).toBe(42_000);
    expect(titles(Q.upcoming(c.queue.getState()))).toEqual(titles(album.slice(2)));
  });

  it('hasNext: false at the end unless repeat-all can wrap', () => {
    const { clock, c } = setup();
    c.playList(album, 4, ctx);
    clock.advance(100);
    expect(c.hasNext()).toBe(false);
    c.cycleRepeat(); // all
    expect(c.hasNext()).toBe(true);
    c.cycleRepeat(); // one
    expect(c.hasNext()).toBe(false);
    c.addToQueue([track(9)], 'Track 9');
    expect(c.hasNext()).toBe(true);
  });

  it('resume never pauses; toggleMute returns to the volume before muting', () => {
    const { clock, c, s } = setup();
    c.playList(album, 0, ctx);
    clock.advance(100);
    c.resume();
    expect(s().status).toBe('playing');
    c.toggle();
    c.resume();
    expect(s().status).toBe('playing');
    c.setVolume(0.35);
    c.toggleMute();
    expect(s().volume).toBe(0);
    c.toggleMute();
    expect(s().volume).toBe(0.35);
    // Methods work detached (passed straight to onClick).
    const { toggleMute, toggle } = c;
    toggleMute();
    toggle();
    expect(s()).toMatchObject({ volume: 0, status: 'paused' });
  });

  it('without a provider every command is a no-op', () => {
    const c = createPlaybackController({ provider: null });
    c.playList(album, 0, ctx);
    c.toggle();
    c.next();
    c.seek(100);
    expect(c.player.getState()).toMatchObject({ status: 'idle', track: null });
    expect(c.providerLabel).toBeNull();
  });

  it('serves recorded Features (deterministic mode) in place of the provider’s', () => {
    const provider = new FakeProvider();
    expect(createPlaybackController({ provider }).features()).toBe(provider.features());
    const recorded = { sample: () => provider.features().sample(0, 0) };
    expect(createPlaybackController({ provider, features: recorded }).features()).toBe(recorded);
  });
});
