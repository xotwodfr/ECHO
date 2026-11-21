import { describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { browserOf, QR_TTL_MS } from './qrlogin.ts';
import { call, testDeps } from './testing.ts';

// Sign in with your phone: the web sign-in page shows a request as a QR code; the signed-in phone
// approves it; only the page holding the poll secret collects a session.

describe('sign in with your phone', () => {
  function setup() {
    const t = testDeps();
    const db = t.deps.auth.db;
    const user = (name: string) => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
          )
          .run(name).lastInsertRowid,
      );
      return { id, token: createSession(db, id, 'device', t.clock.t, { name: 'Pixel' }) };
    };
    /** The browser's own requests: same origin, no cookie yet. */
    const page = (
      path: string,
      body: unknown,
      ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 Safari/537.36',
    ) =>
      t.app.request(`http://localhost/api/v1${path}`, {
        method: 'POST',
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          'content-type': 'application/json',
          'user-agent': ua,
        },
        body: JSON.stringify(body),
      });
    /** The phone: a device token, no Origin. */
    const phone = (token: string, path: string, body: unknown) =>
      t.app.request(`http://localhost/api/v1${path}`, {
        method: 'POST',
        headers: {
          host: 'localhost',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const start = async () =>
      (await (await page('/auth/qr', {})).json()) as { id: string; poll: string; url: string };
    const poll = async (id: string, secret: string) => page('/auth/qr/poll', { id, poll: secret });
    return { ...t, db, user, page, phone, start, poll };
  }

  it('the phone sees the browser, approves, and only the asking page is signed in', async () => {
    const s = setup();
    const ada = s.user('ada');
    const q = await s.start();
    expect(q.url).toBe(`http://localhost/link#${q.id}`);
    expect(await (await s.poll(q.id, q.poll)).json()).toEqual({ status: 'pending' });
    const peek = await (await s.phone(ada.token, '/auth/qr/peek', { id: q.id })).json();
    expect(peek).toMatchObject({ browser: 'Chrome on Windows' });
    expect((await s.phone(ada.token, '/auth/qr/approve', { id: q.id })).status).toBe(200);
    // Someone who saw the QR code but not the secret gets nothing.
    expect(await (await s.poll(q.id, 'x'.repeat(q.poll.length))).json()).toEqual({
      status: 'expired',
    });
    const ok = await s.poll(q.id, q.poll);
    expect(await ok.json()).toEqual({ status: 'approved' });
    const cookie = ok.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toMatch(/^__Host-echo_session=/);
    const session = await (await call(s.app, 'GET', '/api/v1/session', undefined, cookie)).json();
    expect(session).toMatchObject({ status: 'signedIn', username: 'ada' });
    // Once only.
    expect(await (await s.poll(q.id, q.poll)).json()).toEqual({ status: 'expired' });
    expect((await s.phone(ada.token, '/auth/qr/approve', { id: q.id })).status).toBe(404);
  });

  it('a request runs out after two minutes; unauthenticated phones and guests cannot approve', async () => {
    const s = setup();
    const q = await s.start();
    expect((await s.page('/auth/qr/approve', { id: q.id })).status).toBe(401);
    s.clock.t += QR_TTL_MS;
    const ada = s.user('ada');
    expect((await s.phone(ada.token, '/auth/qr/approve', { id: q.id })).status).toBe(404);
    expect(await (await s.poll(q.id, q.poll)).json()).toEqual({ status: 'expired' });
    // A guest: refused by the guest rules.
    const g = s.user('guest-abc123');
    s.db
      .prepare(
        'INSERT INTO guests (user_id, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(g.id, ada.id, s.clock.t + 3_600_000, s.clock.t);
    const q2 = await s.start();
    expect((await s.phone(g.token, '/auth/qr/approve', { id: q2.id })).status).toBe(403);
  });

  it('a sign-in page left open all day leaves sign-ins to its address; a flood of codes is refused', async () => {
    const s = setup();
    // The page renews its code every two minutes: a day of it used to spend the address's 100
    // login attempts a day, refusing every password from there for the rest of it.
    for (let i = 0; i < 24 * 30; i++) {
      expect((await s.page('/auth/qr', {})).status).toBe(201);
      s.clock.t += QR_TTL_MS;
    }
    const password = await s.page('/auth/login', { username: 'nobody', password: 'not it at all' });
    expect(password.status).toBe(401); // a wrong password, not "too many attempts"

    // Codes have a budget of their own: 30 a minute from one address.
    s.clock.t += 60_000;
    for (let i = 0; i < 30; i++) expect((await s.page('/auth/qr', {})).status).toBe(201);
    expect((await s.page('/auth/qr', {})).status).toBe(429);
    s.clock.t += 60_000;
    expect((await s.page('/auth/qr', {})).status).toBe(201);
  });

  it('names browsers plainly', () => {
    expect(
      browserOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
      ),
    ).toBe('Safari on Mac');
    expect(
      browserOf('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Firefox on Linux');
    expect(
      browserOf(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0',
      ),
    ).toBe('Edge on Windows');
    expect(browserOf(undefined)).toBe('A browser');
  });
});
