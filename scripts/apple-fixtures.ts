// Records the server's real answers as the Apple apps' test fixtures (Apple/Tests/Fixtures): the
// server's own code (src/server, as its tests wire it) with the mock Navidrome and the stand-in
// motion service (motion-fake.ts), signed in as a native client with a device token. Run from the repository root, then format:
//   node scripts/apple-fixtures.ts && pnpm biome format --write Apple/Tests/Fixtures
// The tests give each answer its HTTP status; the console lists them. The device token and the
// stream URL's signature are written as fixed stand-ins (secret scanners flag the real, random ones;
// they belong to this throwaway server only).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lyricFixtures } from '../src/client/fixtures/lyrics.ts';
import { startSetup } from '../src/server/auth/routes.ts';
import { fromBase32, hotp, STEP_S, stepAt } from '../src/server/auth/totp.ts';
import { createApp } from '../src/server/index.ts';
import { createKaraoke, stemKey } from '../src/server/karaoke.ts';
import {
  lrclibSource,
  navidromePlainSource,
  navidromeSource,
} from '../src/server/lyrics/sources.ts';
import { createMotion, motionKey } from '../src/server/motion.ts';
import { startFakeMotion } from '../src/server/motion-fake.ts';
import { startMockSubsonic } from '../src/server/navidrome/mock.ts';
import { navidromeClientFor, navidromeUrlOf } from '../src/server/navidrome/routes.ts';
import { call, testDeps } from '../src/server/testing.ts';

const OUT = process.argv[2] ?? 'Apple/Tests/Fixtures';
const LYRICS_OUT = process.argv[3] ?? 'Apple/Shared/Preview/Lyrics';
const PASSWORD = 'correct horse battery staple';
const DEVICE = 'ECHO for iPhone';
const codeAt = (secret: string, t: number) => hotp(fromBase32(secret), stepAt(t));

mkdirSync(OUT, { recursive: true });
mkdirSync(LYRICS_OUT, { recursive: true });
for (const [name, doc] of Object.entries(lyricFixtures))
  writeFileSync(join(LYRICS_OUT, `${name}.json`), `${JSON.stringify(doc)}\n`);
const mock = await startMockSubsonic({});
const t = testDeps();
t.deps.navidrome.defaultUrl = mock.url;
const db = t.deps.auth.db;
// Karaoke with a stem service that is never asked: Home's shelf lists the jobs marked ready below.
const karaoke = createKaraoke({
  db,
  now: t.deps.auth.now,
  stemsUrl: 'http://127.0.0.1:9',
  maxSeconds: 1200,
  library: false,
  scopeFor: (id) => navidromeUrlOf(db, id),
  navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
  libraries: async () => [],
});
// The lyric sources as the server wires them (src/server/index.ts), on the mock Navidrome (word- and
// line-timed lyrics, plain text from the tags) and the mock's LRCLIB.
t.deps.lyrics.scopeFor = (id) => navidromeUrlOf(db, id);
t.deps.lyrics.sourcesFor = (userId) => {
  const client = () => navidromeClientFor(t.deps.navidrome, userId);
  return [
    navidromeSource(client),
    lrclibSource({ baseUrl: mock.url, userAgent: 'ECHO fixtures' }),
    navidromePlainSource(client),
  ];
};
// Animated lock-screen covers with the server's stand-in for the motion service (motion-fake.ts: it
// renders nothing, a cover's "video" is a few bytes behind an MP4 header), as the server's tests wire
// them.
const motionService = await startFakeMotion();
const motion = createMotion({
  db,
  now: t.deps.auth.now,
  motionUrl: motionService.url,
  dir: mkdtempSync(join(tmpdir(), 'echo-motion-fixtures-')),
  cacheBytes: 1e9,
  scopeFor: (id) => navidromeUrlOf(db, id),
  navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
});
const app = createApp({ ...t.deps, karaoke, motion });

// The admin, with two-factor on (the one-time setup).
const setupToken = startSetup(t.deps.auth) as string;
const start = await call(app, 'POST', '/api/v1/setup', {
  token: setupToken,
  username: 'ada',
  password: PASSWORD,
});
const { secret } = (await start.json()) as { secret: string };
await call(app, 'POST', '/api/v1/setup/totp', {
  token: setupToken,
  code: codeAt(secret, t.clock.t),
});
t.clock.t += STEP_S * 1000;

