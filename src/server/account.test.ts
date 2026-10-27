import { describe, expect, it } from 'vitest';
import { deleteUser } from './account.ts';
import { startSetup } from './auth/routes.ts';
import { fromBase32, hotp, STEP_S, stepAt } from './auth/totp.ts';
import { call, cookieOf, testDeps } from './testing.ts';

// M8 tasks 2–6: Account (password, sessions, TOTP, recovery codes, deletion), Admin (users,
// invites, audit, "require TOTP for all"), device tokens. SEC-06, SEC-14, ACC-02, ACC-03, API-02.

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'another long passphrase here';
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
  const db = t.deps.auth.db;
  /** Moves past the TOTP step used last, so the next code is fresh. */
  const nextStep = () => {
    t.clock.t += STEP_S * 1000;
  };
  return { ...t, db, secret, recoveryCodes, admin: cookieOf(finish), nextStep };
}

type World = Awaited<ReturnType<typeof withAdmin>>;

/** A user made through an invite, signed in. */
async function invited(w: World, username = 'bo') {
  const inv = await call(w.app, 'POST', '/api/v1/admin/invites', {}, w.admin);
  const { token } = (await inv.json()) as { token: string };
  const res = await call(w.app, 'POST', '/api/v1/invite', { token, username, password: PASSWORD });
  expect(res.status).toBe(200);
  const id = w.db
    .prepare('SELECT id FROM users WHERE username = ?')
    .pluck()
    .get(username) as number;
  return { id, cookie: cookieOf(res), token };
}

const j = async (r: Response | Promise<Response>) => (await r).json();

describe('password change (§4.3, SEC-14)', () => {
  it('needs the current password, follows the policy, revokes every other session', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    // A second session of Bo's elsewhere.
    const other = cookieOf(
      await call(w.app, 'POST', '/api/v1/auth/login', { username: 'bo', password: PASSWORD }),
    );
    const change = (b: object) => call(w.app, 'POST', '/api/v1/me/password', b, bo.cookie);
    expect((await change({ current: 'wrong wrong wrong', next: NEW_PASSWORD })).status).toBe(403);
    expect((await change({ current: PASSWORD, next: 'short' })).status).toBe(400);
    const ok = await change({ current: PASSWORD, next: NEW_PASSWORD });
    expect(await ok.json()).toEqual({ ok: true, revoked: 1 });
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, other)).status).toBe(401);
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, bo.cookie)).status).toBe(200);
    const relog = await call(w.app, 'POST', '/api/v1/auth/login', {
      username: 'bo',
      password: NEW_PASSWORD,
    });
    expect(relog.status).toBe(200);
  });
});

describe('sessions and devices (§4.6, SEC-14)', () => {
  it('lists the user’s own, revokes one, or all the others; never another user’s', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    const second = cookieOf(
      await call(w.app, 'POST', '/api/v1/auth/login', { username: 'bo', password: PASSWORD }),
    );
    const list = (await j(call(w.app, 'GET', '/api/v1/me/sessions', undefined, bo.cookie))) as {
      id: string;
      current: boolean;
      location: string;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(bo.cookie.split('=')[1]);
    // The admin cannot revoke Bo's session through their own account.
    const target = list.find((s) => !s.current) as { id: string };
    expect(
      (await call(w.app, 'DELETE', `/api/v1/me/sessions/${target.id}`, undefined, w.admin)).status,
    ).toBe(404);
    expect(
      (await call(w.app, 'DELETE', `/api/v1/me/sessions/${target.id}`, undefined, bo.cookie))
        .status,
    ).toBe(200);
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, second)).status).toBe(401);
    // Sign out everywhere else.
    const third = cookieOf(
      await call(w.app, 'POST', '/api/v1/auth/login', { username: 'bo', password: PASSWORD }),
    );
    expect(
      await j(call(w.app, 'POST', '/api/v1/me/sessions/revoke-others', {}, bo.cookie)),
    ).toEqual({ ok: true, revoked: 1 });
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, third)).status).toBe(401);
    // Stored hashed only (SEC-14).
    const stored = w.db.prepare('SELECT id_hash FROM sessions').pluck().all() as string[];
    expect(stored.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });
});

