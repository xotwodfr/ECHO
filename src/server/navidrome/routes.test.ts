import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { createApp } from '../index.ts';
import { createPaletteService } from '../palette/service.ts';
import { call, testDeps } from '../testing.ts';
import { type MockSubsonic, startMockSubsonic } from './mock.ts';
import { navidromeCovers } from './routes.ts';

// PLAYBACK_ARCHITECTURE.md §5 and SETTINGS_AND_SECURITY.md §6.1 against the mock Subsonic server.

let mock: MockSubsonic;
beforeEach(async () => {
  mock = await startMockSubsonic({ apiKey: 'nd-api-key' });
});
afterEach(() => mock.close());

function setup(over: { defaultUrl?: string | null } = {}) {
  const t = testDeps();
  t.deps.navidrome.defaultUrl = over.defaultUrl === undefined ? mock.url : over.defaultUrl;
  const app = createApp(t.deps);
  const db = t.deps.auth.db;
  const userCookie = (name: string) => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
        )
        .run(name).lastInsertRowid,
    );
    return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
  };
  const ada = userCookie('ada');
  const connect = (body: Record<string, string>, cookie = ada.cookie) =>
    call(app, 'PUT', '/api/v1/me/connections/navidrome', body, cookie);
  const get = (path: string, cookie = ada.cookie, headers: Record<string, string> = {}) =>
    app.request(`http://localhost${path}`, { headers: { host: 'localhost', cookie, ...headers } });
  return { ...t, app, db, ada, userCookie, connect, get };
}

const PASS = { username: 'ada', password: 'navidrome-pass' };

