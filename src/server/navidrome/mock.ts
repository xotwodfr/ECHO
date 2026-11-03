import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fixtureCover } from '../palette/covers.ts';

// A mock Subsonic/Navidrome server (IMPLEMENTATION_PLAN.md M5 task 6) for unit and E2E tests: token
// and API-key auth, the methods ECHO's proxy allows over a small deterministic library, WAV streams
// with Range, covers, scrobbles, and fault injection (down, slow, 401, a stream that breaks).

export interface MockOptions {
  username?: string;
  password?: string;
  apiKey?: string | null; // advertise and accept apiKeyAuthentication
  port?: number; // 0 (any free port) by default
}

export interface Faults {
  down: boolean; // connections are dropped
  slowMs: number; // every response waits
  unauthorized: boolean; // HTTP 401 for everything
  breakStreamAt: number | null; // a stream body stops after this many bytes
  failStreams: number; // the next this many stream requests answer 503 (a restarting Navidrome)
  lyricsDelayMs: number; // the mock LRCLIB answers this late
  lrclibStatus: number; // and with this status (200: normal)
  bigLibrary: number; // this many extra synthetic albums in the album list (LIB-02)
}

const SAMPLE_RATE = 8000;
const ARTISTS = [
  { id: 'ar-1', name: 'Lowfield' },
  { id: 'ar-2', name: 'Mira Sole' },
  { id: 'ar-3', name: 'Field Ensemble' },
];
const ALBUMS = [
  {
    id: 'al-1',
    name: 'Harbour Lights',
    artistId: 'ar-1',
    year: 2019,
    cover: 'night-sun',
    tracks: 4,
    genre: 'Ambient',
  },
  {
    id: 'al-2',
    name: 'Copper Rain',
    artistId: 'ar-1',
    year: 2015,
    cover: 'fire',
    tracks: 3,
    genre: 'Folk',
  },
  {
    id: 'al-3',
    name: 'Glass Weather',
    artistId: 'ar-2',
    year: 2023,
    cover: 'neon-magenta',
    tracks: 5,
    genre: 'Electronic',
  },
  {
    id: 'al-4',
    name: 'Long Exposure',
    artistId: 'ar-3',
    year: 2017,
    cover: 'grey-gradient',
    tracks: 3,
    genre: 'Ambient',
  },
];

function songsOf(a: (typeof ALBUMS)[number]) {
  const artist = ARTISTS.find((x) => x.id === a.artistId) as (typeof ARTISTS)[number];
  return Array.from({ length: a.tracks }, (_, i) => ({
    id: `${a.id}-t${i + 1}`,
    title: `${a.name} ${i + 1}`,
    artist: artist.name,
    artistId: artist.id,
    album: a.name,
    albumId: a.id,
    coverArt: a.id,
    track: i + 1,
    year: a.year,
    genre: a.genre,
    duration: 20 + i * 5,
    suffix: 'wav',
    contentType: 'audio/wav',
    bitRate: 128,
    replayGain: { trackGain: -6 - i, albumGain: -7, trackPeak: 0.9, albumPeak: 0.95 },
  }));
}
const SONGS = ALBUMS.flatMap(songsOf);
const albumJson = (a: (typeof ALBUMS)[number]) => ({
  id: a.id,
  name: a.name,
  artist: ARTISTS.find((x) => x.id === a.artistId)?.name,
  artistId: a.artistId,
  coverArt: a.id,
  songCount: a.tracks,
  duration: songsOf(a).reduce((s, x) => s + x.duration, 0),
  year: a.year,
  genre: a.genre,
});

/** Every fake YouTube song's audio: three minutes of one tone (youtube/fake.ts sizes it). */
export const YT_AUDIO_SECONDS = 180;
export const YT_AUDIO_BYTES = 44 + YT_AUDIO_SECONDS * SAMPLE_RATE * 2;
let ytWav: Buffer | null = null;
const ytAudio = () => {
  ytWav ??= wav(YT_AUDIO_SECONDS, 330);
  return ytWav;
};

/** A mono 16-bit WAV: a soft tone whose pitch identifies the track. */
function wav(seconds: number, hz: number) {
  const n = seconds * SAMPLE_RATE;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SAMPLE_RATE, 24);
  b.writeUInt32LE(SAMPLE_RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)), 44 + i * 2);
  return b;
}

