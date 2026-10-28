import { describe, expect, it } from 'vitest';
import type { Library, Playlist } from './library.ts';
import { combineLibraries } from './library-spotify.ts';

// SRCH-02's combined library (Navidrome + Spotify). ON-UI-3: each side's failure was swallowed into
// an empty list, so with both failing the Playlists tab said "no playlists" and search "no results"
// instead of their error blocks with Retry.

const list = (name: string): Playlist[] => [{ id: name, name, tracks: 1 }];
const found = { tracks: [], albums: [] };
const lib = (
  playlists: () => Promise<Playlist[]>,
  search: () => Promise<typeof found>,
): Library => ({
  albums: [],
  album: () => undefined,
  search: () => found,
  playlists,
  searchRemote: search,
});
const fail = () => Promise.reject(new Error('unreachable'));

describe('combineLibraries', () => {
  it('both answering: both lists', async () => {
    const both = combineLibraries(
      lib(
        async () => list('nav'),
        async () => found,
      ),
      lib(
        async () => list('sp'),
        async () => found,
      ),
    );
    expect((await both.playlists?.())?.map((p) => p.name)).toEqual(['nav', 'sp']);
  });

  it('one failing: the other’s answer', async () => {
    const one = combineLibraries(
      lib(fail, async () => found),
      lib(async () => list('sp'), fail),
    );
    expect((await one.playlists?.())?.map((p) => p.name)).toEqual(['sp']);
    expect(await one.searchRemote?.('x')).toEqual(found);
  });

  it('both failing: an error, not an empty answer', async () => {
    const none = combineLibraries(lib(fail, fail), lib(fail, fail));
    await expect(none.playlists?.()).rejects.toThrow('unreachable');
    await expect(none.searchRemote?.('x')).rejects.toThrow('unreachable');
  });
});