const FAKE_TOKEN = 'echo_dt_test_token_not_a_secret';
/** Random values (a QR request's id, a guest code) and the plain stand-ins written for them. */
const standIns = new Map<string, string>();
/** What goes in a fixture: the answer, its token and signatures replaced by plain stand-ins. */
const scrub = (text: string) => {
  let out = text
    .replace(/echo_dt_[\w-]+/g, FAKE_TOKEN)
    .replace(/([?&]sig=)[\w-]+/g, '$1test_signature_not_a_secret');
  for (const [real, plain] of standIns) out = out.split(real).join(plain);
  return out;
};

async function save(name: string, res: Response) {
  const text = await res.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  const wait = res.headers.get('retry-after');
  console.log(`${name}: ${res.status}${wait ? ` (Retry-After: ${wait})` : ''}`);
  const kept = JSON.parse(scrub(text)) as unknown;
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(kept, null, 2)}\n`);
  return body;
}

const device = (b: object) => call(app, 'POST', '/api/v1/auth/device', b);
const signIn = { username: 'ada', password: PASSWORD, name: DEVICE };
await save('auth-device-totp-required', await device(signIn));
await save('auth-device-bad-code', await device({ ...signIn, code: '000000' }));
await save('auth-device-wrong-password', await device({ ...signIn, password: 'not the password' }));
t.clock.t += STEP_S * 1000;
const created = await save(
  'auth-device-created',
  await device({ ...signIn, code: codeAt(secret, t.clock.t) }),
);
const token = String(created.token);

const bearer = (path: string, method = 'GET', body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      host: 'localhost',
      authorization: `Bearer ${token}`,
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const rest = (method: string, query = '') =>
  bearer(`/navidrome/rest/${method}${query ? `?${query}` : ''}`);

await save('me', await bearer('/me'));
await save('settings', await bearer('/me/settings'));
const changed = { appearance: { theme: 'glass' }, lyrics: { showUnsynced: false } };
await save('settings-saved', await bearer('/me/settings', 'PUT', changed));
await save(
  'settings-refused',
  await bearer('/me/settings', 'PUT', { appearance: { colour: 'red' } }),
);
await save('navidrome-not-connected', await rest('getAlbumList2', 'type=newest&size=500&offset=0'));
await save('stream-url-not-connected', await bearer('/navidrome/stream-url/al-1-t1'));
await save('motion-not-connected', await bearer('/motion/al-1?shape=tall&loop=8'));
await bearer('/me/connections/navidrome', 'PUT', { username: 'ada', password: 'navidrome-pass' });
await save(
  'getAlbumList2',
  await rest('getAlbumList2', 'type=alphabeticalByName&size=500&offset=0'),
);
await save(
  'getAlbumList2-byYear-missing-range',
  await rest('getAlbumList2', 'type=byYear&size=500'),
);
await save('getAlbum', await rest('getAlbum', 'id=al-1'));
await save('getAlbum-not-found', await rest('getAlbum', 'id=nope'));
await save('getArtists', await rest('getArtists'));
await save('getArtist', await rest('getArtist', 'id=ar-1'));
await save('getArtistInfo2', await rest('getArtistInfo2', 'id=ar-1&count=12'));
await save('getTopSongs', await rest('getTopSongs', 'artist=Lowfield&count=10'));
await save('getPlaylists', await rest('getPlaylists'));
await save('getPlaylist', await rest('getPlaylist', 'id=pl-1'));
await save('getStarred2', await rest('getStarred2'));
await save(
  'search3',
  await rest('search3', 'query=harbour&artistCount=6&albumCount=6&songCount=6'),
);
await save('getSong', await rest('getSong', 'id=al-1-t1'));
await save('getGenres', await rest('getGenres'));
await save('star', await bearer('/navidrome/rest/star?id=al-1-t1', 'POST', {}));
await save('stream-url', await bearer('/navidrome/stream-url/al-1-t1'));

// Made For You: a few plays of Lowfield and Mira Sole, then the mixes made from them.
t.clock.t += 10_000;
const songOf = (album: string, n: number, title: string, artist: string, artistId: string) => ({
  key: `navidrome:${album}-t${n}`,
  provider: 'navidrome',
  id: `${album}-t${n}`,
  title: `${title} ${n}`,
  artists: [{ id: artistId, name: artist }],
  album: { id: album, title, key: `navidrome:${album}` },
  durationMs: (15 + n * 5) * 1000,
  artwork: [{ url: `/api/v1/navidrome/cover/${album}?size=600` }],
});
const played = [
  songOf('al-1', 1, 'Harbour Lights', 'Lowfield', 'ar-1'),
  songOf('al-1', 2, 'Harbour Lights', 'Lowfield', 'ar-1'),
  songOf('al-3', 1, 'Glass Weather', 'Mira Sole', 'ar-2'),
];
for (let i = 0; i < 6; i++) {
  t.clock.t += 3 * 60_000;
  await bearer('/me/plays', 'POST', {
    track: played[i % played.length],
    context: { kind: 'album', id: 'al-1', title: 'Harbour Lights' },
  });
}
await save('me-mixes', await bearer('/me/mixes?tz=-60'));

// The Wanted list: found in the library, still missing, the same words again, removed.
const added = await save(
  'wanted-added',
  await bearer('/wanted', 'POST', { text: 'Lowfield Harbour Lights' }),
);
await save(
  'wanted-added-missing',
  await bearer('/wanted', 'POST', { text: 'The Quiet Hours – Paper Satellites' }),
);
await save('wanted-known', await bearer('/wanted', 'POST', { text: 'lowfield, harbour lights!' }));
await save('wanted-bad', await bearer('/wanted', 'POST', { text: '!!!' }));
await save('wanted', await bearer('/wanted'));
await save('wanted-removed', await bearer(`/wanted/${added.id}`, 'DELETE'));
await save('wanted-not-found', await bearer(`/wanted/${added.id}`, 'DELETE'));

// Home's Karaoke shelf: two songs whose karaoke versions are ready, newest first.
const scope = navidromeUrlOf(db, 1);
for (const [i, id] of ['al-3-t2', 'al-1-t3'].entries()) {
  db.prepare(
    `INSERT INTO stems_jobs (key, scope, track_id, user_id, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'ready', 0, ?, ?)`,
  ).run(stemKey(scope, id), scope, id, t.clock.t + i, t.clock.t + i);
}
await save('karaoke-ready', await bearer('/karaoke/ready?limit=30'));

// A song's karaoke version in each state (docs/KARAOKE.md): the jobs are written as the stem service
// would leave them (the queue is never worked here: queued ones wait far in the future), then asked
// for the way the apps ask, now or `?soon=1`. No stem service at all answers "off".
const farFuture = t.clock.t + 1e12;
const stemJob = (id: string, status: string, priority: number, at: number, nextAt = 0) =>
  db
    .prepare(
      `INSERT INTO stems_jobs (key, scope, track_id, user_id, status, priority, attempts, next_at, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?, ?)`,
    )
    .run(stemKey(scope, id), scope, id, status, priority, nextAt, t.clock.t + at, t.clock.t + at);
stemJob('al-1-t1', 'working', 10, 10);
stemJob('al-1-t2', 'queued', 0, 11, farFuture);
stemJob('al-2-t1', 'failed', 0, 12);
stemJob('al-2-t2', 'skipped', 0, 13);
await save('karaoke-working', await bearer('/karaoke/al-1-t1'));
await save('karaoke-queued', await bearer('/karaoke/al-1-t2?soon=1'));
await save('karaoke-song-ready', await bearer('/karaoke/al-1-t3'));
await save('karaoke-failed', await bearer('/karaoke/al-2-t1'));
await save('karaoke-skipped', await bearer('/karaoke/al-2-t2'));
await save('karaoke-bad-track', await bearer('/karaoke/not%20an%20id'));
const withoutStems = createApp({ ...t.deps, motion });
await save(
  'karaoke-off',
  await withoutStems.request('http://localhost/api/v1/karaoke/al-1-t3', {
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
  }),
);
await save(
  'karaoke-progress-off',
  await withoutStems.request('http://localhost/api/v1/karaoke', {
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
  }),
);
await save('karaoke-progress-offline', await bearer('/karaoke'));
// The stem service answering: only its disk count is asked (/stats).
const stats = createServer((req, res) => {
  res.writeHead(req.url === '/stats' ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ songs: 2, bytes: 13_400_000, working: null }));
});
await new Promise<void>((r) => stats.listen(0, '127.0.0.1', r));
const karaokeOnline = createKaraoke({
  db,
  now: t.deps.auth.now,
  stemsUrl: `http://127.0.0.1:${(stats.address() as AddressInfo).port}`,
  maxSeconds: 1200,
  library: false,
  scopeFor: (id) => navidromeUrlOf(db, id),
  navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
  libraries: async () => [],
});
const withStems = createApp({ ...t.deps, karaoke: karaokeOnline, motion });
await save(
  'karaoke-progress',
  await withStems.request('http://localhost/api/v1/karaoke', {
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
  }),
);
karaokeOnline.stop();
stats.close();
await save('method-not-allowed', await rest('getUsers'));
mock.faults.down = true;
await save('navidrome-unreachable', await rest('getAlbumList2', 'type=newest&size=500&offset=0'));
mock.faults.down = false;

