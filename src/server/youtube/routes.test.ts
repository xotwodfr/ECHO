import { describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { call, testDeps } from '../testing.ts';

// YouTube Music mode's routes (spec calls 3, 6, 7) against the fake catalogue (testing.ts).

function setup() {
  const t = testDeps();
  const db = t.deps.auth.db;
  const user = (name: string, role = 'user') => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', ?, 0)",
        )
        .run(name, role).lastInsertRowid,
    );
    return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
  };
  return { ...t, db, user };
}

const COOKIE = 'SID=abc; HSID=def; SAPISID=ghi/jkl; __Secure-3PAPISID=ghi/jkl';

describe('signing in to YouTube Music', () => {
  it('saves a cookie only after it signs in', async () => {
    const s = setup();
    const ada = s.user('ada');
    const put = (cookie: unknown) =>
      call(s.app, 'PUT', '/api/v1/me/connections/youtube', { cookie }, ada.cookie);
    expect((await put('SID=abc; HSID=def')).status).toBe(400); // no SAPISID
    expect((await put(42)).status).toBe(400);
    const ok = await put(`Cookie: ${COOKIE}`); // pasted with its header name
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: 'Fixture Listener' });
    const stored = s.db.prepare('SELECT cookie_enc FROM youtube_accounts').pluck().get() as string;
    expect(stored).not.toContain('SAPISID');
    const got = await call(s.app, 'GET', '/api/v1/me/connections/youtube', undefined, ada.cookie);
    const body = await got.text();
    expect(JSON.parse(body)).toEqual({ connected: true, name: 'Fixture Listener' });
    expect(body).not.toContain('SAPISID');
    const del = await call(
      s.app,
      'DELETE',
      '/api/v1/me/connections/youtube',
      undefined,
      ada.cookie,
    );
    expect(del.status).toBe(200);
    expect(
      await (
        await call(s.app, 'GET', '/api/v1/me/connections/youtube', undefined, ada.cookie)
      ).json(),
    ).toEqual({ connected: false });
  });

  it('the session says whether YouTube Music is on and signed in', async () => {
    const s = setup();
    const ada = s.user('ada');
    const session = async () =>
      (
        (await (await call(s.app, 'GET', '/api/v1/session', undefined, ada.cookie)).json()) as {
          youtube: unknown;
        }
      ).youtube;
    expect(await session()).toEqual({ enabled: true, signedIn: false });
    await call(s.app, 'PUT', '/api/v1/me/connections/youtube', { cookie: COOKIE }, ada.cookie);
    expect(await session()).toEqual({ enabled: true, signedIn: true });
  });
});

