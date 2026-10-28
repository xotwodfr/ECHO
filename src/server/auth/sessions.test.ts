import { describe, expect, it } from 'vitest';
import { testDeps } from '../testing.ts';
import { createLoginLimiter } from './ratelimit.ts';
import { createSession, pruneSessions } from './sessions.ts';

// ON-DB-3: what can never sign anyone in again is not kept. Expired or idle sessions were deleted
// only when presented, and listed under Account → Sessions for ever; the limiter's per-address
// entries were dropped only when the same address came back.

const DAY = 86_400_000;

describe('retention', () => {
  it('sessions past their expiry or idle limit are deleted; live ones stay', () => {
    const { deps } = testDeps();
    const db = deps.auth.db;
    const uid = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
        )
        .run().lastInsertRowid,
    );
    createSession(db, uid, 'web', 0);
    createSession(db, uid, 'device', 0);
    const kinds = () => db.prepare('SELECT kind FROM sessions ORDER BY kind').pluck().all();
    expect(pruneSessions(db, 13 * DAY)).toBe(0);
    expect(pruneSessions(db, 15 * DAY)).toBe(1); // web: 14 idle days
    expect(kinds()).toEqual(['device']);
    expect(pruneSessions(db, 61 * DAY)).toBe(1); // device: 60 idle days
    expect(kinds()).toEqual([]);
  });

  it('the login limiter forgets addresses after a quiet day', () => {
    const l = createLoginLimiter();
    for (let i = 0; i < 10; i++) l.ipAllows('203.0.113.9', 0);
    expect(l.ipAllows('203.0.113.9', 1000)).toBe(false);
    expect(l.sweep(DAY - 1)).toBe(0);
    expect(l.sweep(DAY + 1)).toBe(1);
  });
});
