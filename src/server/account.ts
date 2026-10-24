import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { audit } from './audit.ts';
import { CODE_PARAMS, hashSecret, passwordProblem, verifySecret } from './auth/password.ts';
import { type AuthDeps, type AuthEnv, body, newRecoveryCodes, str } from './auth/routes.ts';
import { revokeOthers, revokeSession, SESSION_COOKIE } from './auth/sessions.ts';
import { newTotpSecret, otpauthUri, verifyTotp } from './auth/totp.ts';
import type { Db } from './db/db.ts';

// Account → Profile, Password, Two-factor, Sessions & devices, and deleting the account
// (SETTINGS_AND_SECURITY.md §4.3, §4.5, §4.6, §10; IMPLEMENTATION_PLAN.md M8 task 2, 6). Everything
// here acts on the signed-in user only: no route takes another user's id (SEC-11).

const RECOVERY = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/;
const ENROL_TTL = 10 * 60_000;

/**
 * Deletes a user and everything that is theirs: sessions, connections (with their ciphertext),
 * settings, queue, overrides, recovery codes and invites they created all cascade; their audit rows
 * go too, and one anonymous line records the deletion (SEC-06, ACC-03).
 */
export function deleteUser(db: Db, userId: number, now: number, by: number | null) {
  db.transaction(() => {
    db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    audit(db, now, by === userId ? null : by, 'account.deleted', { userId });
  })();
}

/** The last admin can neither leave nor stop being one. */
export const isLastAdmin = (db: Db, userId: number) =>
  (db
    .prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
    .pluck()
    .get(userId) as number) === 0 &&
  !!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin'").get(userId);

/**
 * A current TOTP code (recorded, so it cannot be replayed) or an unused recovery code (spent).
 * True when it is good.
 */
export async function secondFactor(deps: AuthDeps, userId: number, raw: unknown) {
  const { db, sealer, now } = deps;
  const code = (str(raw, 32) ?? '').trim().toLowerCase();
  const u = db
    .prepare('SELECT totp_secret_enc, totp_last_step FROM users WHERE id = ? AND totp_enabled = 1')
    .get(userId) as { totp_secret_enc: string; totp_last_step: number | null } | undefined;
  if (!u) return false;
  if (/^\d{6}$/.test(code)) {
    const secret = sealer.open(u.totp_secret_enc, {
      table: 'users',
      rowId: userId,
      column: 'totp_secret_enc',
    });
    const step = verifyTotp(secret, code, now(), u.totp_last_step);
    return (
      step !== null &&
      db
        .prepare(
          'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
        )
        .run(step, userId, step).changes === 1
    );
  }
  if (!RECOVERY.test(code)) return false;
  const rows = db
    .prepare('SELECT rowid, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .all(userId) as { rowid: number; code_hash: string }[];
  for (const r of rows)
    if (await verifySecret(code, r.code_hash))
      return (
        db
          .prepare('UPDATE recovery_codes SET used_at = ? WHERE rowid = ? AND used_at IS NULL')
          .run(now(), r.rowid).changes === 1
      );
  return false;
}

async function storeRecoveryCodes(db: Db, userId: number) {
  const codes = newRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => hashSecret(c, CODE_PARAMS)));
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const h of hashes) ins.run(userId, h);
  })();
  return codes;
}

