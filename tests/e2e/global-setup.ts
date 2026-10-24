import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { CSP_REPORTS } from '../../playwright.config.ts';

// Before the run: no CSP reports from an earlier one (SEC-08 checks this run's), and none of the
// users earlier runs made (the E2E database outlives runs; thousands of them slow the Admin list).
export default function globalSetup() {
  rmSync(CSP_REPORTS, { force: true });
  const file = join(tmpdir(), 'echo-e2e', 'data', 'echo.db');
  if (!existsSync(file)) return;
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  // Helper-made users have created_at 0; invitees and audit users carry their prefixes.
  db.prepare(
    "DELETE FROM users WHERE created_at = 0 OR username LIKE 'inv-%' OR username LIKE 'audit-%'",
  ).run();
  db.prepare('DELETE FROM audit_log WHERE user_id IS NULL').run();
  db.close();
}
