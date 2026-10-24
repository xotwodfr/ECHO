import { describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { call, testDeps } from './testing.ts';

// Admin → Server → Spotify (SETTINGS_AND_SECURITY.md §6.2, §7.2): Client ID, seats, gates G1/G2.

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

const ID = 'a'.repeat(32);

describe('Spotify server settings', () => {
  it('defaults: no Client ID or secret, both gates on, no seats used, matching on', async () => {
    const { t, admin } = setup();
    const res = await call(t.app, 'GET', '/api/v1/admin/settings', undefined, admin.cookie);
    expect((await res.json()).spotify).toEqual({
      clientId: null,
      gates: { artPalette: true, syncedLyrics: true },
      seats: { used: 0, max: 5 },
      clientSecretSaved: false,
      matchLibrary: true,
    });
  });

  it('an admin sets the Client ID and gates; a bad value changes nothing', async () => {
    const { t, db, admin, bo } = setup();
    const put = (body: unknown, who = admin) =>
      call(t.app, 'PUT', '/api/v1/admin/settings', body, who.cookie);
    expect((await put({ spotify: { clientId: ID } }, bo)).status).toBe(403);
    expect((await put({ spotify: { clientId: 'nope' } })).status).toBe(400);
    expect((await put({ spotify: { clientId: ID, gates: { artPalette: 'off' } } })).status).toBe(
      400,
    );
    expect((await put({ spotify: { gates: { other: true } } })).status).toBe(400);
    expect(
      db.prepare("SELECT COUNT(*) FROM server_settings WHERE key LIKE 'spotify.%'").pluck().get(),
    ).toBe(0);

    const ok = await put({ spotify: { clientId: ` ${ID} `, gates: { syncedLyrics: false } } });
    expect((await ok.json()).spotify).toMatchObject({
      clientId: ID,
      gates: { artPalette: true, syncedLyrics: false },
    });
    db.prepare(
      "INSERT INTO connections (user_id, provider, config_json, status, updated_at) VALUES (?, 'spotify', '{}', 'ok', 0)",
    ).run(bo.id);
    const after = await put({ spotify: { clientId: null } });
    expect((await after.json()).spotify).toMatchObject({ clientId: null, seats: { used: 1 } });
    expect(
      db.prepare("SELECT event FROM audit_log WHERE event LIKE 'admin.spotify%'").pluck().all(),
    ).toEqual(['admin.spotify_client_id', 'admin.spotify_gate', 'admin.spotify_client_id']);
  });
});
