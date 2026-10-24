import { describe, expect, it } from 'vitest';
import { call, cookieOf, testDeps } from '../testing.ts';
import { hashSecret } from './password.ts';
import { startSetup } from './routes.ts';
import { fromBase32, hotp, STEP_S, stepAt } from './totp.ts';

// SETTINGS_AND_SECURITY.md §4: setup with mandatory TOTP, login, TOTP, recovery codes, lockout,
// rate limits, sessions. Argon2id runs at production cost here, so these tests take a few seconds.

const PASSWORD = 'correct horse battery staple';
const codeAt = (secret: string, t: number) => hotp(fromBase32(secret), stepAt(t));

async function withAdmin() {
  const t = testDeps();
  const token = startSetup(t.deps.auth) as string;
  const start = await call(t.app, 'POST', '/api/v1/setup', {
    token,
    username: 'ada',
    password: PASSWORD,
  });
  const { secret } = (await start.json()) as { secret: string };
  const finish = await call(t.app, 'POST', '/api/v1/setup/totp', {
    token,
    code: codeAt(secret, t.clock.t),
  });
  const { recoveryCodes } = (await finish.json()) as { recoveryCodes: string[] };
  return { ...t, token, secret, recoveryCodes, cookie: cookieOf(finish) };
}

async function login(
  app: ReturnType<typeof testDeps>['app'],
  username = 'ada',
  password = PASSWORD,
) {
  return call(app, 'POST', '/api/v1/auth/login', { username, password });
}

describe('first start (§4.1)', () => {
  it('needs the token; creates the admin only after a valid TOTP code; then closes', async () => {
    const t = testDeps();
    const token = startSetup(t.deps.auth) as string;
    expect(token).toMatch(/^[\w-]{43}$/);
    expect((await call(t.app, 'GET', '/api/v1/setup')).status).toBe(200);
    const bad = await call(t.app, 'POST', '/api/v1/setup', {
      token: 'x',
      username: 'ada',
      password: PASSWORD,
    });
    expect(bad.status).toBe(404);
    const weak = await call(t.app, 'POST', '/api/v1/setup', {
      token,
      username: 'ada',
      password: 'short',
    });
    expect(weak.status).toBe(400);
    const start = await call(t.app, 'POST', '/api/v1/setup', {
      token,
      username: 'ada',
      password: PASSWORD,
    });
    const { otpauth, secret } = (await start.json()) as { otpauth: string; secret: string };
    expect(otpauth).toBe(`otpauth://totp/ECHO:ada?secret=${secret}&issuer=ECHO`);
    expect(t.deps.auth.db.prepare('SELECT count(*) FROM users').pluck().get()).toBe(0); // not yet
    const wrong = await call(t.app, 'POST', '/api/v1/setup/totp', { token, code: '000000' });
    expect(wrong.status).toBe(400);
    const ok = await call(t.app, 'POST', '/api/v1/setup/totp', {
      token,
      code: codeAt(secret, t.clock.t),
    });
    expect(ok.status).toBe(200);
    const { recoveryCodes } = (await ok.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^__Host-echo_session=/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    const me = await call(t.app, 'GET', '/api/v1/me', undefined, cookieOf(ok));
    expect(await me.json()).toEqual({ username: 'ada', role: 'admin' });
    // Closed for good: the page and both steps answer 404, and a new token is not issued.
    expect((await call(t.app, 'GET', '/api/v1/setup')).status).toBe(404);
    expect(
      (await call(t.app, 'POST', '/api/v1/setup', { token, username: 'eve', password: PASSWORD }))
        .status,
    ).toBe(404);
    expect(startSetup(t.deps.auth)).toBeNull();
  });

  it('the token expires after 30 minutes', async () => {
    const t = testDeps();
    const token = startSetup(t.deps.auth) as string;
    t.clock.t += 30 * 60_000;
    const r = await call(t.app, 'POST', '/api/v1/setup', {
      token,
      username: 'ada',
      password: PASSWORD,
    });
    expect(r.status).toBe(404);
  });

  it('secrets are stored sealed and hashed, never in the clear', async () => {
    const t = await withAdmin();
    const row = t.deps.auth.db
      .prepare('SELECT password_hash, totp_secret_enc FROM users')
      .get() as {
      password_hash: string;
      totp_secret_enc: string;
    };
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.totp_secret_enc).toMatch(/^v1:/);
    expect(row.totp_secret_enc).not.toContain(t.secret);
    const codes = t.deps.auth.db
      .prepare('SELECT code_hash FROM recovery_codes')
      .pluck()
      .all() as string[];
    expect(codes.every((c) => c.startsWith('$argon2id$'))).toBe(true);
  });
});

