import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types.ts';
import { ManualClock } from '../playback/clock.ts';
import { createPlaybackController, positionNow, type RemoteQueue } from '../playback/controller.ts';
import { FakeProvider } from '../playback/fake.ts';
import * as Q from '../playback/queue.ts';
import { refOf } from './session.ts';

// The controller's Listen together hook: with a remote set, the transport and the queue go to the
// shared session; the player itself moves only when following it.

const track = (n: number, durationMs = 10_000): Track => ({
  key: `navidrome:t${n}`,
  provider: 'navidrome',
  id: `t${n}`,
  title: `Track ${n}`,
  artists: [{ id: 'ar', name: 'Artist' }],
  album: { id: 'a', title: 'Album', key: 'navidrome:a' },
  durationMs,
  artwork: [{ url: '/api/v1/navidrome/cover/c1?size=600' }],
});
const ctx = { kind: 'together', title: 'Listening together' } as const;

function setup() {
  const clock = new ManualClock();
  const provider = new FakeProvider({ clock, loadMs: 100 });
  const c = createPlaybackController({ provider, clock, random: Q.seededRandom(1) });
  const calls: string[] = [];
  const remote: RemoteQueue = {
    toggle: () => calls.push('toggle'),
    next: () => calls.push('next'),
    previous: () => calls.push('previous'),
    seek: (ms) => calls.push(`seek ${ms}`),
    add: (ts, _label, next) => calls.push(`add ${ts.map((t) => t.id).join(',')} ${next}`),
    play: (ts, i) => calls.push(`play ${ts[i]?.id}`),
    ended: () => calls.push('ended'),
  };
  return { clock, provider, c, calls, remote };
}

describe('Listen together in the controller', () => {
  it('sends the transport and the queue to the session while one is set', () => {
    const { c, calls, remote } = setup();
    c.together.setRemote(remote);
    c.playList([track(1), track(2)], 1, { kind: 'album', title: 'Album' });
    c.addToQueue([track(3)], 'Track 3');
    c.playNext([track(4)], 'Track 4');
    c.toggle();
    c.next();
    c.previous();
    c.seek(5000);
    expect(calls).toEqual([
      'play t2',
      'add t3 false',
      'add t4 true',
      'toggle',
      'next',
      'previous',
      'seek 5000',
    ]);
    // Nothing moved here.
    expect(c.player.getState().track).toBeNull();
    c.together.setRemote(null);
    c.addToQueue([track(3)], 'Track 3');
    expect(c.player.getState().track?.id).toBe('t3');
  });

  it('follows: loads at a position, seeks, pauses; an ended song is the session’s to move on', () => {
    const { clock, c, calls, remote } = setup();
    c.together.setRemote(remote);
    c.together.load(track(1), 4000, true, ctx);
    clock.advance(100);
    expect(c.player.getState().status).toBe('playing');
    expect(Math.round(positionNow(c.player.getState(), clock.now()))).toBe(4000);
    c.together.seek(8000);
    expect(positionNow(c.player.getState(), clock.now())).toBe(8000);
    clock.advance(2500);
    // The song ended here: the session decides what is next; Autoplay sees no "ended".
    expect(calls).toEqual(['ended']);
    expect(c.player.getState().status).toBe('paused');
    expect(c.queue.getState().contextSource).toEqual(ctx);
  });

  it('a song goes to the server as a TrackRef', () => {
    expect(refOf(track(1))).toEqual({
      id: 't1',
      title: 'Track 1',
      artist: 'Artist',
      artistId: 'ar',
      album: 'Album',
      albumId: 'a',
      durationMs: 10_000,
      cover: '/api/v1/navidrome/cover/c1?size=600',
    });
  });
});
