import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backup, nightlyBackup, rotate, verify } from './admin-cli.ts';
import { startSetup } from './auth/routes.ts';
import { fromBase32, hotp, stepAt } from './auth/totp.ts';
import { createSealer } from './crypto.ts';
import { openDb } from './db/db.ts';
import { createApp } from './index.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { call, cookieOf, testDeps } from './testing.ts';

// DEP-03 (IMPLEMENTATION_PLAN.md M8 task 10) as an automated drill: back up, restore on a fresh
// "container" with the master key (everything works) and without it (connections need re-entry,
// sign-in still works, nothing errors); then rotate the master key.

const PASSWORD = 'correct horse battery staple';
let mock: MockSubsonic;
beforeAll(async () => {
  mock = await startMockSubsonic({});
});
afterAll(() => mock.close());

async function populated() {
  const dir = mkdtempSync(join(tmpdir(), 'echo-drill-'));
  const key = randomBytes(32);
  const t = testDeps();
  const db = openDb(join(dir, 'echo.db'));
  const deps = { ...t.deps, auth: { ...t.deps.auth, db, sealer: createSealer(key) } };
  deps.navidrome = { ...deps.navidrome, db, sealer: deps.auth.sealer, defaultUrl: mock.url };
  deps.lyrics = { ...deps.lyrics, db };
  deps.spotify = { ...deps.spotify, db, sealer: deps.auth.sealer };
  const app = createApp(deps);
  const token = startSetup(deps.auth) as string;
  const s1 = await call(app, 'POST', '/api/v1/setup', {
    token,
    username: 'ada',
    password: PASSWORD,
  });
  const { secret } = (await s1.json()) as { secret: string };
  const s2 = await call(app, 'POST', '/api/v1/setup/totp', {
    token,
    code: hotp(fromBase32(secret), stepAt(t.clock.t)),
  });
  const { recoveryCodes } = (await s2.json()) as { recoveryCodes: string[] };
  const admin = cookieOf(s2);
  await call(
    app,
    'PUT',
    '/api/v1/me/connections/navidrome',
    { username: 'ada', password: 'navidrome-pass' },
    admin,
  );
  await call(
    app,
    'PUT',
    '/api/v1/admin/settings',
    { lyrics: { spicyKey: ['sl', 'sk', 'drill12345'].join('_') } },
    admin,
  );
  await call(
    app,
    'PUT',
    '/api/v1/me/queue',
    { queue: null, positionMs: 0, baseUpdatedAt: 0 },
    admin,
  );
  return { dir, key, db, t, recoveryCodes };
}

/** A fresh server on the restored database, with `key` as its master key. */
function serverOn(file: string, key: Buffer) {
  const t = testDeps();
  const db = openDb(file);
  const sealer = createSealer(key);
  const deps = { ...t.deps, auth: { ...t.deps.auth, db, sealer } };
  deps.navidrome = { ...deps.navidrome, db, sealer, defaultUrl: mock.url };
  deps.lyrics = { ...deps.lyrics, db };
  deps.spotify = { ...deps.spotify, db, sealer };
  return { app: createApp(deps), db, sealer, t };
}

async function signIn(app: ReturnType<typeof createApp>, second: string) {
  const r = await call(app, 'POST', '/api/v1/auth/login', { username: 'ada', password: PASSWORD });
  const { challenge } = (await r.json()) as { challenge: string };
  const ok = await call(app, 'POST', '/api/v1/auth/totp', { challenge, code: second });
  return { status: ok.status, cookie: cookieOf(ok) };
}

describe('backup and restore drill (DEP-03)', () => {
  it('restored with the key: users, connections and settings all work', async () => {
    const p = await populated();
    const file = backup(p.db, join(p.dir, 'backups', 'echo.db'));
    expect(() => backup(p.db, file)).toThrow(/exists/);
    const s = serverOn(file, p.key);
    expect(verify(s.db, s.sealer)).toEqual({ total: 3, unreadable: [] });
    const { status, cookie } = await signIn(s.app, p.recoveryCodes[0] as string);
    expect(status).toBe(200);
    const nd = await (
      await call(s.app, 'GET', '/api/v1/me/connections/navidrome', undefined, cookie)
    ).json();
    expect(nd).toMatchObject({ connected: true });
    const albums = await call(
      s.app,
      'GET',
      '/api/v1/navidrome/rest/getAlbumList2?type=newest',
      undefined,
      cookie,
    );
    expect(albums.status).toBe(200);
    expect(
      (await (await call(s.app, 'GET', '/api/v1/admin/settings', undefined, cookie)).json()).lyrics
        .spicyKeySaved,
    ).toBe(true);
  });

  it('restored without the key: connections need re-entry, sign-in still works, nothing errors', async () => {
    const p = await populated();
    const file = backup(p.db, join(p.dir, 'b.db'));
    const s = serverOn(file, randomBytes(32));
    expect(verify(s.db, s.sealer).unreadable).toHaveLength(3);
    // The TOTP secret is unreadable; a recovery code (hashed, not sealed) signs in.
    const { status, cookie } = await signIn(s.app, p.recoveryCodes[1] as string);
    expect(status).toBe(200);
    const nd = await (
      await call(s.app, 'GET', '/api/v1/me/connections/navidrome', undefined, cookie)
    ).json();
    expect(nd).toMatchObject({ connected: false, needsReentry: true, username: 'ada' });
    expect(
      (await call(s.app, 'GET', '/api/v1/navidrome/rest/ping', undefined, cookie)).status,
    ).toBe(409);
    expect((await call(s.app, 'GET', '/api/v1/me/queue', undefined, cookie)).status).toBe(200);
    // Re-entering the connection works; so does enrolling TOTP again.
    const again = await call(
      s.app,
      'PUT',
      '/api/v1/me/connections/navidrome',
      { username: 'ada', password: 'navidrome-pass' },
      cookie,
    );
    expect(again.status).toBe(200);
    // Replacing the unreadable TOTP needs a second factor as well: password alone is refused.
    const totpStart = (b: object) => call(s.app, 'POST', '/api/v1/me/totp/start', b, cookie);
    expect((await totpStart({ password: PASSWORD })).status).toBe(403);
    expect((await totpStart({ password: PASSWORD, code: p.recoveryCodes[2] })).status).toBe(200);
  });

  it('rotating the master key re-seals everything; the old key opens nothing afterwards', async () => {
    const p = await populated();
    const next = randomBytes(32);
    const r = rotate(p.db, createSealer(p.key), createSealer(next));
    expect(r).toEqual({ resealed: 3, skipped: [] });
    expect(verify(p.db, createSealer(next))).toEqual({ total: 3, unreadable: [] });
    expect(verify(p.db, createSealer(p.key)).unreadable).toHaveLength(3);
  });
});

describe('nightly backup', () => {
  it('writes once per day, keeps the newest 7, and never prunes manual backups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-nightly-'));
    const db = openDb(join(dir, 'echo.db'));
    const out = join(dir, 'backups');
    backup(db, join(out, 'echo-manual.db'));
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
    expect(nightlyBackup(db, out, day(1)).made).toMatch(/echo-auto-2026-10-01\.db$/);
    expect(nightlyBackup(db, out, new Date(Date.UTC(2026, 9, 1, 23))).made).toBeNull(); // same day
    for (let d = 2; d <= 9; d++) nightlyBackup(db, out, day(d));
    const files = readdirSync(out).sort();
    expect(files).toHaveLength(8);
    expect(files[0]).toBe('echo-auto-2026-10-03.db');
    expect(files).toContain('echo-manual.db');
  });
});