describe('login (§4.4, §4.5)', () => {
  it('password, then TOTP; a code is never accepted twice', async () => {
    const t = await withAdmin();
    const first = await login(t.app);
    const { totpRequired, challenge } = (await first.json()) as {
      totpRequired: boolean;
      challenge: string;
    };
    expect(totpRequired).toBe(true);
    expect(first.headers.get('set-cookie')).toBeNull(); // no session before the second factor
    // The setup code's step was recorded: the same code is a replay.
    const replay = await call(t.app, 'POST', '/api/v1/auth/totp', {
      challenge,
      code: codeAt(t.secret, t.clock.t),
    });
    expect(replay.status).toBe(401);
    t.clock.t += STEP_S * 1000;
    const ok = await call(t.app, 'POST', '/api/v1/auth/totp', {
      challenge,
      code: codeAt(t.secret, t.clock.t),
    });
    expect(ok.status).toBe(200);
    expect((await call(t.app, 'GET', '/api/v1/me', undefined, cookieOf(ok))).status).toBe(200);
    // The challenge is single-use.
    const again = await call(t.app, 'POST', '/api/v1/auth/totp', { challenge, code: '123456' });
    expect(again.status).toBe(401);
  });

  it('a recovery code works once', async () => {
    const t = await withAdmin();
    const code = t.recoveryCodes[0] as string;
    const c1 = ((await (await login(t.app)).json()) as { challenge: string }).challenge;
    expect((await call(t.app, 'POST', '/api/v1/auth/totp', { challenge: c1, code })).status).toBe(
      200,
    );
    const c2 = ((await (await login(t.app)).json()) as { challenge: string }).challenge;
    expect((await call(t.app, 'POST', '/api/v1/auth/totp', { challenge: c2, code })).status).toBe(
      401,
    );
  });

  it('five TOTP tries per challenge', async () => {
    const t = await withAdmin();
    const { challenge } = (await (await login(t.app)).json()) as { challenge: string };
    for (let i = 0; i < 5; i++)
      expect(
        (await call(t.app, 'POST', '/api/v1/auth/totp', { challenge, code: '000000' })).status,
      ).toBe(401);
    t.clock.t += STEP_S * 1000;
    const late = await call(t.app, 'POST', '/api/v1/auth/totp', {
      challenge,
      code: codeAt(t.secret, t.clock.t),
    });
    expect(await late.json()).toEqual({ error: 'challenge_expired' });
  });

  it('wrong codes count across challenges: five lock the account, and a correct password does not reset it', async () => {
    const t = await withAdmin();
    const challenge = async () =>
      ((await (await login(t.app)).json()) as { challenge: string }).challenge;
    const c1 = await challenge();
    for (let i = 0; i < 4; i++)
      await call(t.app, 'POST', '/api/v1/auth/totp', { challenge: c1, code: '000000' });
    const c2 = await challenge(); // a fresh challenge after a correct password
    await call(t.app, 'POST', '/api/v1/auth/totp', { challenge: c2, code: '000000' }); // fifth
    t.clock.t += STEP_S * 1000;
    // Locked: no new challenge, and the open one is refused even with a valid code.
    expect((await login(t.app)).status).toBe(401);
    const late = await call(t.app, 'POST', '/api/v1/auth/totp', {
      challenge: c2,
      code: codeAt(t.secret, t.clock.t),
    });
    expect(late.status).toBe(401);
    const events = t.deps.auth.db.prepare('SELECT event FROM audit_log').pluck().all();
    expect(events).toContain('login.locked');
    t.clock.t += 15 * 60_000;
    expect((await login(t.app)).status).toBe(200);
  });

  it('the same recovery code or TOTP code sent twice at once is accepted once', async () => {
    const t = await withAdmin();
    const challenge = async () =>
      ((await (await login(t.app)).json()) as { challenge: string }).challenge;
    const code = t.recoveryCodes[1] as string;
    const [a, b] = [await challenge(), await challenge()];
    const both = await Promise.all([
      call(t.app, 'POST', '/api/v1/auth/totp', { challenge: a, code }),
      call(t.app, 'POST', '/api/v1/auth/totp', { challenge: b, code }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
    t.clock.t += STEP_S * 1000;
    const totp = codeAt(t.secret, t.clock.t);
    const [x, y] = [await challenge(), await challenge()];
    const twice = await Promise.all([
      call(t.app, 'POST', '/api/v1/auth/totp', { challenge: x, code: totp }),
      call(t.app, 'POST', '/api/v1/auth/totp', { challenge: y, code: totp }),
    ]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('a user without TOTP gets a session straight away; unknown users get the same answer as wrong passwords', async () => {
    const t = testDeps();
    t.deps.auth.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('bo', ?, 'user', 0)",
      )
      .run(await hashSecret(PASSWORD));
    const ok = await login(t.app, 'BO'); // usernames ignore case
    expect(await ok.json()).toEqual({ totpRequired: false });
    expect(cookieOf(ok)).toMatch(/^__Host-echo_session=/);
    const wrong = await login(t.app, 'bo', 'wrong password!!');
    const unknown = await login(t.app, 'nobody', PASSWORD);
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('five failures lock the account for 15 minutes, doubling', async () => {
    const t = await withAdmin();
    for (let i = 0; i < 5; i++) await login(t.app, 'ada', 'wrong password!!');
    expect((await login(t.app)).status).toBe(401); // locked: even the right password
    t.clock.t += 15 * 60_000;
    expect((await login(t.app)).status).toBe(200);
    const events = t.deps.auth.db.prepare('SELECT event FROM audit_log').pluck().all();
    expect(events).toContain('login.locked');
    expect(events.filter((e) => e === 'login.failed')).toHaveLength(5);
  });

  it('ten attempts a minute per client address', async () => {
    const t = testDeps();
    for (let i = 0; i < 10; i++) expect((await login(t.app, `u${i}`)).status).toBe(401);
    expect((await login(t.app, 'u10')).status).toBe(429);
    t.clock.t += 60_000;
    expect((await login(t.app, 'u11')).status).toBe(401);
  });
});

describe('sessions (§4.6)', () => {
  it('GET /session says who is signed in without a 401', async () => {
    const t = testDeps();
    expect(await (await call(t.app, 'GET', '/api/v1/session')).json()).toEqual({ status: 'setup' });
    const a = await withAdmin();
    expect(await (await call(a.app, 'GET', '/api/v1/session')).json()).toEqual({
      status: 'anonymous',
    });
    const me = await call(a.app, 'GET', '/api/v1/session', undefined, a.cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      status: 'signedIn',
      username: 'ada',
      role: 'admin',
      navidrome: false,
      mustEnrolTotp: false,
    });
  });

  it('everything but the allow-list needs a session; logout ends it', async () => {
    const t = await withAdmin();
    expect((await call(t.app, 'GET', '/api/v1/me')).status).toBe(401);
    expect(
      (await call(t.app, 'GET', '/api/v1/me', undefined, '__Host-echo_session=forged')).status,
    ).toBe(401);
    expect((await call(t.app, 'POST', '/api/v1/auth/logout', {}, t.cookie)).status).toBe(200);
    expect((await call(t.app, 'GET', '/api/v1/me', undefined, t.cookie)).status).toBe(401);
  });

  it('a web session ends after 14 idle days, and slides while used', async () => {
    const t = await withAdmin();
    for (let d = 0; d < 40; d += 10) {
      t.clock.t += 10 * 86_400_000;
      expect((await call(t.app, 'GET', '/api/v1/me', undefined, t.cookie)).status).toBe(200);
    }
    t.clock.t += 14 * 86_400_000;
    expect((await call(t.app, 'GET', '/api/v1/me', undefined, t.cookie)).status).toBe(401);
  });

  it('only the token’s hash is stored', async () => {
    const t = await withAdmin();
    const token = t.cookie.split('=')[1] as string;
    const stored = t.deps.auth.db.prepare('SELECT id_hash FROM sessions').pluck().all() as string[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]).not.toContain(token);
  });
});
