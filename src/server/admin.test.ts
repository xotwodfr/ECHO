import { describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { call, testDeps } from './testing.ts';

// Admin → Server (SETTINGS_AND_SECURITY.md §7.2): the matching switch; the Spotify app, its seats
// and the policy gates went with Spotify playback.

function setup() {
  const t = testDeps();
  const db = t.deps.auth.db;
  const user = (name: string, role: string) => {
    const id = Number(
      db
        .prepare(
          'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, 0)',
        )
        .run(name, 'x', role).lastInsertRowid,
    );
    return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
  };
  return { t, db, admin: user('ada', 'admin'), bo: user('bo', 'user') };
}

describe('server settings', () => {
  it('defaults: library matching on', async () => {
    const { t, admin } = setup();
    const res = await call(t.app, 'GET', '/api/v1/admin/settings', undefined, admin.cookie);
    expect((await res.json()).spotify).toEqual({ matchLibrary: true });
  });

  it('an admin switches matching; unknown settings, even the removed Spotify app ones, are refused', async () => {
    const { t, db, admin, bo } = setup();
    const put = (body: unknown, who = admin) =>
      call(t.app, 'PUT', '/api/v1/admin/settings', body, who.cookie);
    expect((await put({ spotify: { matchLibrary: false } }, bo)).status).toBe(403);
    expect((await put({ spotify: { matchLibrary: 'off' } })).status).toBe(400);
    // QA 2026-10-28: unknown settings were accepted (200) and silently ignored.
    for (const body of [
      { foo: { bar: 1 } },
      { navidrome: { extraAllowedUrls: ['http://x'] } },
      { spotify: { clientId: 'a'.repeat(32) } },
      { spotify: { clientSecret: 'a'.repeat(32) } },
      { spotify: { gates: { artPalette: false } } },
      { auth: true },
    ])
      expect((await put(body)).status).toBe(400);
    expect(
      db.prepare("SELECT COUNT(*) FROM server_settings WHERE key LIKE 'spotify.%'").pluck().get(),
    ).toBe(0);

    const ok = await put({ spotify: { matchLibrary: false } });
    expect((await ok.json()).spotify).toEqual({ matchLibrary: false });
    expect(
      db.prepare("SELECT event FROM audit_log WHERE event LIKE 'admin.spotify%'").pluck().all(),
    ).toEqual(['admin.spotify_match_library']);
  });
});