describe('two-factor (§4.5)', () => {
  it('enrol with one valid code, recovery codes once; disable needs password and code', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    expect(
      (
        await call(
          w.app,
          'POST',
          '/api/v1/me/totp/start',
          { password: 'nope nope nope' },
          bo.cookie,
        )
      ).status,
    ).toBe(403);
    const { secret } = await j(
      call(w.app, 'POST', '/api/v1/me/totp/start', { password: PASSWORD }, bo.cookie),
    );
    expect(
      (await call(w.app, 'POST', '/api/v1/me/totp/enable', { code: '000000' }, bo.cookie)).status,
    ).toBe(400);
    const en = await j(
      call(w.app, 'POST', '/api/v1/me/totp/enable', { code: codeAt(secret, w.clock.t) }, bo.cookie),
    );
    expect(en.recoveryCodes).toHaveLength(10);
    expect(
      (await j(call(w.app, 'GET', '/api/v1/me/account', undefined, bo.cookie))).totpEnabled,
    ).toBe(true);
    // Logging in now asks for the code.
    expect(
      await j(call(w.app, 'POST', '/api/v1/auth/login', { username: 'bo', password: PASSWORD })),
    ).toMatchObject({ totpRequired: true });
    // Regenerating replaces the codes: the old ones stop working.
    w.nextStep();
    const re = await j(
      call(
        w.app,
        'POST',
        '/api/v1/me/recovery-codes',
        { password: PASSWORD, code: codeAt(secret, w.clock.t) },
        bo.cookie,
      ),
    );
    expect(re.recoveryCodes).toHaveLength(10);
    const off = (code: string) =>
      call(w.app, 'POST', '/api/v1/me/totp/disable', { password: PASSWORD, code }, bo.cookie);
    expect((await off(en.recoveryCodes[0])).status).toBe(403);
    expect((await off(re.recoveryCodes[0])).status).toBe(200);
    expect(
      w.db.prepare('SELECT totp_secret_enc FROM users WHERE id = ?').pluck().get(bo.id),
    ).toBeNull();
  });

  it('the admin cannot turn their own TOTP off', async () => {
    const w = await withAdmin();
    w.nextStep();
    const r = await call(
      w.app,
      'POST',
      '/api/v1/me/totp/disable',
      { password: PASSWORD, code: codeAt(w.secret, w.clock.t) },
      w.admin,
    );
    expect(r.status).toBe(403);
  });
});

describe('deleting accounts (ACC-03, SEC-06)', () => {
  const tablesWithUser = (w: World, id: number) => {
    const out: string[] = [];
    for (const [t, col] of [
      ['users', 'id'],
      ['sessions', 'user_id'],
      ['connections', 'user_id'],
      ['user_settings', 'user_id'],
      ['track_overrides', 'user_id'],
      ['queue_state', 'user_id'],
      ['recovery_codes', 'user_id'],
      ['audit_log', 'user_id'],
      ['invites', 'created_by'],
      ['invites', 'used_by'],
    ] as const)
      if (w.db.prepare(`SELECT COUNT(*) FROM ${t} WHERE ${col} = ?`).pluck().get(id)) out.push(t);
    return out;
  };

  it('needs password and second factor; afterwards nothing of the user remains', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    // Give Bo some of everything.
    await call(w.app, 'PUT', '/api/v1/me/settings', { lyrics: { announceLines: true } }, bo.cookie);
    await call(
      w.app,
      'PUT',
      '/api/v1/me/tracks/navidrome:t1/override',
      { offsetMs: 100 },
      bo.cookie,
    );
    await call(
      w.app,
      'PUT',
      '/api/v1/me/queue',
      { queue: null, positionMs: 0, baseUpdatedAt: 0 },
      bo.cookie,
    );
    w.db
      .prepare(
        "INSERT INTO connections (user_id, provider, config_json, secret_enc, status, updated_at) VALUES (?, 'spotify', '{}', 'v1:x:y', 'connected', 0)",
      )
      .run(bo.id);
    const { secret } = await j(
      call(w.app, 'POST', '/api/v1/me/totp/start', { password: PASSWORD }, bo.cookie),
    );
    await call(
      w.app,
      'POST',
      '/api/v1/me/totp/enable',
      { code: codeAt(secret, w.clock.t) },
      bo.cookie,
    );
    const del = (b: object) => call(w.app, 'DELETE', '/api/v1/me', b, bo.cookie);
    expect((await del({ password: PASSWORD })).status).toBe(403); // no code
    w.nextStep();
    expect(
      (await del({ password: 'wrong wrong wrong', code: codeAt(secret, w.clock.t) })).status,
    ).toBe(403);
    const ok = await del({ password: PASSWORD, code: codeAt(secret, w.clock.t) });
    expect(ok.status).toBe(200);
    expect(tablesWithUser(w, bo.id)).toEqual([]);
    expect(
      w.db.prepare('SELECT COUNT(*) FROM connections WHERE secret_enc IS NOT NULL').pluck().get(),
    ).toBe(0);
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, bo.cookie)).status).toBe(401);
  });

  it('the last admin cannot delete themselves', async () => {
    const w = await withAdmin();
    w.nextStep();
    const r = await call(
      w.app,
      'DELETE',
      '/api/v1/me',
      { password: PASSWORD, code: codeAt(w.secret, w.clock.t) },
      w.admin,
    );
    expect(r.status).toBe(409);
  });
});

