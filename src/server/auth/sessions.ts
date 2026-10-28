import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';

// Sessions and device tokens (SETTINGS_AND_SECURITY.md §4.6). The token is shown once (cookie or
// response body); only its SHA-256 is stored. Both kinds slide: each use pushes the expiry out, and
// an idle gap longer than the kind's idle limit ends it.

const DAY = 86_400_000;
export const SESSION_COOKIE = '__Host-echo_session';
export const DEVICE_PREFIX = 'echo_dt_';
const LIFETIME = {
  web: { slide: 30 * DAY, idle: 14 * DAY },
  device: { slide: 180 * DAY, idle: 60 * DAY },
} as const;
/** last_seen is written at most this often, so reading a session is not a write per request. */
const TOUCH_MS = 60_000;

export type SessionKind = keyof typeof LIFETIME;

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  sessionHash: string;
  kind: SessionKind;
  totpEnabled: boolean;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(
  db: Db,
  userId: number,
  kind: SessionKind,
  now: number,
  opts: { name?: string; ipHint?: string } = {},
) {
  const raw = randomBytes(32).toString('base64url');
  const token = kind === 'device' ? `${DEVICE_PREFIX}${raw}` : raw;
  db.prepare(
    `INSERT INTO sessions (id_hash, user_id, kind, name, created_at, last_seen_at, expires_at, ip_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    kind,
    opts.name ?? null,
    now,
    now,
    now + LIFETIME[kind].slide,
    opts.ipHint ?? null,
  );
  return token;
}

/** The user behind `token`, sliding its expiry; null if unknown, expired, idle too long or disabled. */
export function resolveSession(db: Db, token: string, now: number): SessionUser | null {
  const h = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.kind, s.last_seen_at, s.expires_at, u.id, u.username, u.role, u.disabled, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .get(h) as
    | {
        kind: SessionKind;
        last_seen_at: number;
        expires_at: number;
        id: number;
        username: string;
        role: 'admin' | 'user';
        disabled: number;
        totp_enabled: number;
      }
    | undefined;
  if (!row) return null;
  const life = LIFETIME[row.kind];
  if (row.disabled || now >= row.expires_at || now - row.last_seen_at >= life.idle) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(h);
    return null;
  }
  if (now - row.last_seen_at >= TOUCH_MS)
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(
      now,
      now + life.slide,
      h,
    );
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    sessionHash: h,
    kind: row.kind,
    totpEnabled: !!row.totp_enabled,
  };
}

/** Sessions that can no longer sign anyone in (expired, or idle too long), deleted; the count. */
export const pruneSessions = (db: Db, now: number) =>
  db
    .prepare(
      `DELETE FROM sessions WHERE expires_at <= ?
         OR (kind = 'web' AND last_seen_at <= ?) OR (kind = 'device' AND last_seen_at <= ?)`,
    )
    .run(now, now - LIFETIME.web.idle, now - LIFETIME.device.idle).changes;

export const revokeSession = (db: Db, sessionHash: string) =>
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sessionHash);

/** Every session and device of a user but `keep` (password change, "sign out everywhere else"). */
export const revokeOthers = (db: Db, userId: number, keep: string | null) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash IS NOT ?').run(userId, keep);