describe('connecting (§6.1, §5.3)', () => {
  it('tests, then stores the secret sealed; it is never returned', async () => {
    const s = setup();
    const res = await s.connect(PASS);
    expect(res.status).toBe(200);
    const { serverInfo } = (await res.json()) as { serverInfo: Record<string, unknown> };
    expect(serverInfo).toMatchObject({
      type: 'navidrome',
      serverVersion: '0.64.2',
      tracks: mock.songs.length,
    });
    expect(serverInfo.extensions).toEqual(
      expect.arrayContaining(['songLyrics', 'transcodeOffset', 'apiKeyAuthentication']),
    );
    const row = s.db.prepare('SELECT config_json, secret_enc FROM connections').get() as {
      config_json: string;
      secret_enc: string;
    };
    expect(row.secret_enc).toMatch(/^v1:/);
    expect(row.config_json + row.secret_enc).not.toContain(PASS.password);
    const shown = await (await s.get('/api/v1/me/connections/navidrome')).json();
    expect(shown).toMatchObject({
      connected: true,
      username: 'ada',
      auth: 'password',
      secretSaved: true,
    });
    expect(JSON.stringify(shown)).not.toContain(PASS.password);
  });

  it('rejected credentials, a dead server or a wrong path store nothing and say why', async () => {
    const s = setup();
    const bad = await s.connect({ username: 'ada', password: 'wrong' });
    expect(await bad.json()).toMatchObject({ code: 'navidrome.auth' });
    const path = await s.connect({ ...PASS, url: `${mock.url}/nothing` });
    expect(path.status).toBe(400); // not the default URL, and http: refused before any request
    mock.faults.down = true;
    expect(await (await s.connect(PASS)).json()).toMatchObject({ code: 'navidrome.unreachable' });
    mock.faults.down = false;
    mock.faults.unauthorized = true;
    expect(await (await s.connect(PASS)).json()).toMatchObject({ code: 'navidrome.auth' });
    expect(s.db.prepare('SELECT count(*) FROM connections').pluck().get()).toBe(0);
    expect(
      s.db
        .prepare("SELECT count(*) FROM audit_log WHERE event = 'navidrome.connect_failed'")
        .pluck()
        .get(),
    ).toBe(4); // every failed attempt, the refused URL included
  });

  it('a URL other than the default must be https and public', async () => {
    const s = setup({ defaultUrl: 'http://navidrome:4533' });
    expect(await (await s.connect({ ...PASS, url: mock.url })).json()).toMatchObject({
      code: 'navidrome.url.https_required',
    });
    expect(
      await (await s.connect({ ...PASS, url: 'https://127.0.0.1:4533' })).json(),
    ).toMatchObject({
      code: 'navidrome.url.private_address',
    });
  });

  it('an API key is used alone, never with a username or token', async () => {
    const s = setup();
    expect((await s.connect({ apiKey: 'nd-api-key' })).status).toBe(200);
    mock.requests.length = 0;
    await s.get('/api/v1/navidrome/rest/ping');
    const q = mock.requests[0] as URLSearchParams;
    expect(q.get('apiKey')).toBe('nd-api-key');
    expect(['u', 't', 's', 'p'].some((k) => q.has(k))).toBe(false);
  });

  it('every request carries a fresh salt', async () => {
    const s = setup();
    await s.connect(PASS);
    mock.requests.length = 0;
    await s.get('/api/v1/navidrome/rest/ping');
    await s.get('/api/v1/navidrome/rest/ping');
    const [a, b] = mock.requests.map((q) => q.get('s'));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(mock.requests.every((q) => !q.has('p'))).toBe(true); // the password itself never travels
  });

  it('disconnecting removes the connection', async () => {
    const s = setup();
    await s.connect(PASS);
    expect(
      (await call(s.app, 'DELETE', '/api/v1/me/connections/navidrome', undefined, s.ada.cookie))
        .status,
    ).toBe(200);
    expect((await s.get('/api/v1/navidrome/rest/ping')).status).toBe(409);
  });

  // §10: disconnecting "clears their Navidrome queue". Kept, it came back on the reload that
  // follows, every song failing with navidrome.not_connected. The YouTube slot is not Navidrome's.
  it('disconnecting clears the saved Navidrome queue, and only that one', async () => {
    const s = setup();
    await s.connect(PASS);
    for (const slot of ['/api/v1/me/queue', '/api/v1/me/queue/youtube'])
      expect(
        (await call(s.app, 'PUT', slot, { queue: { now: null }, baseUpdatedAt: 0 }, s.ada.cookie))
          .status,
      ).toBe(200);
    await call(s.app, 'DELETE', '/api/v1/me/connections/navidrome', undefined, s.ada.cookie);
    const saved = async (slot: string) =>
      (
        (await (await call(s.app, 'GET', slot, undefined, s.ada.cookie)).json()) as {
          queue: unknown;
        }
      ).queue;
    expect(await saved('/api/v1/me/queue')).toBeNull();
    expect(await saved('/api/v1/me/queue/youtube')).toEqual({ now: null });
  });
});

