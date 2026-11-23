import { createHash, randomBytes } from 'node:crypto';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { audit } from './audit.ts';
import { hashSecret, passwordProblem } from './auth/password.ts';
import { type AuthDeps, type AuthEnv, jsonObject, str } from './auth/routes.ts';
import { createSession } from './auth/sessions.ts';
import type { Db } from './db/db.ts';
import type { Vars } from './http.ts';

// Guest accounts: any signed-in user shows a one-time code as a QR code and picks how long the
// guest may stay (an hour, a day, a week). Someone with the ECHO app scans it and gets a guest
// account on that phone, signed in until the time is up, then deleted with everything it made.
// A guest listens to the inviter's library (its Navidrome connection is copied, read-only: the
// guest rules in auth/routes.ts keep it from writing); "Keep account" asks the inviter, or an
// admin, to make it a normal user under a name and password the guest chose.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** What a code may give: an hour, a day or a week. */
export const GUEST_DURATIONS = [HOUR, DAY, 7 * DAY] as const;
/** How long a code can be scanned: long enough to find the app, short enough that a photo is useless. */
export const CODE_TTL_MS = 10 * MIN;
const MAX_LIVE_CODES = 5;

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

interface GuestRow {
  user_id: number;
  username: string;
  invited_by: number | null;
  inviter: string | null;
  expires_at: number;
  created_at: number;
  keep_username: string | null;
  keep_requested_at: number | null;
}

/** Guests whose time is up, deleted with everything they made (sessions, plays, settings: cascades). */
export function sweepGuests(db: Db, now: number) {
  const gone = db
    .prepare('DELETE FROM users WHERE id IN (SELECT user_id FROM guests WHERE expires_at <= ?)')
    .run(now).changes;
  db.prepare('DELETE FROM guest_codes WHERE expires_at <= ?').run(now - DAY);
  return gone;
}