// ON-SEC-4: two admins deleting themselves at once both passed the route's check (it runs before
// re-authentication awaits); the delete itself now refuses the last admin.
it('deleteUser never removes the last admin, whatever the caller checked', async () => {
  const w = await withAdmin();
  const ada = w.db.prepare("SELECT id FROM users WHERE username = 'ada'").pluck().get() as number;
  expect(deleteUser(w.db, ada, w.clock.t, ada)).toBe(false);
  expect(w.db.prepare('SELECT COUNT(*) FROM users').pluck().get()).toBe(1);
});

describe('Admin → Users, invites and the audit log (ACC-02)', () => {
  it('invites are single use, expire after 72 h, and make a plain user who sees nothing of the admin’s', async () => {
    const w = await withAdmin();
    await call(w.app, 'PUT', '/api/v1/me/tracks/navidrome:t1/override', { offsetMs: 250 }, w.admin);
    const bo = await invited(w);
    const again = await call(w.app, 'POST', '/api/v1/invite', {
      token: bo.token,
      username: 'cy',
      password: PASSWORD,
    });
    expect(again.status).toBe(404);
    expect(await j(call(w.app, 'GET', '/api/v1/me', undefined, bo.cookie))).toEqual({
      username: 'bo',
      role: 'user',
    });
    expect(
      (await j(call(w.app, 'GET', '/api/v1/me/tracks/navidrome:t1/override', undefined, bo.cookie)))
        .offsetMs,
    ).toBe(0);
    expect((await call(w.app, 'GET', '/api/v1/admin/users', undefined, bo.cookie)).status).toBe(
      403,
    );
    const late = (await j(
      call(w.app, 'POST', '/api/v1/admin/invites', { username: 'dee' }, w.admin),
    )) as { token: string };
    w.clock.t += 72 * 3_600_000 + 1;
    expect(
      (await call(w.app, 'POST', '/api/v1/invite', { token: late.token, password: PASSWORD }))
        .status,
    ).toBe(404);
    // Stored hashed.
    const hashes = w.db.prepare('SELECT token_hash FROM invites').pluck().all() as string[];
    expect(hashes).not.toContain(late.token);
  });

  // ON-SEC-1: deleting the invitee cleared `used_by` (ON DELETE SET NULL), which made the link valid
  // again for the rest of its 72 h.
  it('a redeemed invite stays spent after its user is deleted', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    expect(
      (await call(w.app, 'DELETE', `/api/v1/admin/users/${bo.id}`, undefined, w.admin)).status,
    ).toBe(200);
    const again = await call(w.app, 'POST', '/api/v1/invite', {
      token: bo.token,
      username: 'bo',
      password: PASSWORD,
    });
    expect(again.status).toBe(404);
    expect(await j(call(w.app, 'GET', '/api/v1/admin/invites', undefined, w.admin))).toEqual([]);
  });

  it('a preset username is used; invites can be listed and revoked', async () => {
    const w = await withAdmin();
    const { token } = await j(
      call(w.app, 'POST', '/api/v1/admin/invites', { username: 'eve' }, w.admin),
    );
    const list = await j(call(w.app, 'GET', '/api/v1/admin/invites', undefined, w.admin));
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe('eve');
    const r = await call(w.app, 'POST', '/api/v1/invite', {
      token,
      username: 'mallory',
      password: PASSWORD,
    });
    expect(r.status).toBe(200);
    expect(w.db.prepare("SELECT 1 FROM users WHERE username = 'eve'").get()).toBeTruthy();
    const { token: t2 } = await j(call(w.app, 'POST', '/api/v1/admin/invites', {}, w.admin));
    const [pending] = await j(call(w.app, 'GET', '/api/v1/admin/invites', undefined, w.admin));
    expect(
      (await call(w.app, 'DELETE', `/api/v1/admin/invites/${pending.id}`, undefined, w.admin))
        .status,
    ).toBe(200);
    expect(
      (
        await call(w.app, 'POST', '/api/v1/invite', {
          token: t2,
          username: 'zed',
          password: PASSWORD,
        })
      ).status,
    ).toBe(404);
  });

  it('disable signs the user out; promote needs TOTP; the last admin stays; unlock; delete', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    const patch = (b: object, id = bo.id) =>
      call(w.app, 'PATCH', `/api/v1/admin/users/${id}`, b, w.admin);
    expect((await patch({ disabled: true })).status).toBe(200);
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, bo.cookie)).status).toBe(401);
    expect(
      (await call(w.app, 'POST', '/api/v1/auth/login', { username: 'bo', password: PASSWORD }))
        .status,
    ).toBe(401);
    await patch({ disabled: false });
    expect((await patch({ role: 'admin' })).status).toBe(409); // no TOTP yet
    const adminId = w.db
      .prepare("SELECT id FROM users WHERE username = 'ada'")
      .pluck()
      .get() as number;
    expect((await patch({ role: 'user' }, adminId)).status).toBe(409);
    expect((await patch({ disabled: true }, adminId)).status).toBe(409);
    // Lock Bo out with wrong passwords, then unlock.
    for (let i = 0; i < 5; i++)
      await call(w.app, 'POST', '/api/v1/auth/login', {
        username: 'bo',
        password: 'wrong wrong wrong',
      });
    const users = await j(call(w.app, 'GET', '/api/v1/admin/users', undefined, w.admin));
    expect(
      users.find((u: { username: string }) => u.username === 'bo').lockedForMs,
    ).toBeGreaterThan(0);
    await call(w.app, 'POST', `/api/v1/admin/users/${bo.id}/unlock`, {}, w.admin);
    // (the per-IP limit of 10 a minute is spent by now in this test; the lock itself is gone)
    expect(w.deps.auth.limiter.lockedFor('bo', w.clock.t)).toBe(0);
    expect(
      (await call(w.app, 'DELETE', `/api/v1/admin/users/${adminId}`, undefined, w.admin)).status,
    ).toBe(409);
    expect(
      (await call(w.app, 'DELETE', `/api/v1/admin/users/${bo.id}`, undefined, w.admin)).status,
    ).toBe(200);
    expect(w.db.prepare('SELECT COUNT(*) FROM users').pluck().get()).toBe(1);
    const log = await j(call(w.app, 'GET', '/api/v1/admin/audit?limit=5', undefined, w.admin));
    expect(log[0]).toMatchObject({
      event: 'account.deleted',
      username: 'ada',
      detail: { userId: bo.id },
    });
  });

  it('"require TOTP for all": invitees enrol at once; existing users must enrol before anything else', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    await call(
      w.app,
      'PUT',
      '/api/v1/admin/settings',
      { auth: { requireTotpForAll: true } },
      w.admin,
    );
    expect((await call(w.app, 'GET', '/api/v1/me/queue', undefined, bo.cookie)).status).toBe(403);
    expect(
      (await j(call(w.app, 'GET', '/api/v1/session', undefined, bo.cookie))).mustEnrolTotp,
    ).toBe(true);
    const { secret } = await j(
      call(w.app, 'POST', '/api/v1/me/totp/start', { password: PASSWORD }, bo.cookie),
    );
    await call(
      w.app,
      'POST',
      '/api/v1/me/totp/enable',
      { code: codeAt(secret, w.clock.t) },
      bo.cookie,
    );
    expect((await call(w.app, 'GET', '/api/v1/me/queue', undefined, bo.cookie)).status).toBe(200);
    // A new invitee gets a TOTP step before the account exists.
    const { token } = await j(call(w.app, 'POST', '/api/v1/admin/invites', {}, w.admin));
    const step1 = await j(
      call(w.app, 'POST', '/api/v1/invite', { token, username: 'cy', password: PASSWORD }),
    );
    expect(step1.totpRequired).toBe(true);
    expect(w.db.prepare("SELECT 1 FROM users WHERE username = 'cy'").get()).toBeUndefined();
    const step2 = await call(w.app, 'POST', '/api/v1/invite/totp', {
      token,
      code: codeAt(step1.secret, w.clock.t),
    });
    expect((await step2.json()).recoveryCodes).toHaveLength(10);
    expect((await call(w.app, 'GET', '/api/v1/me/queue', undefined, cookieOf(step2))).status).toBe(
      200,
    );
  });
});

