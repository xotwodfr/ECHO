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
}

export interface Faults {
  down: boolean; // connections are dropped
  slowMs: number; // every response waits
  unauthorized: boolean; // HTTP 401 for everything
  breakStreamAt: number | null; // a stream body stops after this many bytes
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
  },
  { id: 'al-2', name: 'Copper Rain', artistId: 'ar-1', year: 2015, cover: 'fire', tracks: 3 },
  {
    id: 'al-3',
    name: 'Glass Weather',
    artistId: 'ar-2',
    year: 2023,
    cover: 'neon-magenta',
    tracks: 5,
  },
  {
    id: 'al-4',
    name: 'Long Exposure',
    artistId: 'ar-3',
    year: 2017,
    cover: 'grey-gradient',
    tracks: 3,
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
});

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
  const faults: Faults = { down: false, slowMs: 0, unauthorized: false, breakStreamAt: null };
  const starred = new Set<string>(['al-1-t2']);
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
    if (faults.down) return req.socket.destroy();
    if (faults.slowMs) await new Promise((r) => setTimeout(r, faults.slowMs));
    const url = new URL(req.url ?? '/', 'http://mock');
    const q = url.searchParams;
    requests.push(q);
    const method = url.pathname.replace(/^\/rest\//, '').replace(/\.view$/, '');
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
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
        const size = Math.min(500, Number(q.get('size') ?? 10));
        const offset = Number(q.get('offset') ?? 0);
        const sorted = [...ALBUMS].sort((a, b) =>
          q.get('type') === 'alphabeticalByName' ? a.name.localeCompare(b.name) : b.year - a.year,
        );
        return json(
          ok({ albumList2: { album: sorted.slice(offset, offset + size).map(albumJson) } }),
        );
      }
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
        return json(
          ok({ playlists: { playlist: [{ id: 'pl-1', name: 'Evening', songCount: 3 }] } }),
        );
      case 'getPlaylist':
        return id === 'pl-1'
          ? json(ok({ playlist: { id: 'pl-1', name: 'Evening', entry: SONGS.slice(0, 3) } }))
          : json(fail(70, 'not found'));
      case 'getStarred2':
        return json(ok({ starred2: { song: SONGS.filter((s) => starred.has(s.id)) } }));
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
      case 'star':
        starred.add(id);
        return json(ok());
      case 'unstar':
        starred.delete(id);
        return json(ok());
      case 'scrobble':
        scrobbles.push({ id, submission: q.get('submission') !== 'false' });
        return json(ok());
      case 'getCoverArt': {
        const a = ALBUMS.find((x) => x.id === id);
        const png = a ? await fixtureCover(a.cover) : null;
        if (!png) return json(fail(70, 'not found'));
        res.writeHead(200, { 'content-type': state.coverType, 'content-length': png.length });
        return res.end(png);
      }
      case 'stream': {
        const s = SONGS.find((x) => x.id === id);
        if (!s) return json(fail(70, 'not found'));
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

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
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
