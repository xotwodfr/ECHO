import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { sweepGuests } from './guests.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { call, testDeps } from './testing.ts';

// Guest accounts: a code shown as a QR code, scanned once within 10 minutes, gives a listening-only
// account on that phone until its time is up; the inviter (or an admin) can keep or end it.

const HOUR = 3_600_000;

describe('guest accounts', () => {
  let mock: MockSubsonic;
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => mock.close());

  async function setup() {
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const user = async (name: string, role: 'admin' | 'user' = 'user') => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', ?, 0)",
          )
          .run(name, role).lastInsertRowid,
      );
      const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
      return { id, cookie };
    };
    const host = await user('ada');
    expect(
      (
        await call(
          t.app,
          'PUT',
          '/api/v1/me/connections/navidrome',
          { username: 'ada', password: 'navidrome-pass' },
          host.cookie,
        )
      ).status,
    ).toBe(200);
    /** A request as the native app sends it: a bearer token, no cookie, no Origin. */
    const native = (method: string, path: string, token?: string, body?: unknown) =>
      t.app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          host: 'localhost',
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const code = async (durationMs = HOUR, who = host) => {
      const res = await call(t.app, 'POST', '/api/v1/guests/codes', { durationMs }, who.cookie);
      expect(res.status).toBe(201);
      return (await res.json()) as { code: string; url: string; expiresAt: number };
    };
    const join = async (c: string) => {
      const res = await native('POST', '/guests/redeem', undefined, { code: c, name: 'Pixel' });
      return {
        status: res.status,
        body: (await res.json()) as {
          token: string;
          username: string;
          expiresAt: number;
          invitedBy: string;
        },
      };
    };
    return { ...t, db, user, host, native, code, join };
  }

  it('a code is shown, peeked at, redeemed once, and the phone signs in as a guest', async () => {
    const s = await setup();
    expect(
      (await call(s.app, 'POST', '/api/v1/guests/codes', { durationMs: 5 }, s.host.cookie)).status,
    ).toBe(400);
    const c = await s.code(24 * HOUR);
    expect(c.url).toMatch(/\/guest#[\w-]{16,}$/);
    // Before joining: whose pass and how long, without signing in.
    const peek = await s.native('POST', '/guests/peek', undefined, { code: c.code });
    expect(await peek.json()).toEqual({ invitedBy: 'ada', durationMs: 24 * HOUR });
    const j = await s.join(c.code);
    expect(j.status).toBe(201);
    expect(j.body).toMatchObject({ invitedBy: 'ada', expiresAt: s.clock.t + 24 * HOUR });
    expect(j.body.username).toMatch(/^guest-[0-9a-f]{6}$/);
    // Once only.
    expect((await s.join(c.code)).status).toBe(404);
    expect((await s.native('POST', '/guests/peek', undefined, { code: c.code })).status).toBe(404);
    // The guest's own state.
    const me = await (await s.native('GET', '/guests/me', j.body.token)).json();
    expect(me).toEqual({
      guest: { expiresAt: s.clock.t + 24 * HOUR, invitedBy: 'ada', keep: null },
    });
    // A normal user is no guest.
    expect(
      await (await call(s.app, 'GET', '/api/v1/guests/me', undefined, s.host.cookie)).json(),
    ).toEqual({ guest: null });
  });

  it('a code expires after 10 minutes, and a user has at most five live ones', async () => {
    const s = await setup();
    const c = await s.code();
    s.clock.t += 10 * 60_000 + 1;
    expect((await s.join(c.code)).status).toBe(404);
    for (let i = 0; i < 5; i++) await s.code();
    expect(
      (await call(s.app, 'POST', '/api/v1/guests/codes', { durationMs: HOUR }, s.host.cookie))
        .status,
    ).toBe(429);
  });

  it("a guest listens to the inviter's library but writes nothing and invites no one", async () => {
    const s = await setup();
    const g = (await s.join((await s.code()).code)).body.token;
    // Reading the library works, through the inviter's (copied) Navidrome connection.
    const albums = await s.native('GET', '/navidrome/rest/getAlbumList2?type=newest', g);
    expect(albums.status).toBe(200);
    // Writes are refused: Navidrome (stars, playlists, scrobbles), the Wanted list, connections,
    // the password, other guests, admin.
    for (const [m, p] of [
      ['POST', '/navidrome/rest/star?id=x'],
      ['POST', '/wanted'],
      ['PUT', '/me/connections/navidrome'],
      ['POST', '/me/password'],
      ['POST', '/guests/codes'],
      ['GET', '/guests'],
      ['GET', '/admin/users'],
    ] as const)
      expect((await s.native(m, p, g, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(403);
    // Its own plays and settings are its own.
    expect((await s.native('GET', '/me/settings', g)).status).toBe(200);
  });

  it('when the time is up the phone is signed out, and the sweep deletes the account', async () => {
    const s = await setup();
    const j = (await s.join((await s.code(HOUR)).code)).body;
    s.clock.t += HOUR;
    expect((await s.native('GET', '/guests/me', j.token)).status).toBe(401);
    expect(sweepGuests(s.db, s.clock.t)).toBe(1);
    expect(
      s.db.prepare('SELECT COUNT(*) FROM users WHERE username = ?').pluck().get(j.username),
    ).toBe(0);
  });

  it('keep account: the guest asks, only the inviter or an admin approves, then it signs in by name', async () => {
    const s = await setup();
    const j = (await s.join((await s.code()).code)).body;
    expect(
      (
        await s.native('POST', '/guests/me/keep', j.token, {
          username: 'ada',
          password: 'a-long-pass-phrase',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await s.native('POST', '/guests/me/keep', j.token, {
          username: 'guest-x',
          password: 'a-long-pass-phrase',
        })
      ).status,
    ).toBe(400);
    expect(
      (await s.native('POST', '/guests/me/keep', j.token, { username: 'alex', password: 'short' }))
        .status,
    ).toBe(400);
    expect(
      (
        await s.native('POST', '/guests/me/keep', j.token, {
          username: 'alex',
          password: 'a-long-pass-phrase',
        })
      ).status,
    ).toBe(200);
    const list = (await (
      await call(s.app, 'GET', '/api/v1/guests', undefined, s.host.cookie)
    ).json()) as { id: number; keep: { username: string } | null }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.keep?.username).toBe('alex');
    const id = list[0]?.id;
    // Another user sees none of ada's guests, and can neither approve nor end them.
    const bo = await s.user('bo');
    expect(await (await call(s.app, 'GET', '/api/v1/guests', undefined, bo.cookie)).json()).toEqual(
      [],
    );
    expect((await call(s.app, 'POST', `/api/v1/guests/${id}/approve`, {}, bo.cookie)).status).toBe(
      404,
    );
    expect((await call(s.app, 'POST', `/api/v1/guests/${id}/end`, {}, bo.cookie)).status).toBe(404);
    // The inviter approves: a normal user named alex, its own Navidrome to connect.
    expect(
      (await call(s.app, 'POST', `/api/v1/guests/${id}/approve`, {}, s.host.cookie)).status,
    ).toBe(200);
    expect(await (await s.native('GET', '/guests/me', j.token)).json()).toEqual({ guest: null });
    expect(s.db.prepare('SELECT COUNT(*) FROM connections WHERE user_id = ?').pluck().get(id)).toBe(
      0,
    );
    const login = await s.native('POST', '/auth/device', undefined, {
      username: 'alex',
      password: 'a-long-pass-phrase',
      name: 'Pixel',
    });
    expect(login.status).toBe(201);
    // It's no longer kept by the sweep's clock.
    s.clock.t += 30 * 24 * HOUR;
    expect(sweepGuests(s.db, s.clock.t)).toBe(0);
  });

  it('the inviter, or an admin, ends a guest early', async () => {
    const s = await setup();
    const j = (await s.join((await s.code()).code)).body;
    const admin = await s.user('root', 'admin');
    const all = (await (
      await call(s.app, 'GET', '/api/v1/guests', undefined, admin.cookie)
    ).json()) as { id: number }[];
    expect(all).toHaveLength(1);
    expect(
      (await call(s.app, 'POST', `/api/v1/guests/${all[0]?.id}/end`, {}, admin.cookie)).status,
    ).toBe(200);
    expect((await s.native('GET', '/guests/me', j.token)).status).toBe(401);
  });
});
