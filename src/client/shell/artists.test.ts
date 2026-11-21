import { describe, expect, it } from 'vitest';
import type { Album } from '../library.ts';
import { artistEntries } from '../library-navidrome.ts';
import { artistsFromAlbums, serverArtists, withFollowed } from './artists.ts';

// LIB-01: Your Library's Artists come from the server's own list (Navidrome getArtists) where there
// is one, and from the albums otherwise; the artists the user follows are added either way.

const album = (id: string, artist: string, artistId?: string): Album => ({
  id,
  title: id,
  artist,
  artistId,
  cover: `/c/${id}`,
  tracks: [],
});

describe('artists (LIB-01)', () => {
  it("flattens getArtists' letter index, keeping the server's counts and pictures", () => {
    expect(
      artistEntries([
        // Navidrome's ids are hashes; an artist's picture is `ar-<id>` unless it names another.
        { artist: [{ id: '3d7f', name: 'Lowfield', albumCount: 2 }] },
        {
          artist: [
            { id: '9a1c', name: 'Mira Sole', coverArt: 'ar-9a1c_0', albumCount: 1 },
            { id: '04be', name: 'Field' },
          ],
        },
        {},
      ]),
    ).toEqual([
      {
        id: '3d7f',
        name: 'Lowfield',
        image: '/api/v1/navidrome/cover/ar-3d7f?size=300',
        albumCount: 2,
      },
      {
        id: '9a1c',
        name: 'Mira Sole',
        image: '/api/v1/navidrome/cover/ar-9a1c_0?size=300',
        albumCount: 1,
      },
      {
        id: '04be',
        name: 'Field',
        image: '/api/v1/navidrome/cover/ar-04be?size=300',
        albumCount: 0,
      },
    ]);
    expect(artistEntries(undefined)).toEqual([]);
  });

  it('counts the albums by artist id, else by name', () => {
    const rows = artistsFromAlbums([
      album('a', 'Lowfield', 'ar-1'),
      album('b', 'Lowfield', 'ar-1'),
      album('c', ' Ada Varga '),
      album('d', 'Ada Varga'),
    ]);
    expect(rows).toEqual([
      { key: 'ar-1', id: 'ar-1', name: 'Lowfield', image: '/c/a', albums: 2 },
      { key: 'name: Ada Varga ', id: undefined, name: 'Ada Varga', image: '/c/c', albums: 1 },
      { key: 'name:Ada Varga', id: undefined, name: 'Ada Varga', image: '/c/d', albums: 1 },
    ]);
  });

  it('adds the followed artists the list lacks, A–Z', () => {
    const rows = withFollowed(
      serverArtists([
        { id: 'ar-2', name: 'Mira Sole', albumCount: 1 },
        { id: 'ar-1', name: 'Lowfield', albumCount: 2 },
      ]),
      [
        { id: 'ar-1', name: 'Lowfield' },
        { id: 'ar-9', name: 'Choir of Strangers', image: '/c/ar-9' },
      ],
    );
    expect(rows.map((r) => [r.name, r.albums, !!r.followedOnly])).toEqual([
      ['Choir of Strangers', 0, true],
      ['Lowfield', 2, false],
      ['Mira Sole', 1, false],
    ]);
  });
});
