import { describe, expect, it } from 'vitest';
import { migrate, openDb, SCHEMA_VERSION } from './db.ts';

describe('database (TECHNICAL_ARCHITECTURE.md §5.5)', () => {
  it('creates every table and records the schema version', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual([
      'audit_log',
      'connections',
      'invites',
      'plays',
      'queue_state',
      'recovery_codes',
      'server_settings',
      'sessions',
      'spotify_matches',
      'track_overrides',
      'user_settings',
      'users',
    ]);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('migrating again changes nothing; a newer schema is refused', () => {
    const db = openDb(':memory:');
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer ECHO/);
  });

  it('deleting a user removes their rows; usernames are unique regardless of case', () => {
    const db = openDb(':memory:');
    const id = db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('Ada', 'h', 'user', 0)",
      )
      .run().lastInsertRowid;
    db.prepare(
      "INSERT INTO sessions (id_hash, user_id, kind, created_at, last_seen_at, expires_at) VALUES ('s', ?, 'web', 0, 0, 1)",
    ).run(id);
    db.prepare("INSERT INTO queue_state (user_id, json, updated_at) VALUES (?, '{}', 0)").run(id);
    db.prepare("INSERT INTO audit_log (at, user_id, event) VALUES (0, ?, 'login')").run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    expect(db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM queue_state').pluck().get()).toBe(0);
    expect(db.prepare('SELECT user_id FROM audit_log').pluck().get()).toBeNull(); // kept, unlinked
    db.prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'h', 'user', 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ADA', 'h', 'user', 0)",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
