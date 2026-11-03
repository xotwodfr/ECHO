import type { YtItem, YtPage, YtShelf } from '../../shared/youtube.ts';
import { YT_AUDIO_BYTES, YT_AUDIO_SECONDS } from '../navidrome/mock.ts';
import { type Catalogue, YtSignedOut, ytTrack } from './catalogue.ts';
import { type Resolver, YtAudioError } from './ytdlp.ts';

// A small, fixed YouTube Music for development and E2E (ECHO_DEV_FIXTURES=1): no test talks to
// YouTube. Signed in once a cookie is saved; a cookie holding "stale" signs in but then loses the
// account parts (Google rotated it). Audio comes from the mock Subsonic's /videoplayback, which
// behaves like googlevideo; the song `unavailable` never plays. Artwork is inline SVG (data: is
// allowed by the CSP), so nothing is fetched.

const COLOURS = ['#5a1d2e', '#1b2a44', '#0f3b3a', '#3b2a12', '#2d1846', '#1e3d1e', '#26264a'];
const art = (i: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${COLOURS[i % COLOURS.length]}"/><circle cx="5" cy="5" r="2" fill="#ffb3a7"/></svg>`,
  )}`;

const ARTISTS = [
  { id: 'UCfakeartist1', name: 'Kasimir Vale' },
  { id: 'UCfakeartist2', name: 'Ada Varga' },
];
const ALBUMS = [
  { id: 'MPREb_fake1', title: 'Low Sun', artist: 0 },
  { id: 'MPREb_fake2', title: 'Paper Moons', artist: 1 },
  { id: 'MPREb_fake3', title: 'Northbound', artist: 0 },
];
const SONGS = Array.from({ length: 12 }, (_, i) => {
  const album = ALBUMS[i % 3] as (typeof ALBUMS)[number];
  const artist = ARTISTS[album.artist] as (typeof ARTISTS)[number];
  return ytTrack({
    id: `fakesong${String(i + 1).padStart(3, '0')}`,
    title: `Fake Song ${i + 1}`,
    artists: [artist],
    album: { id: album.id, title: album.title },
    durationMs: YT_AUDIO_SECONDS * 1000,
    thumb: art(i),
  });
});
const PLAYLISTS = [
  { id: 'VLfakeplaylist1', title: 'Late drives', songs: SONGS.slice(0, 6) },
  { id: 'VLfakeplaylist2', title: 'My Supermix', songs: SONGS.slice(4, 12) },
];

const songItem = (t: (typeof SONGS)[number]): YtItem => ({
  kind: 'song',
  id: t.id,
  title: t.title,
  subtitle: t.artists.map((a) => a.name).join(', '),
  thumb: t.artwork[0]?.url ?? '',
  track: t,
});
const albumItem = (a: (typeof ALBUMS)[number], i: number): YtItem => ({
  kind: 'album',
  id: a.id,
  title: a.title,
  subtitle: `Album • ${ARTISTS[a.artist]?.name}`,
  thumb: art(i),
});
const playlistItem = (p: (typeof PLAYLISTS)[number], i: number): YtItem => ({
  kind: 'playlist',
  id: p.id,
  title: p.title,
  subtitle: `Playlist • ${p.songs.length} songs`,
  thumb: art(i + 3),
});
const artistItem = (a: (typeof ARTISTS)[number], i: number): YtItem => ({
  kind: 'artist',
  id: a.id,
  title: a.name,
  subtitle: 'Artist',
  thumb: art(i + 5),
});

const rows = (title: string, items: YtItem[]): YtShelf => ({ title, layout: 'rows', items });
const cards = (title: string, items: YtItem[]): YtShelf => ({ title, layout: 'cards', items });
const notFound = () => new Error('not found');

export function createFakeCatalogue(opts: {
  cookie?: string;
  audioBase: string;
  now?: () => number;
}): Catalogue & { resolver: Resolver; likes: Map<string, boolean> } {
  const now = opts.now ?? Date.now;
  const likes = new Map<string, boolean>();
  const account = () => {
    if (!opts.cookie || opts.cookie.includes('stale')) throw new YtSignedOut('not signed in');
  };
  const home: YtPage = {
    title: 'Home',
    shelves: [
      rows('Quick picks', SONGS.slice(0, 8).map(songItem)),
      cards('Listen again', [...ALBUMS.map(albumItem), ...ARTISTS.map(artistItem)]),
      cards('Mixed for you', PLAYLISTS.map(playlistItem)),
    ],
  };
  return {
    likes,
    async account() {
      if (!opts.cookie) throw new YtSignedOut('not signed in');
      return { name: 'Fixture Listener' };
    },
    home: async () => home,
    explore: async () => ({
      title: 'Explore',
      shelves: [cards('New albums & singles', ALBUMS.map(albumItem))],
    }),
    async library() {
      account();
      return {
        title: 'Library',
        shelves: [
          cards('Playlists', PLAYLISTS.map(playlistItem)),
          cards('Artists', ARTISTS.map(artistItem)),
        ],
      };
    },
    async search(q, tab) {
      const needle = q.toLowerCase();
      const songs = SONGS.filter((t) => t.title.toLowerCase().includes(needle)).map(songItem);
      const albums = ALBUMS.filter((a) => a.title.toLowerCase().includes(needle)).map(albumItem);
      const shelves = [
        ...(tab === 'all' || tab === 'songs' ? [rows('Songs', songs)] : []),
        ...(tab === 'all' || tab === 'albums' ? [cards('Albums', albums)] : []),
        ...(tab === 'all' || tab === 'artists' ? [cards('Artists', ARTISTS.map(artistItem))] : []),
      ].filter((s) => s.items.length);
      return { title: q, shelves };
    },
    suggest: async (q) =>
      SONGS.map((t) => t.title.toLowerCase())
        .filter((t) => t.startsWith(q.toLowerCase()))
        .slice(0, 5),
    async album(id) {
      const i = ALBUMS.findIndex((a) => a.id === id);
      const a = ALBUMS[i];
      if (!a) throw notFound();
      return {
        kind: 'album',
        id,
        title: a.title,
        subtitle: `Album • ${ARTISTS[a.artist]?.name} • 2025`,
        thumb: art(i),
        tracks: SONGS.filter((t) => t.album.id === id),
        shelves: [],
      };
    },
    async artist(id) {
      const i = ARTISTS.findIndex((a) => a.id === id);
      const a = ARTISTS[i];
      if (!a) throw notFound();
      const own = SONGS.filter((t) => t.artists[0]?.id === id);
      return {
        kind: 'artist',
        id,
        title: a.name,
        thumb: art(i + 5),
        tracks: own,
        shelves: [
          rows('Top songs', own.map(songItem)),
          cards(
            'Albums',
            ALBUMS.filter((x) => ARTISTS[x.artist]?.id === id).map((x) =>
              albumItem(x, ALBUMS.indexOf(x)),
            ),
          ),
        ],
      };
    },
    async playlist(id) {
      if (id === 'VLLM') {
        account();
        return {
          kind: 'playlist',
          id,
          title: 'Liked music',
          tracks: SONGS.filter((t) => likes.get(t.id)),
          shelves: [],
        };
      }
      const i = PLAYLISTS.findIndex((p) => p.id === id);
      const p = PLAYLISTS[i];
      if (!p) throw notFound();
      return {
        kind: 'playlist',
        id,
        title: p.title,
        thumb: art(i + 3),
        tracks: p.songs,
        shelves: [],
      };
    },
    async upNext(videoId) {
      const i = Math.max(
        0,
        SONGS.findIndex((t) => t.id === videoId),
      );
      return { tracks: [...SONGS.slice(i), ...SONGS.slice(0, i)] };
    },
    related: async () => ({
      title: 'Related',
      shelves: [cards('Similar artists', ARTISTS.map(artistItem))],
    }),
    lyrics: async (videoId) =>
      SONGS.some((t) => t.id === videoId)
        ? { text: 'Glass in the morning\nRain on the window', source: 'Fixture' }
        : null,
    async like(videoId, on) {
      account();
      likes.set(videoId, on);
    },
    played: async () => {},
    resolver: {
      async resolve(id) {
        if (id === 'unavailable')
          throw new YtAudioError('youtube.unavailable', 'Video unavailable');
        const expire = Math.floor(now() / 1000) + 21_600;
        return {
          url: `${opts.audioBase}/videoplayback?id=${id}&expire=${expire}`,
          size: YT_AUDIO_BYTES,
          expiresAt: expire * 1000,
        };
      },
      forget: () => {},
      status: () => ({ version: 'fixture', updatedAt: null, lastError: null }),
      note: () => {},
    },
  };
}
