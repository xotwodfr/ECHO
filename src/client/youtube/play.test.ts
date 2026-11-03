import { describe, expect, it } from 'vitest';
import type { Track } from '../../shared/types.ts';
import { ManualClock } from '../playback/clock.ts';
import { createPlaybackController } from '../playback/controller.ts';
import { FakeProvider } from '../playback/fake.ts';
import { playItem } from './play.ts';

const yt = (id: string, durationMs = 180_000): Track => ({
  key: `youtube:${id}`,
  provider: 'youtube',
  id,
  title: `Song ${id}`,
  artists: [{ name: 'A' }],
  album: { title: '', key: `youtube:${id}` },
  durationMs,
  artwork: [],
});

describe('a tap in YouTube Music mode', () => {
  // Review 2026-11-03: a search row's track had no duration; Up next's copy of it does.
  it("plays Up next's copy of a song, which knows its duration", async () => {
    const clock = new ManualClock();
    const provider = new FakeProvider({ clock, loadMs: 0 });
    Object.assign(provider, { sources: ['navidrome', 'youtube'] });
    const c = createPlaybackController({ provider, clock });
    const tapped = yt('a', 0);
    await playItem(
      c,
      { kind: 'song', id: 'a', title: 'Song a', subtitle: '', thumb: '', track: tapped },
      undefined,
      async () => ({ tracks: [yt('a', 201_000), yt('b')] }),
    );
    expect(c.queue.getState().now?.durationMs).toBe(201_000);
    expect(c.queue.getState().context.map((t) => t.id)).toEqual(['b']);
  });
});