describe('device tokens (API-02)', () => {
  it('credentials + TOTP give a bearer token that works, is listed, and can be revoked', async () => {
    const w = await withAdmin();
    const dev = (b: object) => call(w.app, 'POST', '/api/v1/auth/device', b);
    expect((await dev({ username: 'ada', password: PASSWORD, name: 'Phone' })).status).toBe(401); // TOTP needed
    w.nextStep();
    const r = await dev({
      username: 'ada',
      password: PASSWORD,
      name: 'Phone',
      code: codeAt(w.secret, w.clock.t),
    });
    expect(r.status).toBe(201);
    const { token } = (await r.json()) as { token: string };
    expect(token).toMatch(/^echo_dt_/);
    const bearer = (path: string, method = 'GET') =>
      w.app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: { host: 'localhost', authorization: `Bearer ${token}` },
      });
    expect((await bearer('/me')).status).toBe(200);
    const sessions = await j(call(w.app, 'GET', '/api/v1/me/sessions', undefined, w.admin));
    const phone = sessions.find((s: { name: string }) => s.name === 'Phone');
    expect(phone.kind).toBe('device');
    await call(w.app, 'DELETE', `/api/v1/me/sessions/${phone.id}`, undefined, w.admin);
    expect((await bearer('/me')).status).toBe(401);
  });

  it('SEC-14: a device token slides while used and ends after 60 idle days', async () => {
    const w = await withAdmin();
    w.nextStep();
    const r = await call(w.app, 'POST', '/api/v1/auth/device', {
      username: 'ada',
      password: PASSWORD,
      name: 'Tablet',
      code: codeAt(w.secret, w.clock.t),
    });
    const { token } = (await r.json()) as { token: string };
    const me = () =>
      w.app.request('http://localhost/api/v1/me', {
        headers: { host: 'localhost', authorization: `Bearer ${token}` },
      });
    w.clock.t += 59 * 86_400_000; // used again within 60 days: it slides
    expect((await me()).status).toBe(200);
    w.clock.t += 59 * 86_400_000;
    expect((await me()).status).toBe(200);
    w.clock.t += 61 * 86_400_000; // then 61 idle days
    expect((await me()).status).toBe(401);
  });
});

describe('re-authentication is rate limited (security review)', () => {
  it('five wrong passwords through a session lock the account and sign it out everywhere', async () => {
    const w = await withAdmin();
    const bo = await invited(w);
    for (let i = 0; i < 5; i++) {
      const r = await call(
        w.app,
        'POST',
        '/api/v1/me/password',
        { current: `wrong guess ${i}xx`, next: NEW_PASSWORD },
        bo.cookie,
      );
      expect(r.status).toBe(403);
    }
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, bo.cookie)).status).toBe(401);
    expect(w.deps.auth.limiter.lockedFor('bo', w.clock.t)).toBeGreaterThan(0);
  });

  it('wrong second factors count too', async () => {
    const w = await withAdmin();
    for (let i = 0; i < 5; i++)
      await call(
        w.app,
        'POST',
        '/api/v1/me/recovery-codes',
        { password: PASSWORD, code: '000000' },
        w.admin,
      );
    expect(w.deps.auth.limiter.lockedFor('ada', w.clock.t)).toBeGreaterThan(0);
    expect((await call(w.app, 'GET', '/api/v1/me', undefined, w.admin)).status).toBe(401);
  });
});