describe('browsing YouTube Music', () => {
  it('signed-out maps to 409', async () => {
    const s = setup();
    const ada = s.user('ada');
    const lib = await call(s.app, 'GET', '/api/v1/youtube/library', undefined, ada.cookie);
    expect(lib.status).toBe(409);
    expect(await lib.json()).toMatchObject({ code: 'youtube.signed_out' });
    const like = await call(
      s.app,
      'PUT',
      '/api/v1/youtube/like/fakesong001',
      { like: true },
      ada.cookie,
    );
    expect(like.status).toBe(409);
    // A stale cookie (it signed in, then Google rotated it) says so too.
    await call(
      s.app,
      'PUT',
      '/api/v1/me/connections/youtube',
      { cookie: `${COOKIE}; stale=1` },
      ada.cookie,
    );
    const stale = await call(s.app, 'GET', '/api/v1/youtube/library', undefined, ada.cookie);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'youtube.signed_out', stale: true });
  });

  it('anyone signed in to ECHO can browse; pages and search answer', async () => {
    const s = setup();
    const ada = s.user('ada');
    const get = async (p: string) =>
      call(s.app, 'GET', `/api/v1/youtube${p}`, undefined, ada.cookie);
    expect((await get('/home')).status).toBe(200);
    expect((await get('/explore')).status).toBe(200);
    expect((await get('/album/MPREb_fake1')).status).toBe(200);
    expect((await get('/artist/UCfakeartist1')).status).toBe(200);
    expect((await get('/playlist/VLfakeplaylist1')).status).toBe(200);
    expect((await (await get('/up-next/fakesong001')).json()).tracks.length).toBeGreaterThan(0);
    expect((await get('/related/fakesong001')).status).toBe(200);
    expect((await (await get('/lyrics/fakesong001')).json()).source).toBe('Fixture');
    expect((await (await get('/suggest?q=fake')).json()).items).toContain('fake song 1');
    const songs = await (await get('/search?q=Fake%20Song&tab=songs')).json();
    expect(songs.shelves[0].items[0].kind).toBe('song');
    expect((await get('/search?q=')).status).toBe(400);
    expect((await get('/search?q=a&tab=nope')).status).toBe(400);
    expect((await call(s.app, 'GET', '/api/v1/youtube/home')).status).toBe(401); // not signed in
  });

  it('checks ids', async () => {
    const s = setup();
    const ada = s.user('ada');
    const get = async (p: string) =>
      call(s.app, 'GET', `/api/v1/youtube${p}`, undefined, ada.cookie);
    expect((await get('/album/..%2Fx')).status).toBe(400);
    expect((await get('/album/a%20b')).status).toBe(400);
    expect((await get('/stream/short')).status).toBe(400);
    expect((await get('/up-next/--exec=sh')).status).toBe(400);
  });

  // Security review 2026-11-03: catalogues were cached by user id alone, and ids are reused after a
  // delete, so a new account could browse with a deleted user's YouTube sign-in.
  it('a reused user id never inherits the old sign-in', async () => {
    const s = setup();
    const ada = s.user('ada');
    await call(s.app, 'PUT', '/api/v1/me/connections/youtube', { cookie: COOKIE }, ada.cookie);
    expect(
      (await call(s.app, 'GET', '/api/v1/youtube/library', undefined, ada.cookie)).status,
    ).toBe(200);
    s.db.prepare('DELETE FROM users WHERE id = ?').run(ada.id); // the account and its sign-in go
    s.db
      .prepare(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, 'eve', 'x', 'user', 1)",
      )
      .run(ada.id);
    const { createSession } = await import('../auth/sessions.ts');
    const eve = `__Host-echo_session=${createSession(s.db, ada.id, 'web', s.clock.t)}`;
    expect((await call(s.app, 'GET', '/api/v1/youtube/library', undefined, eve)).status).toBe(409);
  });

  it('likes go to the account', async () => {
    const s = setup();
    const ada = s.user('ada');
    await call(s.app, 'PUT', '/api/v1/me/connections/youtube', { cookie: COOKIE }, ada.cookie);
    const like = await call(
      s.app,
      'PUT',
      '/api/v1/youtube/like/fakesong001',
      { like: true },
      ada.cookie,
    );
    expect(like.status).toBe(200);
    const liked = await (
      await call(s.app, 'GET', '/api/v1/youtube/playlist/VLLM', undefined, ada.cookie)
    ).json();
    expect(liked.tracks.map((t: { id: string }) => t.id)).toEqual(['fakesong001']);
    expect(
      (await call(s.app, 'PUT', '/api/v1/youtube/like/fakesong001', { like: 'yes' }, ada.cookie))
        .status,
    ).toBe(400);
  });

  it('streams through the proxy and says why a song will not play', async () => {
    const s = setup();
    const ada = s.user('ada');
    const bad = await call(
      s.app,
      'GET',
      '/api/v1/youtube/stream/unavailable',
      undefined,
      ada.cookie,
    );
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ code: 'youtube.unavailable' });
  });

  it('prepare resolves in the background', async () => {
    const s = setup();
    const ada = s.user('ada');
    const seen: string[] = [];
    const { resolver } = s.deps.youtube;
    const resolve = resolver.resolve.bind(resolver);
    resolver.resolve = (id) => {
      seen.push(id);
      return resolve(id);
    };
    const post = (ids: unknown) =>
      call(s.app, 'POST', '/api/v1/youtube/prepare', { ids }, ada.cookie);
    expect((await post(['fakesong001', 'fakesong002'])).status).toBe(202);
    expect(seen).toEqual(['fakesong001', 'fakesong002']);
    expect((await post(['a', 'b', 'c', 'd'])).status).toBe(400);
    expect((await post(['fakesong001', 'fakesong002', 'fakesong003', 'fakesong004'])).status).toBe(
      400,
    );
  });
});

describe('the admin switch', () => {
  it('hides everything', async () => {
    const s = setup();
    const admin = s.user('root', 'admin');
    const ada = s.user('ada');
    const off = await call(
      s.app,
      'PUT',
      '/api/v1/admin/settings',
      { youtube: { enabled: false } },
      admin.cookie,
    );
    expect(off.status).toBe(200);
    expect((await off.json()).youtube).toEqual({ enabled: false });
    const home = await call(s.app, 'GET', '/api/v1/youtube/home', undefined, ada.cookie);
    expect(home.status).toBe(404);
    expect(await home.json()).toMatchObject({ code: 'youtube.disabled' });
    const session = await (
      await call(s.app, 'GET', '/api/v1/session', undefined, ada.cookie)
    ).json();
    expect(session.youtube).toEqual({ enabled: false, signedIn: false });
    expect(
      (
        await call(
          s.app,
          'PUT',
          '/api/v1/admin/settings',
          { youtube: { enabled: 'no' } },
          admin.cookie,
        )
      ).status,
    ).toBe(400);
  });

  it('shows yt-dlp to admins only', async () => {
    const s = setup();
    const admin = s.user('root', 'admin');
    const ada = s.user('ada');
    const got = await call(s.app, 'GET', '/api/v1/admin/youtube', undefined, admin.cookie);
    expect(await got.json()).toEqual({ version: 'fixture', updatedAt: null, lastError: null });
    expect((await call(s.app, 'GET', '/api/v1/admin/youtube', undefined, ada.cookie)).status).toBe(
      403,
    );
  });
});