describe('the proxy (§5.2)', () => {
  it('forwards allow-listed methods with the user’s signature; caller auth params are ignored', async () => {
    const s = setup();
    await s.connect(PASS);
    const res = await s.get(
      '/api/v1/navidrome/rest/getAlbumList2?type=newest&size=2&u=evil&t=x&s=y&apiKey=z',
    );
    const body = (await res.json()) as {
      'subsonic-response': { albumList2: { album: unknown[] } };
    };
    expect(body['subsonic-response'].albumList2.album).toHaveLength(2);
    const q = mock.requests.at(-1) as URLSearchParams;
    expect(q.get('u')).toBe('ada');
    expect(q.has('apiKey')).toBe(false);
  });

  it('anything else is 403, and state-changing methods only as POST (Origin-checked)', async () => {
    const s = setup();
    await s.connect(PASS);
    for (const m of [
      'deleteUser',
      'createPlaylist',
      'deletePlaylist',
      'updateUser',
      'star',
      'scrobble',
    ])
      expect((await s.get(`/api/v1/navidrome/rest/${m}?id=al-1-t1`)).status, m).toBe(403);
    expect(
      (await call(s.app, 'POST', '/api/v1/navidrome/rest/star?id=al-1-t1', {}, s.ada.cookie))
        .status,
    ).toBe(200);
    expect(mock.starred.has('al-1-t1')).toBe(true);
    expect(
      (await call(s.app, 'POST', '/api/v1/navidrome/rest/getAlbum?id=al-1', {}, s.ada.cookie))
        .status,
    ).toBe(403);
  });

  it('isolation: without your own connection there is nothing to proxy', async () => {
    const s = setup();
    await s.connect(PASS);
    const bo = s.userCookie('bo');
    expect((await s.get('/api/v1/navidrome/rest/ping', bo.cookie)).status).toBe(409);
    expect((await s.get('/api/v1/navidrome/stream/al-1-t1', bo.cookie)).status).toBe(409);
    expect((await s.get('/api/v1/navidrome/rest/ping', '')).status).toBe(401);
  });

  it('Subsonic errors come back as Subsonic errors', async () => {
    const s = setup();
    await s.connect(PASS);
    const body = await (await s.get('/api/v1/navidrome/rest/getAlbum?id=nope')).json();
    expect(body).toEqual({
      'subsonic-response': { status: 'failed', error: { code: 70, message: 'not found' } },
    });
  });
});

