import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackState, Track } from '../../shared/types.ts';
import type { PlaybackController } from '../playback/controller.ts';
import { startHistory } from './mixes.ts';

// A play counts once per listen, at Navidrome's scrobble point: half the song or four minutes.

const song = (
  id: string,
  durationMs: number,
  provider: Track['provider'] = 'navidrome',
): Track => ({
  key: `${provider}:${id}`,
  provider,
  id,
  title: id,
  artists: [{ name: 'Lowfield' }],
  album: { title: 'Harbour Lights', key: 'navidrome:al-1' },
  durationMs,
  artwork: [],
});

describe('startHistory', () => {
  let posted: { track: Track; context?: unknown }[];
  let state: Pick<PlaybackState, 'track' | 'status' | 'positionMs' | 'positionAt'>;
  let stop: () => void;
  const at = async (
    track: Track,
    positionMs: number,
    status: PlaybackState['status'] = 'playing',
  ) => {
    state = { track, status, positionMs, positionAt: performance.now() };
    await vi.advanceTimersByTimeAsync(5000);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout'] });
    posted = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true}', { status: 200 });
    });
    const c = {
      player: { getState: () => state },
      queue: { getState: () => ({ contextSource: { kind: 'album', id: 'al-1', title: 'H' } }) },
    } as unknown as PlaybackController;
    stop = startHistory(c, true);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('counts a song at half its length, once, with what it was played from', async () => {
    const a = song('a', 200_000);
    await at(a, 10_000);
    await at(a, 90_000);
    expect(posted).toEqual([]);
    await at(a, 101_000);
    await at(a, 150_000);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.track.id).toBe('a');
    expect(posted[0]?.context).toEqual({ kind: 'album', id: 'al-1', title: 'H' });
  });

  it('counts a long song at four minutes, and again when it starts over', async () => {
    const long = song('long', 20 * 60_000);
    await at(long, 4 * 60_000 + 1000);
    await at(long, 0); // repeat one, or Previous
    await at(long, 4 * 60_000 + 1000);
    expect(posted.map((p) => p.track.id)).toEqual(['long', 'long']);
  });

  it('leaves out short songs, paused songs and Spotify', async () => {
    await at(song('jingle', 20_000), 15_000);
    await at(song('paused', 200_000), 150_000, 'paused');
    await at(song('sp', 200_000, 'spotify'), 150_000);
    expect(posted).toEqual([]);
  });
});
