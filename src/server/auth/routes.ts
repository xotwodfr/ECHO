import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { audit } from '../audit.ts';
import type { Sealer } from '../crypto.ts';
import type { Db } from '../db/db.ts';
import type { Vars } from '../http.ts';
import {
  CODE_PARAMS,
  DUMMY_HASH,
  hashSecret,
  needsRehash,
  passwordProblem,
  verifySecret,
} from './password.ts';
import type { LoginLimiter } from './ratelimit.ts';
import {
  createSession,
  resolveSession,
  revokeSession,
  SESSION_COOKIE,
  type SessionUser,
} from './sessions.ts';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp.ts';

// Accounts and authentication (SETTINGS_AND_SECURITY.md §4): the one-time setup of the admin with
// mandatory TOTP, login with an optional TOTP step, logout, and `requireUser` for everything else.

export interface AuthDeps {
  db: Db;
  sealer: Sealer;
  limiter: LoginLimiter;
  now: () => number;
  setup: SetupState;
}

/** The first-start setup token (§4.1): 32 random bytes, 30 min, while no admin exists. */
export interface SetupState {
  token: string | null;
  expiresAt: number;
  pending: { username: string; hash: string; secret: string } | null;
}

export type AuthEnv = { Variables: Vars & { user: SessionUser } };

const SETUP_TTL = 30 * 60_000;
const CHALLENGE_TTL = 5 * 60_000;
const GENERIC = { error: 'Username or password is incorrect' };
const RECOVERY = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/;

export const hasAdmin = (db: Db) =>
  !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();

/** A fresh setup token if no admin exists yet (printed to the log by the caller), else null. */
export function startSetup(deps: Pick<AuthDeps, 'db' | 'now' | 'setup'>) {
  if (hasAdmin(deps.db)) return null;
  deps.setup.token = randomBytes(32).toString('base64url');
  deps.setup.expiresAt = deps.now() + SETUP_TTL;
  deps.setup.pending = null;
  return deps.setup.token;
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 10 single-use recovery codes, `xxxx-xxxx-xxxx` from an unambiguous alphabet. */
function newRecoveryCodes() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () =>
    [0, 1, 2]
      .map(() => [...randomBytes(4)].map((b) => alphabet[b % alphabet.length]).join(''))
      .join('-'),
  );
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const str = (v: unknown, max = 512) => (typeof v === 'string' && v.length <= max ? v : null);

function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 86_400,
  });
}

/** The signed-in user (cookie or bearer device token), or 401. */
export function requireUser(deps: AuthDeps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const bearer = c.req.header('authorization')?.match(/^Bearer (echo_dt_[\w-]+)$/)?.[1];
    const token = bearer ?? getCookie(c, SESSION_COOKIE);
    const user = token ? resolveSession(deps.db, token, deps.now()) : null;
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('user', user);
    await next();
  };
}

