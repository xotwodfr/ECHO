// Records the server's real answers as the Apple apps' test fixtures (Apple/Tests/Fixtures): the
// server's own code (src/server, as its tests wire it) with the mock Navidrome, signed in as a
// native client with a device token. Run from the repository root, then format:
//   node scripts/apple-fixtures.ts && pnpm biome format --write Apple/Tests/Fixtures
// The tests give each answer its HTTP status; the console lists them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSetup } from '../src/server/auth/routes.ts';
import { fromBase32, hotp, STEP_S, stepAt } from '../src/server/auth/totp.ts';
import { createApp } from '../src/server/index.ts';
import { startMockSubsonic } from '../src/server/navidrome/mock.ts';
import { call, testDeps } from '../src/server/testing.ts';

const OUT = process.argv[2] ?? 'Apple/Tests/Fixtures';
const PASSWORD = 'correct horse battery staple';
const DEVICE = 'ECHO for iPhone';
const codeAt = (secret: string, t: number) => hotp(fromBase32(secret), stepAt(t));

mkdirSync(OUT, { recursive: true });
const mock = await startMockSubsonic({});
const t = testDeps();
t.deps.navidrome.defaultUrl = mock.url;
const app = createApp(t.deps);

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

async function save(name: string, res: Response) {
  const body = JSON.parse(await res.text()) as Record<string, unknown>;
  const wait = res.headers.get('retry-after');
  console.log(`${name}: ${res.status}${wait ? ` (Retry-After: ${wait})` : ''}`);
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
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
await save('method-not-allowed', await rest('getUsers'));
mock.faults.down = true;
await save('navidrome-unreachable', await rest('getAlbumList2', 'type=newest&size=500&offset=0'));
mock.faults.down = false;

// The per-user API budget: 50 at once, then 10 a second; the 51st at once is refused.
let limited: Response | undefined;
for (let i = 0; i < 60 && limited?.status !== 429; i++) limited = await bearer('/me');
if (limited) await save('rate-limited', limited);
t.clock.t += 5000;

await save('logout', await bearer('/auth/logout', 'POST', {}));
await save('unauthenticated', await bearer('/me'));
await save(
  'health',
  await app.request('http://localhost/api/v1/health', { headers: { host: 'localhost' } }),
);
await mock.close();