// The per-user API budget: 50 at once, then 10 a second; the 51st at once is refused.
let limited: Response | undefined;
for (let i = 0; i < 60 && limited?.status !== 429; i++) limited = await bearer('/me');
if (limited) await save('rate-limited', limited);
t.clock.t += 5000;

// The queue that follows the user (src/client/playback/queueSync.ts): none saved yet; one saved as
// the web saves it (shuffle on, a fraction of a millisecond in its position) and read back; a newer
// one from another device, as Android saves it (no Next up when empty, no provider on its songs);
// a save from a device that had not seen that one (refused, with the newer queue); not a queue.
const harbour = (n: number) => songOf('al-1', n, 'Harbour Lights', 'Lowfield', 'ar-1');
const webQueue = {
  provider: 'navidrome',
  now: {
    ...harbour(2),
    contentType: 'audio/flac',
    suffix: 'flac',
    replayGain: { trackGain: -6.5, albumGain: -7.25, trackPeak: 0.98, albumPeak: 1 },
  },
  nextUp: [songOf('al-3', 1, 'Glass Weather', 'Mira Sole', 'ar-2')],
  context: [harbour(3), harbour(4)],
  contextSource: { kind: 'album', id: 'al-1', title: 'Harbour Lights' },
  history: [harbour(1)],
  shuffleOrder: [1, 0],
};
const { provider: _, ...androidSong } = songOf('al-3', 2, 'Glass Weather', 'Mira Sole', 'ar-2');
const androidQueue = {
  provider: 'navidrome',
  now: androidSong,
  context: [harbour(3)],
  contextSource: { kind: 'playlist', id: 'pl-1', title: 'Late Ferries' },
  history: [],
};
await save('me-queue-empty', await bearer('/me/queue'));
const first = await save(
  'me-queue-saved',
  await bearer('/me/queue', 'PUT', { queue: webQueue, positionMs: 12345.678, baseUpdatedAt: 0 }),
);
await save('me-queue', await bearer('/me/queue'));
await bearer('/me/queue', 'PUT', {
  queue: androidQueue,
  positionMs: 12000,
  baseUpdatedAt: first.updatedAt,
});
await save(
  'me-queue-conflict',
  await bearer('/me/queue', 'PUT', {
    queue: webQueue,
    positionMs: 0,
    baseUpdatedAt: first.updatedAt,
  }),
);
await save('me-queue-newer', await bearer('/me/queue'));
await save('me-queue-bad', await bearer('/me/queue', 'PUT', { queue: [], baseUpdatedAt: 0 }));