export function accountRoutes(deps: AuthDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const { db, sealer, now } = deps;
  const app = new Hono<AuthEnv>();
  /** TOTP enrolments in progress: the secret waits here until one valid code confirms it. */
  const enrolling = new Map<number, { secret: string; expiresAt: number }>();

  const userRow = (id: number) =>
    db
      .prepare(
        'SELECT username, password_hash, role, totp_enabled, created_at FROM users WHERE id = ?',
      )
      .get(id) as
      | {
          username: string;
          password_hash: string;
          role: string;
          totp_enabled: number;
          created_at: number;
        }
      | undefined;
  const passwordOk = async (id: number, pw: unknown) => {
    const u = userRow(id);
    return !!u && (await verifySecret(str(pw, 1024) ?? '', u.password_hash));
  };

  /**
   * Re-authentication for a sensitive change: the password and, when `needCode`, a second factor.
   * Wrong guesses count like failed logins (per IP, and per account towards the lockout), so a
   * stolen session cannot be used to guess them; a lockout signs the account out everywhere
   * (security review). Returns the refusal, or null when both are good.
   */
  async function reauth(c: Context<AuthEnv>, b: Record<string, unknown>, needCode: boolean) {
    const user = c.var.user;
    const t = now();
    if (!deps.limiter.ipAllows(c.var.ip, t)) return c.json({ error: 'rate_limited' }, 429);
    if (deps.limiter.lockedFor(user.username, t)) return c.json({ error: 'locked' }, 423);
    const lockout = (factor: string) => {
      revokeOthers(db, user.id, null);
      audit(db, t, user.id, 'login.locked', { factor, reauth: true });
    };
    if (!(await passwordOk(user.id, b.password ?? b.current))) {
      if (deps.limiter.fail(user.username, t)) lockout('password');
      audit(db, t, user.id, 'reauth.failed', { factor: 'password' });
      return c.json({ error: 'wrong_password' }, 403);
    }
    deps.limiter.succeed(user.username);
    if (!needCode) return null;
    if (!(await secondFactor(deps, user.id, b.code))) {
      if (deps.limiter.failSecond(user.username, t)) lockout('totp');
      audit(db, t, user.id, 'reauth.failed', { factor: 'totp' });
      return c.json({ error: 'bad_code' }, 403);
    }
    deps.limiter.succeedSecond(user.username);
    return null;
  }

  app.get('/me/account', requireUser, (c) => {
    const u = userRow(c.var.user.id);
    if (!u) return c.json({ error: 'unauthenticated' }, 401);
    const left = db
      .prepare('SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
      .pluck()
      .get(c.var.user.id) as number;
    return c.json({
      username: u.username,
      role: u.role,
      createdAt: u.created_at,
      totpEnabled: !!u.totp_enabled,
      recoveryCodesLeft: left,
    });
  });

  // ---- password (§4.3): revokes every other session and device ----
  app.post('/me/password', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    const refused = await reauth(c, b, false);
    if (refused) return refused;
    const next = str(b.next, 1024);
    const problem = next === null ? 'required' : passwordProblem(next);
    if (problem || next === null) return c.json({ error: 'bad_password', detail: problem }, 400);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      await hashSecret(next),
      user.id,
    );
    const revoked = revokeOthers(db, user.id, user.sessionHash).changes;
    audit(db, now(), user.id, 'account.password_changed', { revoked });
    return c.json({ ok: true, revoked });
  });

  // ---- sessions and devices (§4.6) ----
  app.get('/me/sessions', requireUser, (c) => {
    const rows = db
      .prepare(
        `SELECT id_hash, kind, name, created_at, last_seen_at, ip_hint FROM sessions
         WHERE user_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(c.var.user.id) as {
      id_hash: string;
      kind: string;
      name: string | null;
      created_at: number;
      last_seen_at: number;
      ip_hint: string | null;
    }[];
    return c.json(
      rows.map((r) => ({
        // The stored hash, not the token: it names the session and cannot sign anyone in.
        id: r.id_hash,
        kind: r.kind,
        name: r.name,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        location: r.ip_hint,
        current: r.id_hash === c.var.user.sessionHash,
      })),
    );
  });

  app.delete('/me/sessions/:id', requireUser, (c) => {
    const id = c.req.param('id');
    // Only the user's own: another user's id matches nothing (SEC-11).
    const gone = db
      .prepare('DELETE FROM sessions WHERE id_hash = ? AND user_id = ?')
      .run(id, c.var.user.id).changes;
    if (!gone) return c.json({ error: 'not_found' }, 404);
    audit(db, now(), c.var.user.id, 'session.revoked');
    if (id === c.var.user.sessionHash) deleteCookie(c, SESSION_COOKIE, { secure: true, path: '/' });
    return c.json({ ok: true });
  });

  app.post('/me/sessions/revoke-others', requireUser, (c) => {
    const revoked = revokeOthers(db, c.var.user.id, c.var.user.sessionHash).changes;
    audit(db, now(), c.var.user.id, 'session.revoked_others', { revoked });
    return c.json({ ok: true, revoked });
  });

  // ---- two-factor (§4.5) ----
  app.post('/me/totp/start', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    if (userRow(user.id)?.totp_enabled) return c.json({ error: 'totp_already_on' }, 409);
    const refused = await reauth(c, b, false);
    if (refused) return refused;
    const secret = newTotpSecret();
    enrolling.set(user.id, { secret, expiresAt: now() + ENROL_TTL });
    return c.json({ otpauth: otpauthUri(user.username, secret), secret });
  });

  app.post('/me/totp/enable', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    const e = enrolling.get(user.id);
    if (!e || e.expiresAt <= now()) return c.json({ error: 'enrolment_expired' }, 409);
    const step = verifyTotp(e.secret, str(b.code, 16) ?? '', now(), null);
    if (step === null) return c.json({ error: 'bad_code' }, 400);
    enrolling.delete(user.id);
    db.prepare(
      'UPDATE users SET totp_secret_enc = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ?',
    ).run(
      sealer.seal(e.secret, { table: 'users', rowId: user.id, column: 'totp_secret_enc' }),
      step,
      user.id,
    );
    const codes = await storeRecoveryCodes(db, user.id);
    audit(db, now(), user.id, 'totp.enabled');
    return c.json({ recoveryCodes: codes });
  });

  app.post('/me/totp/disable', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    if (user.role === 'admin') return c.json({ error: 'admin_needs_totp' }, 403);
    const refused = await reauth(c, b, true);
    if (refused) return refused;
    db.transaction(() => {
      db.prepare(
        'UPDATE users SET totp_secret_enc = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
      ).run(user.id);
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
    })();
    audit(db, now(), user.id, 'totp.disabled');
    return c.json({ ok: true });
  });

  app.post('/me/recovery-codes', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    const refused = await reauth(c, b, true);
    if (refused) return refused;
    const codes = await storeRecoveryCodes(db, user.id);
    audit(db, now(), user.id, 'totp.recovery_codes_regenerated');
    return c.json({ recoveryCodes: codes });
  });

  // ---- deleting the account (§10, ACC-03): password + second factor; not the last admin ----
  app.delete('/me', requireUser, async (c) => {
    const b = await body(c);
    const user = c.var.user;
    if (isLastAdmin(db, user.id)) return c.json({ error: 'last_admin' }, 409);
    const refused = await reauth(c, b, !!userRow(user.id)?.totp_enabled);
    if (refused) return refused;
    revokeSession(db, user.sessionHash);
    deleteUser(db, user.id, now(), user.id);
    deleteCookie(c, SESSION_COOKIE, { secure: true, path: '/' });
    return c.json({ ok: true });
  });

  return app;
}