export async function startMockSubsonic(opts: MockOptions = {}) {
  const username = opts.username ?? 'ada';
  const password = opts.password ?? 'navidrome-pass';
  const apiKey = opts.apiKey ?? null;
  const faults: Faults = {
    down: false,
    slowMs: 0,
    unauthorized: false,
    breakStreamAt: null,
    failStreams: 0,
    lyricsDelayMs: 0,
    lrclibStatus: 200,
    bigLibrary: 0,
  };
  const starred = new Set<string>(['al-1-t2']);
  const starredAlbums = new Set<string>();
  const starredArtists = new Set<string>();
  // Playlists the tests can create, edit and delete (the Spotify-style pages).
  const playlists = new Map([
    [
      'pl-1',
      { id: 'pl-1', name: 'Evening', comment: '', songIds: SONGS.slice(0, 3).map((x) => x.id) },
    ],
  ]);
  let nextPlaylist = 2;
  const playlistJson = (p: { id: string; name: string; comment: string; songIds: string[] }) => ({
    id: p.id,
    name: p.name,
    comment: p.comment,
    owner: username,
    songCount: p.songIds.length,
    duration: p.songIds.reduce((t, x) => t + (SONGS.find((y) => y.id === x)?.duration ?? 0), 0),
    coverArt: p.songIds.length ? `pl-${p.id}` : undefined,
  });
  const scrobbles: { id: string; submission: boolean }[] = [];
  const requests: URLSearchParams[] = [];
  const audio = new Map<string, Buffer>();
  /** Test switches: what a cover claims to be, and a giant JSON reply. */
  const state = { coverType: 'image/png', hugeJson: false };

  const authed = (q: URLSearchParams) => {
    if (q.has('apiKey'))
      return apiKey !== null && q.get('apiKey') === apiKey && !q.has('u') && !q.has('t');
    const s = q.get('s') ?? '';
    return (
      q.get('u') === username &&
      s.length >= 6 &&
      q.get('t') ===
        createHash('md5')
          .update(password + s)
          .digest('hex')
    );
  };
  const ok = (extra: Record<string, unknown> = {}) => ({
    'subsonic-response': {
      status: 'ok',
      version: '1.16.1',
      type: 'navidrome',
      serverVersion: '0.64.2',
      openSubsonic: true,
      ...extra,
    },
  });
  const fail = (code: number, message: string) => ({
    'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } },
  });

  const server = http.createServer(async (req, res) => {
    // Test control, before any fault applies: /__faults?down=1&slowMs=…&breakStreamAt=… (E2E).
    if (req.url?.startsWith('/__faults')) {
      const q = new URL(req.url, 'http://mock').searchParams;
      faults.down = q.get('down') === '1';
      faults.slowMs = Number(q.get('slowMs') ?? 0);
      faults.unauthorized = q.get('unauthorized') === '1';
      faults.breakStreamAt = q.has('breakStreamAt') ? Number(q.get('breakStreamAt')) : null;
      faults.failStreams = Number(q.get('failStreams') ?? 0);
      faults.lyricsDelayMs = Number(q.get('lyricsDelayMs') ?? 0);
      faults.lrclibStatus = Number(q.get('lrclibStatus') ?? 200);
      faults.bigLibrary = Number(q.get('bigLibrary') ?? 0);
      return res.end('ok');
    }
    // ListenBrainz and MusicBrainz (Spotify matching in E2E) know no track.
    if (req.url?.startsWith('/spotify-id-from-')) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const asked = JSON.parse(Buffer.concat(chunks).toString() || '[]') as unknown[];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(asked.map(() => ({ spotify_track_ids: [] }))));
    }
    if (req.url?.startsWith('/ws/2/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"Not Found"}');
    }
    // LRCLIB's search and NetEase (ECHO_NETEASE_URL in E2E) know nothing: the exact lookup decides.
    if (req.url?.startsWith('/api/search')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(req.url.startsWith('/api/search/get') ? '{"result":{"songs":[]}}' : '[]');
    }
    // A mock LRCLIB (ECHO_LRCLIB_URL in E2E): "Glass Weather" tracks have synced lyrics.
    if (req.url?.startsWith('/api/get')) {
      const q = new URL(req.url, 'http://mock').searchParams;
      await new Promise((r) => setTimeout(r, faults.lyricsDelayMs));
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (faults.lrclibStatus !== 200)
        return send(faults.lrclibStatus, { message: 'mock failure' });
      const title = q.get('track_name') ?? '';
      const song = SONGS.find((x) => x.title === title && x.album === 'Glass Weather');
      if (!song) return send(404, { code: 404, name: 'TrackNotFound' });
      return send(200, {
        trackName: song.title,
        artistName: song.artist,
        albumName: song.album,
        duration: song.duration,
        instrumental: false,
        plainLyrics: 'Glass in the morning\nRain on the window',
        // The first line names its track, so E2E can tell the tracks' lyrics apart.
        syncedLyrics: `[00:01.00]Glass in the morning, ${song.title}\n[00:05.00]Rain on the window\n[00:09.00]Light coming through`,
      });
    }
    if (faults.down) return req.socket.destroy();
    if (faults.slowMs) await new Promise((r) => setTimeout(r, faults.slowMs));
    const url = new URL(req.url ?? '/', 'http://mock');
    const q = url.searchParams;
    requests.push(q);
    const method = url.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
    if (url.pathname === '/health') return res.end('ok'); // for the E2E web server
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // googlevideo for YouTube Music mode's E2E (the fake catalogue's resolver points here): like the
    // real one it refuses a Range header and serves the `range` query parameter.
    if (url.pathname === '/videoplayback') {
      if (req.headers.range) return json({ error: 'range header' }, 403);
      const r = /^(\d+)-(\d+)$/.exec(q.get('range') ?? '');
      const start = r ? Number(r[1]) : 0;
      const end = r ? Math.min(Number(r[2]), YT_AUDIO_BYTES - 1) : YT_AUDIO_BYTES - 1;
      const part = ytAudio().subarray(start, end + 1);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': part.length });
      return res.end(part);
    }
    if (faults.unauthorized) return json({ error: 'unauthorized' }, 401);
    if (!url.pathname.startsWith('/rest/')) return json({ error: 'not found' }, 404);
    if (!authed(q)) return json(fail(40, 'Wrong username or password'));
    if (state.hugeJson && method === 'getArtists') {
      // 20 MB of valid-looking JSON, streamed (the client must stop reading it).
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"subsonic-response":{"status":"ok","pad":"');
      const mb = Buffer.alloc(1024 * 1024, 97);
      for (let i = 0; i < 20 && !res.destroyed; i++) res.write(mb);
      return res.end('"}}');
    }
    const id = q.get('id') ?? '';

    switch (method) {
      case 'ping':
        return json(ok());
      case 'getOpenSubsonicExtensions':
        return json(
          ok({
            openSubsonicExtensions: [
              { name: 'songLyrics', versions: [1] },
              { name: 'transcodeOffset', versions: [1] },
              ...(apiKey ? [{ name: 'apiKeyAuthentication', versions: [1] }] : []),
            ],
          }),
        );
      case 'getLicense':
        return json(ok({ license: { valid: true } }));
      case 'getScanStatus':
        return json(ok({ scanStatus: { scanning: false, count: SONGS.length } }));
      case 'getAlbumList2': {
        // As Navidrome: the year sort needs its range (code 10, in an HTTP 200).
        if (q.get('type') === 'byYear' && (!q.has('fromYear') || !q.has('toYear')))
          return json(fail(10, "missing parameter: 'fromYear'"));
        const size = Math.min(500, Number(q.get('size') ?? 10));
        const offset = Number(q.get('offset') ?? 0);
        const type = q.get('type');
        const sorted = [...ALBUMS]
          .filter((a) => type !== 'byGenre' || a.genre === q.get('genre'))
          .filter((a) => type !== 'starred' || starredAlbums.has(a.id))
          .sort((a, b) =>
            type === 'alphabeticalByName'
              ? a.name.localeCompare(b.name)
              : type === 'recent' || type === 'frequent'
                ? a.id.localeCompare(b.id)
                : b.year - a.year,
          );
        const list = [
          ...sorted.map(albumJson),
          ...Array.from({ length: faults.bigLibrary }, (_, i) => ({
            id: `big-${i}`,
            name: `Big Album ${i}`,
            artist: 'Many Hands',
            artistId: 'ar-1',
            year: 2000,
            coverArt: 'al-1',
            songCount: 1,
          })),
        ];
        return json(ok({ albumList2: { album: list.slice(offset, offset + size) } }));
      }
      case 'getGenres': {
        const names = [...new Set(ALBUMS.map((a) => a.genre))];
        return json(
          ok({
            genres: {
              genre: names.map((value) => ({
                value,
                albumCount: ALBUMS.filter((a) => a.genre === value).length,
                songCount: SONGS.filter((x) => x.genre === value).length,
              })),
            },
          }),
        );
      }
      case 'getArtistInfo2': {
        const a = ARTISTS.find((x) => x.id === id);
        if (!a) return json(fail(70, 'not found'));
        return json(
          ok({
            artistInfo2: {
              biography: `${a.name} make records in a small room by the sea.`,
              similarArtist: ARTISTS.filter((x) => x.id !== id).map((x) => ({
                ...x,
                coverArt: `ar-${x.id}`,
              })),
            },
          }),
        );
      }
      case 'getTopSongs': {
        const name = q.get('artist') ?? '';
        const count = Number(q.get('count') ?? 50);
        return json(
          ok({ topSongs: { song: SONGS.filter((x) => x.artist === name).slice(0, count) } }),
        );
      }
      case 'getSimilarSongs2': {
        const count = Number(q.get('count') ?? 50);
        const s0 = SONGS.find((x) => x.id === id);
        if (!s0) return json(fail(70, 'not found'));
        return json(
          ok({
            similarSongs2: { song: SONGS.filter((x) => x.albumId !== s0.albumId).slice(0, count) },
          }),
        );
      }
      case 'getRandomSongs':
      case 'getSongsByGenre': {
        const genre = q.get('genre');
        const count = Number(q.get('size') ?? q.get('count') ?? 10);
        const list = SONGS.filter((x) => !genre || x.genre === genre).slice(0, count);
        return json(
          ok(
            method === 'getRandomSongs'
              ? { randomSongs: { song: list } }
              : { songsByGenre: { song: list } },
          ),
        );
      }
      case 'createPlaylist': {
        const p = {
          id: `pl-${nextPlaylist++}`,
          name: q.get('name') ?? 'New playlist',
          comment: '',
          songIds: q.getAll('songId'),
        };
        playlists.set(p.id, p);
        return json(ok({ playlist: { ...playlistJson(p), entry: [] } }));
      }
      case 'updatePlaylist': {
        const p = playlists.get(q.get('playlistId') ?? '');
        if (!p) return json(fail(70, 'not found'));
        if (q.has('name')) p.name = q.get('name') ?? p.name;
        if (q.has('comment')) p.comment = q.get('comment') ?? '';
        const drop = new Set(q.getAll('songIndexToRemove').map(Number));
        p.songIds = [...p.songIds.filter((_, i) => !drop.has(i)), ...q.getAll('songIdToAdd')];
        return json(ok());
      }
      case 'deletePlaylist':
        return playlists.delete(id) ? json(ok()) : json(fail(70, 'not found'));
      case 'getAlbum': {
        const a = ALBUMS.find((x) => x.id === id);
        return a
          ? json(ok({ album: { ...albumJson(a), song: songsOf(a) } }))
          : json(fail(70, 'not found'));
      }
      case 'getSong': {
        const s = SONGS.find((x) => x.id === id);
        return s ? json(ok({ song: s })) : json(fail(70, 'not found'));
      }
      case 'getArtists':
        return json(
          ok({
            artists: {
              index: [
                {
                  name: '#',
                  artist: ARTISTS.map((a) => ({
                    ...a,
                    albumCount: ALBUMS.filter((x) => x.artistId === a.id).length,
                  })),
                },
              ],
            },
          }),
        );
      case 'getArtist': {
        const a = ARTISTS.find((x) => x.id === id);
        return a
          ? json(
              ok({
                artist: { ...a, album: ALBUMS.filter((x) => x.artistId === id).map(albumJson) },
              }),
            )
          : json(fail(70, 'not found'));
      }
      case 'getPlaylists':
        return json(ok({ playlists: { playlist: [...playlists.values()].map(playlistJson) } }));
      case 'getPlaylist': {
        const p = playlists.get(id);
        return p
          ? json(
              ok({
                playlist: {
                  ...playlistJson(p),
                  entry: p.songIds.map((x) => SONGS.find((y) => y.id === x)).filter(Boolean),
                },
              }),
            )
          : json(fail(70, 'not found'));
      }
      case 'getStarred2':
        return json(
          ok({
            starred2: {
              song: SONGS.filter((s) => starred.has(s.id)),
              album: ALBUMS.filter((a) => starredAlbums.has(a.id)).map(albumJson),
              artist: ARTISTS.filter((a) => starredArtists.has(a.id)),
            },
          }),
        );
      case 'search3': {
        const term = (q.get('query') ?? '').toLowerCase().replace(/"/g, '');
        const has = (s: string) => s.toLowerCase().includes(term);
        return json(
          ok({
            searchResult3: {
              artist: ARTISTS.filter((a) => has(a.name)),
              album: ALBUMS.filter((a) => has(a.name)).map(albumJson),
              song: SONGS.filter((s) => has(s.title)),
            },
          }),
        );
      }
      case 'getLyricsBySongId': {
        // al-1-t1 has word-timed lyrics (songLyrics v2), al-1-t2 line-timed, the rest none.
        const lines = ['First line here', 'Second line here'];
        if (id === 'al-1-t1')
          return json(
            ok({
              lyricsList: {
                structuredLyrics: [
                  {
                    kind: 'main',
                    lang: 'eng',
                    synced: true,
                    line: lines.map((value, i) => ({ start: 1000 + i * 4000, value })),
                    cueLine: lines.map((value, i) => ({
                      index: i,
                      start: 1000 + i * 4000,
                      end: 4000 + i * 4000,
                      value,
                      cue: value.split(' ').map((w, k, all) => {
                        const byteStart = all.slice(0, k).join(' ').length + (k ? 1 : 0);
                        return {
                          start: 1000 + i * 4000 + k * 900,
                          end: 1800 + i * 4000 + k * 900,
                          value: w,
                          byteStart,
                          byteEnd: byteStart + w.length - 1,
                        };
                      }),
                    })),
                  },
                ],
              },
            }),
          );
        if (id === 'al-1-t2')
          return json(
            ok({
              lyricsList: {
                structuredLyrics: [
                  {
                    synced: true,
                    line: lines.map((value, i) => ({ start: 2000 + i * 3000, value })),
                  },
                ],
              },
            }),
          );
        return json(ok({ lyricsList: { structuredLyrics: [] } }));
      }
      case 'getLyrics':
        return json(
          ok({
            lyrics:
              q.get('title') === 'Copper Rain 1'
                ? { artist: 'Lowfield', title: 'Copper Rain 1', value: 'Plain words\nfrom tags' }
                : {},
          }),
        );
      case 'star':
      case 'unstar': {
        const on = method === 'star';
        for (const [key, set] of [
          ['id', starred],
          ['albumId', starredAlbums],
          ['artistId', starredArtists],
        ] as const)
          for (const x of q.getAll(key)) on ? set.add(x) : set.delete(x);
        return json(ok());
      }
      case 'scrobble':
        scrobbles.push({ id, submission: q.get('submission') !== 'false' });
        return json(ok());
      case 'getCoverArt': {
        // Artist pictures (`ar-…`) and playlist covers (`pl-…`) show their first album's art.
        const ref = id.startsWith('ar-ar-')
          ? ALBUMS.find((x) => `ar-${x.artistId}` === id)?.id
          : id.startsWith('pl-pl-')
            ? SONGS.find((x) => x.id === playlists.get(id.slice(3))?.songIds[0])?.albumId
            : id;
        const a = ALBUMS.find((x) => x.id === ref);
        const png = a ? await fixtureCover(a.cover) : null;
        if (!png) return json(fail(70, 'not found'));
        res.writeHead(200, { 'content-type': state.coverType, 'content-length': png.length });
        return res.end(png);
      }
      case 'stream': {
        const s = SONGS.find((x) => x.id === id);
        if (!s) return json(fail(70, 'not found'));
        if (faults.failStreams > 0) {
          faults.failStreams--;
          res.writeHead(503, { 'content-type': 'text/plain' });
          return res.end('restarting');
        }
        let body = audio.get(id);
        if (!body) {
          body = wav(s.duration, 220 + SONGS.indexOf(s) * 20);
          audio.set(id, body);
        }
        // A live transcode cannot seek (PLAYBACK_ARCHITECTURE.md §5.5).
        const transcode = (q.get('format') ?? 'raw') !== 'raw';
        const range = transcode ? null : /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
        let start = 0;
        let end = body.length - 1;
        if (range) {
          start = Number(range[1]);
          end = range[2] ? Math.min(end, Number(range[2])) : end;
        }
        const part = body.subarray(start, end + 1);
        res.writeHead(range ? 206 : 200, {
          'content-type': 'audio/wav',
          'content-length': part.length,
          'accept-ranges': transcode ? 'none' : 'bytes',
          ...(range && { 'content-range': `bytes ${start}-${end}/${body.length}` }),
        });
        if (faults.breakStreamAt !== null) {
          res.write(part.subarray(0, faults.breakStreamAt));
          return res.destroy();
        }
        return res.end(part);
      }
      default:
        return json(fail(0, `unknown method ${method}`));
    }
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    get coverType() {
      return state.coverType;
    },
    set coverType(v: string) {
      state.coverType = v;
    },
    get hugeJson() {
      return state.hugeJson;
    },
    set hugeJson(v: boolean) {
      state.hugeJson = v;
    },
    url: `http://127.0.0.1:${port}`,
    username,
    password,
    apiKey,
    faults,
    scrobbles,
    starred,
    starredAlbums,
    starredArtists,
    playlists,
    requests,
    songs: SONGS,
    albums: ALBUMS,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export type MockSubsonic = Awaited<ReturnType<typeof startMockSubsonic>>;