// Navidrome's scrobble (now playing), and a play for ECHO's history.
await save(
  'scrobble',
  await bearer('/navidrome/rest/scrobble?id=al-1-t1&submission=false', 'POST', {}),
);
await save(
  'me-plays',
  await bearer('/me/plays', 'POST', {
    track: harbour(1),
    context: { kind: 'album', id: 'al-1', title: 'Harbour Lights' },
  }),
);

// Lyrics: word-timed (the library's), line-timed (LRCLIB), plain text from the tags, none; the
// user's offset and source pin for a track, and one out of range.
const lyricsOf = (id: string, title: string, artist: string, album: string) =>
  bearer(
    `/lyrics?${new URLSearchParams({ trackKey: `navidrome:${id}`, title, artist, album, durationMs: '20000' })}`,
  );
await save(
  'lyrics-word',
  await lyricsOf('al-1-t1', 'Harbour Lights 1', 'Lowfield', 'Harbour Lights'),
);
await save(
  'lyrics-line',
  await lyricsOf('al-3-t1', 'Glass Weather 1', 'Mira Sole', 'Glass Weather'),
);
await save('lyrics-plain', await lyricsOf('al-2-t1', 'Copper Rain 1', 'Lowfield', 'Copper Rain'));
await save(
  'lyrics-not-found',
  await lyricsOf('al-4-t1', 'Long Exposure 1', 'Field Ensemble', 'Long Exposure'),
);
const override = (body: object) => bearer('/me/tracks/navidrome%3Aal-1-t1/override', 'PUT', body);
await save('lyrics-override-offset', await override({ offsetMs: 150 }));
await save(
  'lyrics-word-override',
  await lyricsOf('al-1-t1', 'Harbour Lights 1', 'Lowfield', 'Harbour Lights'),
);
await save('lyrics-override-pin', await override({ pinnedSource: 'lrclib' }));
await save('lyrics-override-unpin', await override({ pinnedSource: null }));
await save('lyrics-override-bad', await override({ offsetMs: 20_000 }));