export function guestRoutes(
  deps: AuthDeps & { publicOrigin: string | null },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const { db, now, limiter } = deps;
  const app = new Hono<AuthEnv & { Variables: Vars }>();

  /** A live, unused code's row (the inviter's name with it), or null. */
  const codeRow = (code: unknown) => {
    const c = str(code, 64);
    if (!c || !/^[\w-]{16,64}$/.test(c)) return null;
    return (
      (db
        .prepare(
          `SELECT gc.code_hash, gc.created_by, gc.duration_ms, gc.expires_at, u.username AS inviter
           FROM guest_codes gc JOIN users u ON u.id = gc.created_by
           WHERE gc.code_hash = ? AND gc.used_by IS NULL AND gc.expires_at > ? AND u.disabled = 0`,
        )
        .get(hash(c), now()) as
        | {
            code_hash: string;
            created_by: number;
            duration_ms: number;
            expires_at: number;
            inviter: string;
          }
        | undefined) ?? null
    );
  };

  /** Show a QR code: a one-time code giving a guest `durationMs` (an hour, a day or a week). */
  app.post('/guests/codes', requireUser, async (c) => {
    const b = await jsonObject(c);
    const duration = Number(b?.durationMs);
    if (!GUEST_DURATIONS.includes(duration as (typeof GUEST_DURATIONS)[number]))
      return c.json({ error: 'bad_duration' }, 400);
    const t = now();
    const me = c.var.user.id;
    const live = db
      .prepare(
        'SELECT COUNT(*) FROM guest_codes WHERE created_by = ? AND used_by IS NULL AND expires_at > ?',
      )
      .pluck()
      .get(me, t) as number;
    if (live >= MAX_LIVE_CODES) return c.json({ error: 'too_many_codes' }, 429);
    const code = randomBytes(16).toString('base64url');
    db.prepare(
      `INSERT INTO guest_codes (code_hash, created_by, duration_ms, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(hash(code), me, duration, t + CODE_TTL_MS, t);
    audit(db, t, me, 'guest.code', { durationMs: duration });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        code,
        url: `${deps.publicOrigin ?? new URL(c.req.url).origin}/guest#${code}`,
        expiresAt: t + CODE_TTL_MS,
        durationMs: duration,
      },
      201,
    );
  });

  /** Before joining, the app shows whose pass it is and for how long (no sign-in; the code is the secret). */
  app.post('/guests/peek', async (c) => {
    if (!limiter.ipAllows(c.var.ip, now())) return c.json({ error: 'rate_limited' }, 429);
    const row = codeRow((await jsonObject(c))?.code);
    if (!row) return c.json({ error: 'bad_code' }, 404);
    return c.json({ invitedBy: row.inviter, durationMs: row.duration_ms });
  });

  /** Scanned: a guest account, a device token for this phone, its Navidrome as the inviter's (read-only). */
  app.post('/guests/redeem', async (c) => {
    const t = now();
    if (!limiter.ipAllows(c.var.ip, t)) return c.json({ error: 'rate_limited' }, 429);
    const b = await jsonObject(c);
    const name = str(b?.name, 64)?.trim() || 'Guest phone';
    const row = codeRow(b?.code);
    if (!row) return c.json({ error: 'bad_code' }, 404);
    const made = db.transaction(() => {
      // Once only: whoever marks it used first has it.
      const claimed = db
        .prepare('UPDATE guest_codes SET used_by = -1 WHERE code_hash = ? AND used_by IS NULL')
        .run(row.code_hash).changes;
      if (!claimed) return null;
      let username = '';
      do username = `guest-${randomBytes(3).toString('hex')}`;
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username));
      // No password signs in to a guest: the phone's device token is the only way in.
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, '!guest', 'user', ?)",
          )
          .run(username, t).lastInsertRowid,
      );
      const until = t + row.duration_ms;
      db.prepare(
        'INSERT INTO guests (user_id, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, row.created_by, until, t);
      db.prepare('UPDATE guest_codes SET used_by = ? WHERE code_hash = ?').run(id, row.code_hash);
      // The inviter's library, as the inviter sees it: its connection copied, the secret opened
      // for the inviter's row and sealed again for the guest's (secrets are bound to their row).
      const conn = db
        .prepare(
          "SELECT config_json, secret_enc, status FROM connections WHERE user_id = ? AND provider = 'navidrome'",
        )
        .get(row.created_by) as
        | { config_json: string; secret_enc: string | null; status: string }
        | undefined;
      if (conn) {
        const where = (uid: number) => ({
          table: 'connections',
          rowId: `${uid}|navidrome`,
          column: 'secret_enc',
        });
        const secret = conn.secret_enc
          ? deps.sealer.seal(deps.sealer.open(conn.secret_enc, where(row.created_by)), where(id))
          : null;
        db.prepare(
          `INSERT INTO connections (user_id, provider, config_json, secret_enc, status, updated_at)
           VALUES (?, 'navidrome', ?, ?, ?, ?)`,
        ).run(id, conn.config_json, secret, conn.status, t);
      }
      return { id, username, until };
    })();
    if (!made) return c.json({ error: 'bad_code' }, 404);
    const token = createSession(db, made.id, 'device', t, { name });
    audit(db, t, row.created_by, 'guest.joined', { guest: made.username });
    c.header('Cache-Control', 'no-store');
    return c.json(
      { token, username: made.username, expiresAt: made.until, invitedBy: row.inviter },
      201,
    );
  });

  /** The guest's own state: when it ends, who invited it, whether it asked to stay. null for a normal user. */
  app.get('/guests/me', requireUser, (c) => {
    const u = c.var.user;
    if (u.guestUntil === undefined) return c.json({ guest: null });
    const g = guestOf(u.id);
    return c.json({
      guest: g && {
        expiresAt: g.expires_at,
        invitedBy: g.inviter,
        keep: g.keep_username
          ? { username: g.keep_username, requestedAt: g.keep_requested_at }
          : null,
      },
    });
  });

  /** "Keep account": the name and password the guest would like; the inviter or an admin decides. */
  app.post('/guests/me/keep', requireUser, async (c) => {
    const u = c.var.user;
    if (u.guestUntil === undefined) return c.json({ error: 'not_a_guest' }, 400);
    const b = await jsonObject(c);
    const username = str(b?.username, 64)?.trim() ?? '';
    const password = str(b?.password, 1024) ?? '';
    if (!/^[\w.-]{1,64}$/.test(username) || /^guest-/i.test(username))
      return c.json({ error: 'bad_username' }, 400);
    if (taken(username, u.id)) return c.json({ error: 'username_taken' }, 409);
    const problem = passwordProblem(password);
    if (problem) return c.json({ error: 'weak_password', detail: problem }, 400);
    const t = now();
    db.prepare(
      'UPDATE guests SET keep_username = ?, keep_password_hash = ?, keep_requested_at = ? WHERE user_id = ?',
    ).run(username, await hashSecret(password), t, u.id);
    audit(db, t, u.id, 'guest.keep_requested', { username });
    return c.json({ ok: true });
  });

  /** The guests this user invited (all of them for an admin), with any request to stay. */
  app.get('/guests', requireUser, (c) => {
    const u = c.var.user;
    const rows = db
      .prepare(
        `SELECT g.*, u.username, i.username AS inviter FROM guests g
         JOIN users u ON u.id = g.user_id LEFT JOIN users i ON i.id = g.invited_by
         WHERE g.expires_at > ? AND (? = 'admin' OR g.invited_by = ?) ORDER BY g.created_at DESC`,
      )
      .all(now(), u.role, u.id) as GuestRow[];
    return c.json(
      rows.map((g) => ({
        id: g.user_id,
        username: g.username,
        invitedBy: g.inviter,
        createdAt: g.created_at,
        expiresAt: g.expires_at,
        keep: g.keep_username
          ? { username: g.keep_username, requestedAt: g.keep_requested_at }
          : null,
      })),
    );
  });

  /** The inviter's (or an admin's) guest, or a refusal. */
  const mine = (c: Context<AuthEnv>) => {
    const id = Number(c.req.param('id'));
    const g = Number.isInteger(id) ? guestOf(id) : null;
    const u = c.var.user;
    if (!g || g.expires_at <= now() || (u.role !== 'admin' && g.invited_by !== u.id)) return null;
    return g;
  };

  /** Approve a request to stay: the guest becomes a normal user under the name it chose. */
  app.post('/guests/:id/approve', requireUser, (c) => {
    const g = mine(c);
    if (!g) return c.json({ error: 'not_found' }, 404);
    const keep = db
      .prepare('SELECT keep_username, keep_password_hash FROM guests WHERE user_id = ?')
      .get(g.user_id) as { keep_username: string | null; keep_password_hash: string | null };
    if (!keep.keep_username || !keep.keep_password_hash)
      return c.json({ error: 'no_request' }, 409);
    if (taken(keep.keep_username, g.user_id)) return c.json({ error: 'username_taken' }, 409);
    const t = now();
    db.transaction(() => {
      db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(
        keep.keep_username,
        keep.keep_password_hash,
        g.user_id,
      );
      db.prepare('DELETE FROM guests WHERE user_id = ?').run(g.user_id);
      // A permanent account connects its own Navidrome: the inviter's credentials stay the inviter's.
      db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'navidrome'").run(
        g.user_id,
      );
    })();
    audit(db, t, c.var.user.id, 'guest.kept', { guest: g.username, as: keep.keep_username });
    return c.json({ ok: true, username: keep.keep_username });
  });

  /** End a guest's time now: signed out and deleted. */
  app.post('/guests/:id/end', requireUser, (c) => {
    const g = mine(c);
    if (!g) return c.json({ error: 'not_found' }, 404);
    db.prepare('DELETE FROM users WHERE id = ?').run(g.user_id);
    audit(db, now(), c.var.user.id, 'guest.ended', { guest: g.username });
    return c.json({ ok: true });
  });

  function guestOf(id: number) {
    return (
      (db
        .prepare(
          `SELECT g.*, u.username, i.username AS inviter FROM guests g JOIN users u ON u.id = g.user_id
           LEFT JOIN users i ON i.id = g.invited_by WHERE g.user_id = ?`,
        )
        .get(id) as GuestRow | undefined) ?? null
    );
  }

  /** A name another user has, or another guest has asked for. */
  function taken(username: string, self: number) {
    return !!db
      .prepare(
        `SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?
         UNION SELECT 1 FROM guests WHERE keep_username = ? COLLATE NOCASE AND user_id != ?`,
      )
      .get(username, self, username, self);
  }

  return app;
}