describe('streams and covers (§5.5, §5.4)', () => {
  it('passes Range through: 206 with the part asked for', async () => {
    const s = setup();
    await s.connect(PASS);
    const full = await s.get('/api/v1/navidrome/stream/al-1-t1');
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const all = Buffer.from(await full.arrayBuffer());
    const part = await s.get('/api/v1/navidrome/stream/al-1-t1', s.ada.cookie, {
      range: 'bytes=1000-1999',
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 1000-1999/${all.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(all.subarray(1000, 2000));
    expect(part.headers.get('cache-control')).toBe('private, no-store');
  });

  it('a transcode cannot seek; an error from the server is never passed off as audio', async () => {
    const s = setup();
    await s.connect(PASS);
    const t = await s.get(
      '/api/v1/navidrome/stream/al-1-t1?format=opus&maxBitRate=192',
      s.ada.cookie,
      { range: 'bytes=10-' },
    );
    expect(t.status).toBe(200);
    expect(t.headers.get('accept-ranges')).toBe('none');
    expect((mock.requests.at(-1) as URLSearchParams).get('maxBitRate')).toBe('192');
    expect((await s.get('/api/v1/navidrome/stream/missing')).status).toBe(502);
  });

  it('covers come back as images, cached privately for a week', async () => {
    const s = setup();
    await s.connect(PASS);
    const res = await s.get('/api/v1/navidrome/cover/al-1?size=300');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=604800');
    expect((mock.requests.at(-1) as URLSearchParams).get('size')).toBe('300');
  });

  it('upstream content types are not trusted: no HTML or SVG from our origin, and sandboxed', async () => {
    const s = setup();
    await s.connect(PASS);
    mock.coverType = 'text/html';
    const html = await s.get('/api/v1/navidrome/cover/al-1');
    expect(html.headers.get('content-type')).toBe('application/octet-stream');
    mock.coverType = 'image/svg+xml';
    expect((await s.get('/api/v1/navidrome/cover/al-1')).headers.get('content-type')).toBe(
      'application/octet-stream',
    );
    mock.coverType = 'image/png';
    const ok = await s.get('/api/v1/navidrome/cover/al-1');
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    const audio = await s.get('/api/v1/navidrome/stream/al-1-t1');
    expect(audio.headers.get('content-type')).toBe('audio/wav');
    expect(audio.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
  });

  it('an oversized JSON reply is cut off, not buffered', async () => {
    const s = setup();
    await s.connect(PASS);
    mock.hugeJson = true;
    const res = await s.get('/api/v1/navidrome/rest/getArtists');
    expect(res.status).toBe(502);
  });

  it('a signed URL plays one track for its user for 6 h, without a cookie (§6.5)', async () => {
    const s = setup();
    await s.connect(PASS);
    const { url } = (await (await s.get('/api/v1/navidrome/stream-url/al-1-t1')).json()) as {
      url: string;
    };
    expect((await s.get(url, '')).status).toBe(200);
    expect((await s.get(url.replace('al-1-t1', 'al-1-t2'), '')).status).toBe(401); // bound to the track
    expect((await s.get(url.replace(/sig=[\w-]+/, 'sig=forged'), '')).status).toBe(401);
    expect((await s.get(url.replace(/uid=\d+/, 'uid=99'), '')).status).toBe(401); // bound to the user
    // ON-SEC-2: ids are reused after a delete; the URL is bound to the account, not just its id.
    s.db.prepare('UPDATE users SET created_at = created_at + 1').run();
    expect((await s.get(url, '')).status).toBe(401);
    s.db.prepare('UPDATE users SET created_at = created_at - 1').run();
    s.clock.t += 6 * 3_600_000;
    expect((await s.get(url, '')).status).toBe(401); // expired
  });
});

describe('palettes for Navidrome albums (VISUALIZER_SPEC.md §6.1)', () => {
  it('come from the user’s own cover; without a session (and outside development) there is none', async () => {
    const s = setup();
    await s.connect(PASS);
    const covers = navidromeCovers(s.deps.navidrome);
    const palette = createPaletteService({
      dir: mkdtempSync(join(tmpdir(), 'echo-pal-')),
      load: async (key, { userId }) => (userId !== null ? covers(userId, key.slice(10)) : null),
    });
    const app = createApp({ ...s.deps, palette, devFixtures: false });
    const signedIn = await app.request('http://localhost/api/v1/palette/navidrome:al-1', {
      headers: { host: 'localhost', cookie: s.ada.cookie },
    });
    expect(await signedIn.json()).toMatchObject({ source: 'art' });
    expect((mock.requests.at(-1) as URLSearchParams).get('size')).toBe('256');
    const anon = await app.request('http://localhost/api/v1/palette/navidrome:al-2', {
      headers: { host: 'localhost' },
    });
    expect(anon.status).toBe(401);
    mock.coverType = 'image/svg+xml'; // not a raster: no palette from it
    expect(await covers(s.ada.id, 'al-3')).toBeNull();
  });
});

describe('palette cache scope (security review)', () => {
  it('an album id from another server neither reads nor poisons this server’s palette', async () => {
    const other = await startMockSubsonic(); // a second Navidrome with the same album ids
    try {
      const s = setup();
      s.db
        .prepare("INSERT INTO server_settings (key, value_json) VALUES ('navidrome.allowList', ?)")
        .run(JSON.stringify([other.url]));
      await s.connect(PASS); // ada: the default server
      const bo = s.userCookie('bo');
      expect((await s.connect({ ...PASS, url: other.url }, bo.cookie)).status).toBe(200);
      other.coverType = 'image/svg+xml'; // bo's server gives nothing usable for al-1
      const covers = navidromeCovers(s.deps.navidrome);
      const palette = createPaletteService({
        dir: mkdtempSync(join(tmpdir(), 'echo-pal-')),
        load: async (key, { userId }) => (userId !== null ? covers(userId, key.slice(10)) : null),
      });
      const app = createApp({ ...s.deps, palette, devFixtures: false });
      const get = (cookie: string) =>
        app.request('http://localhost/api/v1/palette/navidrome:al-1', {
          headers: { host: 'localhost', cookie },
        });
      // ada's art palette is cached first; bo must not be served it…
      expect(await (await get(s.ada.cookie)).json()).toMatchObject({ source: 'art' });
      expect(await (await get(bo.cookie)).json()).toMatchObject({ source: 'fallback' });
      // …and bo's server cannot overwrite ada's entry.
      expect(await (await get(s.ada.cookie)).json()).toMatchObject({ source: 'art' });
    } finally {
      await other.close();
    }
  });
});