// Animated lock-screen covers (docs/MOTION.md): the loop lengths the apps may ask for; an album's first
// ask queues its cover (202 with Retry-After while it is made, the next album's behind it), then it is
// ready, tall and square, with its video's and still's paths; another loop length is another cover
// (its video 202 while it is made); a length not offered; an admin's upload takes the album's place
// at any length; a cover the service cannot make; too many waiting; no motion service at all.
t.clock.t += 10_000; // the API budget fills again
const motionOf = (album: string, shape = 'tall', loop = 8) =>
  bearer(`/motion/${album}?shape=${shape}&loop=${loop}`);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!ok()) throw new Error('motion: the stand-in service did not finish');
};
const job = (album: string, variant: string) => motion.get(motionKey(scope, album, variant));
let release = () => {};
const hold = () => {
  motionService.state.hold = new Promise<void>((r) => {
    release = () => {
      motionService.state.hold = null;
      r();
    };
  });
};
await save('motion-status', await bearer('/motion'));
hold();
await save('motion-working', await motionOf('al-1'));
await save('motion-queued', await motionOf('al-2'));
release();
await until(() => job('al-1', 'g8')?.status === 'ready' && job('al-2', 'g8')?.status === 'ready');
await save('motion-ready', await motionOf('al-1'));
await save('motion-ready-square', await motionOf('al-1', 'square'));
hold();
await save('motion-loop-12', await motionOf('al-1', 'tall', 12));
await save('motion-video-pending', await bearer('/motion/al-1/video?shape=tall&loop=12'));
release();
await until(() => job('al-1', 'g12')?.status === 'ready');
await save('motion-ready-loop-12', await motionOf('al-1', 'tall', 12));
await save('motion-bad-loop', await motionOf('al-1', 'tall', 10));
motionService.state.refuse.add(motionKey(scope, 'al-3', 'g8'));
await motionOf('al-3');
await until(() => job('al-3', 'g8')?.status === 'failed');
await save('motion-failed', await motionOf('al-3'));
const video = Buffer.concat([
  Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0isommp42'),
  Buffer.alloc(200, 7),
]);
await save(
  'motion-upload',
  await app.request('http://localhost/api/v1/motion/al-1/upload', {
    method: 'PUT',
    headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'video/mp4' },
    body: video,
  }),
);
await until(() => motion.uploadJob(scope, 'al-1')?.status === 'ready');
await save('motion-ready-upload', await motionOf('al-1'));
await save('motion-ready-upload-loop-12', await motionOf('al-1', 'tall', 12));
t.clock.t += 10_000;
hold();
let busy: Response | undefined;
for (let i = 1; i <= 30 && busy?.status !== 429; i++) busy = await motionOf(`busy-${i}`);
if (busy) await save('motion-busy', busy);
release();
const noMotion = createApp({ ...t.deps, karaoke });
await save(
  'motion-off',
  await noMotion.request('http://localhost/api/v1/motion/al-1?shape=tall&loop=8', {
    headers: { host: 'localhost', authorization: `Bearer ${token}` },
  }),
);

