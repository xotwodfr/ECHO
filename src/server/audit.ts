import type { Db } from './db/db.ts';

// The audit log (SETTINGS_AND_SECURITY.md §4.4): logins, failures, lockouts, TOTP changes,
// session revocations, connection changes and admin actions. `detail` never holds a secret.

export function audit(
  db: Db,
  now: number,
  userId: number | null,
  event: string,
  detail?: Record<string, unknown>,
) {
  db.prepare('INSERT INTO audit_log (at, user_id, event, detail) VALUES (?, ?, ?, ?)').run(
    now,
    userId,
    event,
    detail ? JSON.stringify(detail) : null,
  );
}
