import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types.ts';
import { ManualClock } from '../playback/clock.ts';
import { createPlaybackController } from '../playback/controller.ts';
import { FakeProvider } from '../playback/fake.ts';
import { startYtPrepare, ytAutoplay } from './radio.ts';

// Resolving ahead (goal 9: the next song starts without yt-dlp's wait) and YouTube's radio when
// the queue runs out (spec call 11).

const yt = (id: string): Track => ({
  key: `youtube:${id}`,
  provider: 'youtube',
  id,
  title: `Song ${id}`,
  artists: [{ name: 'A' }],
  album: { title: '', key: `youtube:${id}` },
  durationMs: 180_000,
  artwork: [],
});
const nd: Track = { ...yt('n'), key: 'navidrome:n', provider: 'navidrome' };
const ctx = { kind: 'album', id: 'x', title: 'X' } as const;

function setup() {
  const clock = new ManualClock();
  const provider = new FakeProvider({ clock, loadMs: 0 });
  Object.assign(provider, { sources: ['navidrome', 'youtube'] });
  return createPlaybackController({ provider, clock });
}

describe('YouTube radio and prepare-ahead', () => {
  it('prepare sends the next three youtube ids once', () => {
    const c = setup();
    const sent: string[][] = [];
    startYtPrepare(c, async (ids) => void sent.push(ids));
    c.playList([yt('a'), yt('b'), nd, yt('c'), yt('d'), yt('e')], 0, ctx);
    c.playList([yt('a'), yt('b'), nd, yt('c'), yt('d'), yt('e')], 0, ctx); // the same again
    expect(sent).toEqual([['b', 'c', 'd']]);
    c.next(); // now b: c, d, e are next
    expect(sent.at(-1)).toEqual(['c', 'd', 'e']);
  });

  it('autoplay plays up next minus history', async () => {
    const c = setup();
    c.playList([yt('a'), yt('b')], 0, ctx);
    c.next(); // a is in the history, b plays
    c.player.setState({ status: 'ended' });
    await ytAutoplay(c, yt('b'), async () => ({ tracks: [yt('b'), yt('a'), yt('c'), yt('d')] }));
    expect(c.queue.getState().now?.id).toBe('c');
    expect(c.queue.getState().context.map((t) => t.id)).toEqual(['d']);
    expect(c.queue.getState().contextSource?.kind).toBe('radio');
  });

  it('autoplay ignores navidrome tracks', async () => {
    const c = setup();
    let asked = false;
    await ytAutoplay(c, nd, async () => {
      asked = true;
      return { tracks: [yt('z')] };
    });
    expect(asked).toBe(false);
  });
});