// Sign in a computer by scanning its QR code (src/server/qrlogin.ts): the web sign-in page asks
// (as Chrome on Windows), the phone peeks and approves, then the same request again is used up; an
// id that never was. Guest passes (src/server/guests.ts): a code for a day, a length not offered,
// a peek and a redeem (no sign-in: the code is the secret) giving a guest's device token, the code
// used up, the guest's own state, what a guest may not do, the inviter's list, ending a guest, and
// six live codes at once. The random request ids and codes are written as plain stand-ins.
t.clock.t += 120_000; // the sign-in limits start afresh
const browser = (path: string, body: unknown) =>
  app.request(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });
const qr = (await (await browser('/auth/qr', {})).json()) as { id: string; poll: string };
standIns.set(qr.id, 'qr-request-for-tests-0001');
standIns.set(qr.poll, 'qr-poll-for-tests-not-a-secret');
await save('qr-peek', await bearer('/auth/qr/peek', 'POST', { id: qr.id }));
await save('qr-approve', await bearer('/auth/qr/approve', 'POST', { id: qr.id }));
await save('qr-peek-used', await bearer('/auth/qr/peek', 'POST', { id: qr.id }));
await save('qr-approve-used', await bearer('/auth/qr/approve', 'POST', { id: qr.id }));
await save(
  'qr-peek-expired',
  await bearer('/auth/qr/peek', 'POST', { id: 'qr-request-never-made-01' }),
);
await save('guest-code-bad-duration', await bearer('/guests/codes', 'POST', { durationMs: 5 }));
const pass = await save(
  'guest-code',
  await bearer('/guests/codes', 'POST', { durationMs: 86_400_000 }),
);
const guestCode = String(pass.code);
standIns.set(guestCode, 'guest-code-for-tests-0001');
// Saved again now the stand-in is known.
writeFileSync(
  join(OUT, 'guest-code.json'),
  `${JSON.stringify(JSON.parse(scrub(JSON.stringify(pass))), null, 2)}\n`,
);
const anyone = (path: string, body: unknown) => call(app, 'POST', `/api/v1${path}`, body);
await save('guest-peek', await anyone('/guests/peek', { code: guestCode }));
await save('guest-peek-bad', await anyone('/guests/peek', { code: 'guest-code-never-made-01' }));
const joined = await save(
  'guest-redeem',
  await anyone('/guests/redeem', { code: guestCode, name: 'ECHO guest (iPhone)' }),
);
await save('guest-redeem-used', await anyone('/guests/redeem', { code: guestCode }));
const guestToken = String(joined.token);
const asGuest = (path: string, method = 'GET', body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      host: 'localhost',
      authorization: `Bearer ${guestToken}`,
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
await save('guests-me-guest', await asGuest('/guests/me'));
await save('guests-me-none', await bearer('/guests/me'));
await save('me-guest', await asGuest('/me'));
// A guest listens to Karaoke versions too: asking for one is a read.
await save('karaoke-guest', await asGuest('/karaoke/al-1-t3'));
await save('guest-denied-star', await asGuest('/navidrome/rest/star?id=al-1-t1', 'POST', {}));
await save('guest-denied-qr', await asGuest('/auth/qr/peek', 'POST', { id: qr.id }));
await save('guest-denied-codes', await asGuest('/guests/codes', 'POST', { durationMs: 3_600_000 }));
const listed = (await save('guests', await bearer('/guests'))) as unknown as { id: number }[];
await save('guest-end', await bearer(`/guests/${listed[0]?.id}/end`, 'POST', {}));
await save('guest-end-not-found', await bearer(`/guests/${listed[0]?.id}/end`, 'POST', {}));
await save('guests-empty', await bearer('/guests'));
// Listen together (src/server/together.ts): ada hosts a session on a song with two more queued, a
// guest (who copies ada's library, so may join) looks at it, joins, adds and removes songs, is
// refused the host's controls, and the host plays, pauses, seeks, skips, goes back and jumps; then
// the event stream (state, a change, end) and leaving, ending and a session that is gone. The random
// session id and queue ids are written as plain stand-ins (the order they first appear in).
const memberCode = (await (
  await bearer('/guests/codes', 'POST', { durationMs: 3_600_000 })
).json()) as {
  code: string;
};
const memberJoin = await save(
  'together-guest-redeem',
  await anyone('/guests/redeem', { code: memberCode.code, name: 'ECHO guest (iPhone)' }),
);
standIns.set(String(memberJoin.username), 'sam');
const memberToken = String(memberJoin.token);
const asMember = (path: string, method = 'GET', body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      host: 'localhost',
      authorization: `Bearer ${memberToken}`,
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const ref = (album: string, n: number, title: string, artist: string, artistId: string) => ({
  id: `${album}-t${n}`,
  title: `${title} ${n}`,
  artist,
  artistId,
  album: title,
  albumId: album,
  durationMs: 200_000,
  cover: `/api/v1/navidrome/cover/${album}?size=600`,
});
let itemNo = 0;
/** Saves a Listen together answer, its session id and queue ids as stand-ins. */
async function saveT(name: string, res: Response) {
  const text = await res.clone().text();
  const doc = text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {};
  const found = (doc.session ?? doc) as {
    id?: unknown;
    now?: { uid: string } | null;
    queue?: { uid: string }[];
  };
  if (typeof found.id === 'string' && found.id.length > 20 && !standIns.has(found.id))
    standIns.set(found.id, 'together-session-for-tests-0001');
  for (const it of [found.now, ...(found.queue ?? [])])
    if (it && !standIns.has(it.uid)) standIns.set(it.uid, `together-item-${++itemNo}`);
  return save(name, res);
}
await saveT('together-none', await bearer('/together'));
await saveT('together-bad-track', await bearer('/together', 'POST', { track: { id: 7 } }));
const started = (await saveT(
  'together-started',
  await bearer('/together', 'POST', {
    track: ref('al-1', 1, 'Harbour Lights', 'Lowfield', 'ar-1'),
    positionMs: 12_000,
    playing: true,
    queue: [
      ref('al-1', 2, 'Harbour Lights', 'Lowfield', 'ar-1'),
      ref('al-3', 1, 'Glass Weather', 'Mira Sole', 'ar-2'),
    ],
  }),
)) as unknown as { id: string; queue: { uid: string }[] };
const tid = started.id;
await saveT('together-current', await bearer('/together'));
await saveT('together-not-found', await bearer('/together/never-made-session-id-000001'));
await saveT('together-peek', await asMember(`/together/${tid}`));
await saveT(
  'together-queue-not-member',
  await asMember(`/together/${tid}/queue`, 'POST', {
    track: ref('al-2', 1, 'Paper Satellites', 'The Quiet Hours', 'ar-3'),
  }),
);
t.clock.t += 5_000;
await saveT('together-join', await asMember(`/together/${tid}/join`, 'POST', {}));
await saveT('together-state-member', await asMember(`/together/${tid}`));
const addedBy = (await saveT(
  'together-queue-added',
  await asMember(`/together/${tid}/queue`, 'POST', {
    track: ref('al-2', 1, 'Paper Satellites', 'The Quiet Hours', 'ar-3'),
  }),
)) as unknown as { queue: { uid: string }[] };
await saveT('together-queue-bad', await asMember(`/together/${tid}/queue`, 'POST', { track: {} }));
await saveT(
  'together-queue-next',
  await bearer(`/together/${tid}/queue`, 'POST', {
    track: ref('al-3', 2, 'Glass Weather', 'Mira Sole', 'ar-2'),
    next: true,
  }),
);
const hostItem = started.queue[0]?.uid ?? '';
await saveT(
  'together-remove-denied',
  await asMember(`/together/${tid}/queue/${hostItem}`, 'DELETE'),
);
await saveT(
  'together-remove-not-found',
  await asMember(`/together/${tid}/queue/never-queued-0001`, 'DELETE'),
);
const mine = addedBy.queue.at(-1)?.uid ?? '';
await saveT('together-remove', await asMember(`/together/${tid}/queue/${mine}`, 'DELETE'));
const ctl = (body: unknown) => bearer(`/together/${tid}/control`, 'POST', body);
await saveT(
  'together-control-denied',
  await asMember(`/together/${tid}/control`, 'POST', { action: 'pause' }),
);
t.clock.t += 8_000;
await saveT('together-pause', await ctl({ action: 'pause' }));
t.clock.t += 2_000;
await saveT('together-play', await ctl({ action: 'play' }));
t.clock.t += 1_000;
await saveT('together-seek', await ctl({ action: 'seek', positionMs: 90_000 }));
await saveT('together-seek-bad', await ctl({ action: 'seek', positionMs: 'soon' }));
await saveT('together-bad-action', await ctl({ action: 'rewind' }));
const upNext = (await (await bearer(`/together/${tid}`)).json()) as {
  now: { uid: string };
  queue: { uid: string }[];
};
await saveT('together-next-stale', await ctl({ action: 'next', from: 'not-the-song-playing' }));
t.clock.t += 1_000;
await saveT('together-next', await ctl({ action: 'next', from: upNext.now.uid }));
t.clock.t += 6_000;
await saveT('together-previous', await ctl({ action: 'previous' }));
const jumpTo = upNext.queue.at(-1)?.uid ?? '';
await saveT('together-jump', await ctl({ action: 'jump', uid: jumpTo }));
await saveT('together-jump-not-found', await ctl({ action: 'jump', uid: 'never-queued-0001' }));
// The event stream: the state it opens with, the next one after a change, the end.
{
  const open = await asMember(`/together/${tid}/events`);
  console.log(`together-events: ${open.status}`);
  const reader = open.body?.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const next = async () => {
    const r = await Promise.race([
      reader?.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ]);
    if (r && !r.done) chunks.push(decoder.decode(r.value));
  };
  await next();
  await ctl({ action: 'pause' });
  await next();
  await bearer(`/together/${tid}/leave`, 'POST', {});
  await next();
  await reader?.cancel().catch(() => {});
  writeFileSync(
    join(OUT, 'together-events.json'),
    `${JSON.stringify({ chunks: chunks.map(scrub) }, null, 2)}\n`,
  );
}
await saveT('together-leave-gone', await asMember(`/together/${tid}/leave`, 'POST', {}));
await saveT('together-ended', await bearer(`/together/${tid}`));
// A session to leave (a member) and one to end (the host leaving ends it for everyone).
const second = (await saveT(
  'together-started-empty',
  await bearer('/together', 'POST', {}),
)) as unknown as { id: string };
await saveT('together-join-empty', await asMember(`/together/${second.id}/join`, 'POST', {}));
await saveT('together-leave', await asMember(`/together/${second.id}/leave`, 'POST', {}));
await saveT('together-end', await bearer(`/together/${second.id}/leave`, 'POST', {}));

let tooMany: Response | undefined;
for (let i = 0; i < 6 && tooMany?.status !== 429; i++)
  tooMany = await bearer('/guests/codes', 'POST', { durationMs: 3_600_000 });
if (tooMany) await save('guest-code-too-many', tooMany);
t.clock.t += 61_000;
let peekLimited: Response | undefined;
for (let i = 0; i < 20 && peekLimited?.status !== 429; i++)
  peekLimited = await anyone('/guests/peek', { code: 'guest-code-never-made-01' });
if (peekLimited) await save('guest-peek-rate-limited', peekLimited);

await save('logout', await bearer('/auth/logout', 'POST', {}));
await save('unauthenticated', await bearer('/me'));
await save(
  'health',
  await app.request('http://localhost/api/v1/health', { headers: { host: 'localhost' } }),
);
motion.stop();
karaoke.stop();
motionService.close();
await mock.close();