export function authRoutes(deps: AuthDeps) {
  const { db, sealer, limiter, now } = deps;
  const app = new Hono<{ Variables: Vars }>();
  const challenges = new Map<
    string,
    { userId: number; username: string; expiresAt: number; tries: number }
  >();

  // ---- first start (§4.1) ----

  const setupOpen = (token: unknown) =>
    typeof token === 'string' &&
    !!deps.setup.token &&
    now() < deps.setup.expiresAt &&
    !hasAdmin(db) &&
    sameToken(token, deps.setup.token);

  app.get('/setup', (c) => c.json({ open: !hasAdmin(db) }, hasAdmin(db) ? 404 : 200));

  app.post('/setup', async (c) => {
    const b = await body(c);
    if (!setupOpen(b.token)) return c.json({ error: 'not_found' }, 404);
    const username = str(b.username, 64)?.trim();
    const password = str(b.password, 1024);
    if (!username || !/^[\w.-]{1,64}$/.test(username))
      return c.json({ error: 'bad_username' }, 400);
    const problem = password === null ? 'required' : passwordProblem(password);
    if (problem || password === null)
      return c.json({ error: 'bad_password', detail: problem }, 400);
    const secret = newTotpSecret();
    deps.setup.pending = { username, hash: await hashSecret(password), secret };
    return c.json({ otpauth: otpauthUri(username, secret), secret });
  });

  app.post('/setup/totp', async (c) => {
    const b = await body(c);
    const p = deps.setup.pending;
    if (!setupOpen(b.token) || !p) return c.json({ error: 'not_found' }, 404);
    const step = verifyTotp(p.secret, str(b.code, 16) ?? '', now(), null);
    if (step === null) return c.json({ error: 'bad_code' }, 400);
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map((code) => hashSecret(code, CODE_PARAMS)));
    const id = db.transaction(() => {
      const uid = Number(
        db
          .prepare(
            `INSERT INTO users (username, password_hash, role, totp_enabled, totp_last_step, created_at)
             VALUES (?, ?, 'admin', 1, ?, ?)`,
          )
          .run(p.username, p.hash, step, now()).lastInsertRowid,
      );
      db.prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?').run(
        sealer.seal(p.secret, { table: 'users', rowId: uid, column: 'totp_secret_enc' }),
        uid,
      );
      const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
      for (const h of hashes) ins.run(uid, h);
      return uid;
    })();
    deps.setup.token = null;
    deps.setup.pending = null;
    audit(db, now(), id, 'setup.admin_created');
    setSessionCookie(c, createSession(db, id, 'web', now(), { ipHint: ipHint(c.var.ip) }));
    return c.json({ recoveryCodes: codes });
  });

  // ---- login (§4.4) ----

  app.post('/auth/login', async (c) => {
    const b = await body(c);
    const username = str(b.username, 64)?.trim() ?? '';
    const password = str(b.password, 1024) ?? '';
    const t = now();
    if (!limiter.ipAllows(c.var.ip, t)) return c.json({ error: 'rate_limited' }, 429);
    if (limiter.lockedFor(username, t)) {
      await verifySecret(password, await DUMMY_HASH); // same timing as a real check
      return c.json(GENERIC, 401);
    }
    const user = db
      .prepare('SELECT id, password_hash, totp_enabled, disabled FROM users WHERE username = ?')
      .get(username) as
      | { id: number; password_hash: string; totp_enabled: number; disabled: number }
      | undefined;
    const ok = await verifySecret(password, user?.password_hash ?? (await DUMMY_HASH));
    if (!user || !ok || user.disabled) {
      if (limiter.fail(username, t)) audit(db, t, user?.id ?? null, 'login.locked', { username });
      audit(db, t, user?.id ?? null, 'login.failed', { username, ip: ipHint(c.var.ip) });
      return c.json(GENERIC, 401);
    }
    limiter.succeed(username);
    if (needsRehash(user.password_hash))
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        await hashSecret(password),
        user.id,
      );
    if (user.totp_enabled) {
      const challenge = randomBytes(32).toString('base64url');
      challenges.set(challenge, {
        userId: user.id,
        username,
        expiresAt: t + CHALLENGE_TTL,
        tries: 0,
      });
      return c.json({ totpRequired: true, challenge });
    }
    audit(db, t, user.id, 'login.ok');
    setSessionCookie(c, createSession(db, user.id, 'web', t, { ipHint: ipHint(c.var.ip) }));
    return c.json({ totpRequired: false });
  });

  app.post('/auth/totp', async (c) => {
    const b = await body(c);
    const t = now();
    if (!limiter.ipAllows(c.var.ip, t)) return c.json({ error: 'rate_limited' }, 429);
    const key = str(b.challenge, 64) ?? '';
    const ch = challenges.get(key);
    // A lockout (from passwords or from second factors) also ends challenges already issued.
    if (!ch || t >= ch.expiresAt || ch.tries >= 5 || limiter.lockedFor(ch.username, t)) {
      challenges.delete(key);
      return c.json({ error: 'challenge_expired' }, 401);
    }
    ch.tries++;
    const code = (str(b.code, 32) ?? '').trim().toLowerCase();
    const u = db
      .prepare('SELECT totp_secret_enc, totp_last_step FROM users WHERE id = ?')
      .get(ch.userId) as { totp_secret_enc: string; totp_last_step: number | null } | undefined;
    if (!u) return c.json({ error: 'challenge_expired' }, 401);
    let ok = false;
    if (/^\d{6}$/.test(code)) {
      const secret = sealer.open(u.totp_secret_enc, {
        table: 'users',
        rowId: ch.userId,
        column: 'totp_secret_enc',
      });
      const step = verifyTotp(secret, code, t, u.totp_last_step);
      // Recorded atomically: of two concurrent requests with the same code, one wins.
      ok =
        step !== null &&
        db
          .prepare(
            'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
          )
          .run(step, ch.userId, step).changes === 1;
    } else if (RECOVERY.test(code)) {
      const rows = db
        .prepare(
          'SELECT rowid, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL',
        )
        .all(ch.userId) as { rowid: number; code_hash: string }[];
      for (const r of rows)
        if (await verifySecret(code, r.code_hash)) {
          // Spent atomically: a concurrent request with the same code finds it used.
          ok =
            db
              .prepare('UPDATE recovery_codes SET used_at = ? WHERE rowid = ? AND used_at IS NULL')
              .run(t, r.rowid).changes === 1;
          if (ok) audit(db, t, ch.userId, 'login.recovery_code_used');
          break;
        }
    }
    if (!ok) {
      // Counted per account, apart from passwords: a correct password does not reset it, so new
      // challenges do not buy new guesses.
      if (limiter.failSecond(ch.username, t))
        audit(db, t, ch.userId, 'login.locked', { factor: 'totp' });
      audit(db, t, ch.userId, 'login.totp_failed');
      return c.json({ error: 'bad_code' }, 401);
    }
    limiter.succeedSecond(ch.username);
    challenges.delete(key);
    audit(db, t, ch.userId, 'login.ok');
    setSessionCookie(c, createSession(db, ch.userId, 'web', t, { ipHint: ipHint(c.var.ip) }));
    return c.json({ ok: true });
  });

  app.post('/auth/logout', requireUser(deps), (c) => {
    const user = (c as unknown as Context<AuthEnv>).var.user;
    revokeSession(db, user.sessionHash);
    audit(db, now(), user.id, 'logout');
    deleteCookie(c, SESSION_COOKIE, { secure: true, path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', requireUser(deps), (c) => {
    const { username, role } = (c as unknown as Context<AuthEnv>).var.user;
    return c.json({ username, role });
  });

  return app;
}

/** An approximate location for the sessions list: the IPv4 /24 or IPv6 /48 (§4.6), never the full IP. */
export function ipHint(ip: string) {
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.0/24`;
  const parts = ip.split(':');
  return parts.length > 3 ? `${parts.slice(0, 3).join(':')}::/48` : 'unknown';
}
