import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, request, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashSecret } from '../../src/server/auth/password.ts';
import { createSession } from '../../src/server/auth/sessions.ts';
import { fromBase32, hotp, stepAt } from '../../src/server/auth/totp.ts';
import { E2E_PASSWORD, MOCK } from './helpers.ts';

// API-02: a non-browser client (Playwright's HTTP client: no cookies, no Origin) gets a device
// token with password + TOTP, uses the bearer token, streams through a signed URL, and is revoked.

const BASE = 'http://localhost:18787';

test('API-02: device token with TOTP, bearer use, signed stream URL, revocation', async ({
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'HTTP only: one run is enough');
  // A user with TOTP, set up through the web API with a session.
  const username = `api-${randomBytes(4).toString('hex')}`;
  const db = new Database(join(tmpdir(), 'echo-e2e', 'data', 'echo.db'));
  const id = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'user', 0)",
      )
      .run(username, await hashSecret(E2E_PASSWORD)).lastInsertRowid,
  );
  const session = createSession(db, id, 'web', Date.now());
  db.close();
  const web = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { cookie: `__Host-echo_session=${session}`, origin: BASE },
  });
  const { secret } = await (
    await web.post('/api/v1/me/totp/start', { data: { password: E2E_PASSWORD } })
  ).json();
  const code = (offset = 0) => hotp(fromBase32(secret), stepAt(Date.now()) + offset);
  expect((await web.post('/api/v1/me/totp/enable', { data: { code: code() } })).ok()).toBe(true);
  await web.dispose();

  // The native client: no cookies, no Origin.
  const app = await request.newContext({ baseURL: BASE });
  const login = (data: object) => app.post('/api/v1/auth/device', { data });
  expect((await login({ username, password: E2E_PASSWORD, name: 'Test phone' })).status()).toBe(
    401,
  );
  // The next step's code: enrolment spent this step's (replay protection), and ±1 step is allowed.
  const res = await login({ username, password: E2E_PASSWORD, name: 'Test phone', code: code(1) });
  expect(res.status()).toBe(201);
  const { token } = (await res.json()) as { token: string };
  expect(token).toMatch(/^echo_dt_/);
  const auth = { authorization: `Bearer ${token}` };

  expect(await (await app.get('/api/v1/me', { headers: auth })).json()).toEqual({
    username,
    role: 'user',
  });
  // Connect the mock Navidrome and stream through a signed URL, which needs no header at all.
  const conn = await app.put('/api/v1/me/connections/navidrome', {
    headers: auth,
    data: { url: MOCK, username: 'ada', password: 'navidrome-pass' },
  });
  expect(conn.ok()).toBe(true);
  const { url } = await (
    await app.get('/api/v1/navidrome/stream-url/al-1-t1', { headers: auth })
  ).json();
  const stream = await app.get(url);
  expect(stream.status()).toBe(200);
  expect(stream.headers()['content-type']).toMatch(/^audio\//);
  // A tampered signature fails.
  expect((await app.get(url.replace(/sig=./, 'sig=A'))).status()).toBe(401);

  // Revoked from the device list: the token stops working.
  const sessions = await (await app.get('/api/v1/me/sessions', { headers: auth })).json();
  const me = sessions.find((s: { current: boolean }) => s.current);
  expect(me).toMatchObject({ kind: 'device', name: 'Test phone' });
  expect((await app.delete(`/api/v1/me/sessions/${me.id}`, { headers: auth })).ok()).toBe(true);
  expect((await app.get('/api/v1/me', { headers: auth })).status()).toBe(401);
  await app.dispose();
});
