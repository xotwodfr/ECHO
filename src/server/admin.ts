import { createHash, randomBytes } from 'node:crypto';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteUser, isLastAdmin } from './account.ts';
import { audit } from './audit.ts';
import { type AuthDeps, type AuthEnv, body, jsonObject } from './auth/routes.ts';
import { revokeOthers } from './auth/sessions.ts';
import type { Sealer } from './crypto.ts';
import type { Db } from './db/db.ts';

// Admin → Server settings (SETTINGS_AND_SECURITY.md §6.2, §6.3, §7.2): the Spicy Lyrics secret key,
// sealed in `server_settings`, write-only (the API says whether one is saved, never what it is),
// and read only by the server's lyric source; the Spotify app's Client ID (public in PKCE), its
// seats, its optional client secret (sealed, write-only; only for Spotify matching), the library
// matching switch, and the policy gates G1/G2 (PLAYBACK_ARCHITECTURE.md §4.6, both on by default).

const SPICY = { table: 'server_settings', rowId: 'lyrics.spicyKey', column: 'secret_enc' } as const;

/** The Spicy key, or null when none is saved. */
export function spicyKey(db: Db, sealer: Sealer): string | null {
  const row = db
    .prepare("SELECT secret_enc FROM server_settings WHERE key = 'lyrics.spicyKey'")
    .get() as { secret_enc: string | null } | undefined;
  return row?.secret_enc ? sealer.tryOpen(row.secret_enc, SPICY) : null;
}

const SPOTIFY_SECRET = {
  table: 'server_settings',
  rowId: 'spotify.clientSecret',
  column: 'secret_enc',
} as const;

/** The Spotify app's client secret (only for matching with Spotify's search), or null. */
export function spotifyClientSecret(db: Db, sealer: Sealer): string | null {
  const row = db
    .prepare("SELECT secret_enc FROM server_settings WHERE key = 'spotify.clientSecret'")
    .get() as { secret_enc: string | null } | undefined;
  return row?.secret_enc ? sealer.tryOpen(row.secret_enc, SPOTIFY_SECRET) : null;
}

/** Admin → Server → "Match the library with Spotify in the background" (on by default). */
export const matchLibrary = (db: Db) => setting(db, 'spotify.matchLibrary', true);

/** Development Mode allows 5 Spotify users per app (PLAYBACK_ARCHITECTURE.md §4.1). */
export const SPOTIFY_SEATS = 5;
const CLIENT_ID = /^[0-9a-f]{32}$/;
/** The settings PUT /admin/settings takes, by section; anything else is refused. */
const ADMIN_KEYS = {
  lyrics: ['spicyKey'],
  spotify: ['clientId', 'clientSecret', 'matchLibrary', 'gates'],
  auth: ['requireTotpForAll'],
};

export interface SpotifySettings {
  clientId: string | null;
  gates: { artPalette: boolean; syncedLyrics: boolean };
}

function setting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM server_settings WHERE key = ?').get(key) as
    | { value_json: string | null }
    | undefined;
  return row?.value_json ? (JSON.parse(row.value_json) as T) : fallback;
}

function putSetting(db: Db, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO server_settings (key, value_json) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(value));
}

/** "Require TOTP for all" (§4.2, §7.2): users without it must enrol before anything else. */
export const requireTotpForAll = (db: Db) => setting(db, 'auth.requireTotpForAll', false);

export const INVITE_TTL = 72 * 3_600_000;
export const inviteHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function spotifySettings(db: Db): SpotifySettings {
  return {
    clientId: setting<string | null>(db, 'spotify.clientId', null),
    gates: {
      artPalette: setting(db, 'spotify.gates.artPalette', true),
      syncedLyrics: setting(db, 'spotify.gates.syncedLyrics', true),
    },
  };
}

/** Users with a Spotify connection: each takes one of the app's seats. */
export const spotifySeatsUsed = (db: Db) =>
  db.prepare("SELECT COUNT(*) FROM connections WHERE provider = 'spotify'").pluck().get() as number;

export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
};

export function adminRoutes(deps: AuthDeps, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();
  const view = () => ({
    lyrics: { spicyKeySaved: spicyKey(deps.db, deps.sealer) !== null },
    auth: { requireTotpForAll: requireTotpForAll(deps.db) },
    spotify: {
      ...spotifySettings(deps.db),
      seats: { used: spotifySeatsUsed(deps.db), max: SPOTIFY_SEATS },
      clientSecretSaved: spotifyClientSecret(deps.db, deps.sealer) !== null,
      matchLibrary: matchLibrary(deps.db),
    },
  });

  app.get('/admin/settings', requireUser, requireAdmin, (c) => c.json(view()));

  app.put('/admin/settings', requireUser, requireAdmin, async (c: Context<AuthEnv>) => {
    const b: {
      lyrics?: { spicyKey?: unknown };
      spotify?: {
        clientId?: unknown;
        clientSecret?: unknown;
        matchLibrary?: unknown;
        gates?: { artPalette?: unknown; syncedLyrics?: unknown };
      };
      auth?: { requireTotpForAll?: unknown };
    } | null = await jsonObject(c);
    if (!b) return c.json({ error: 'bad_settings' }, 400);
    // Only known settings: an unknown one (a typo, a setting this version lacks) is refused, never
    // silently ignored.
    for (const [section, keys] of Object.entries(b))
      if (
        !Object.hasOwn(ADMIN_KEYS, section) ||
        !keys ||
        typeof keys !== 'object' ||
        Object.keys(keys).some((k) => !ADMIN_KEYS[section as keyof typeof ADMIN_KEYS].includes(k))
      )
        return c.json({ error: 'bad_settings', detail: `unknown setting in ${section}` }, 400);
    // Everything is validated before anything is written.
    const sp = b.spotify;
    const id = sp?.clientId;
    if (id !== undefined && id !== null && (typeof id !== 'string' || !CLIENT_ID.test(id.trim())))
      return c.json({ error: 'bad_client_id', detail: '32 hexadecimal characters' }, 400);
    const gates = Object.entries(sp?.gates ?? {});
    if (
      gates.some(([k, v]) => !['artPalette', 'syncedLyrics'].includes(k) || typeof v !== 'boolean')
    )
      return c.json({ error: 'bad_gate' }, 400);
    const secret = sp?.clientSecret;
    if (
      secret !== undefined &&
      secret !== null &&
      (typeof secret !== 'string' || !CLIENT_ID.test(secret.trim()))
    )
      return c.json({ error: 'bad_client_secret', detail: '32 hexadecimal characters' }, 400);
    const match = sp?.matchLibrary;
    if (match !== undefined && typeof match !== 'boolean')
      return c.json({ error: 'bad_setting' }, 400);
    const totpAll = b.auth?.requireTotpForAll;
    if (totpAll !== undefined && typeof totpAll !== 'boolean')
      return c.json({ error: 'bad_setting' }, 400);
    const key = b.lyrics?.spicyKey;
    if (key !== undefined) {
      if (key !== null && (typeof key !== 'string' || !/^sl_sk_[\w-]{8,200}$/.test(key.trim())))
        return c.json({ error: 'bad_spicy_key', detail: 'A secret key starts with sl_sk_' }, 400);
      deps.db
        .prepare(
          `INSERT INTO server_settings (key, value_json, secret_enc) VALUES ('lyrics.spicyKey', NULL, ?)
           ON CONFLICT (key) DO UPDATE SET secret_enc = excluded.secret_enc`,
        )
        .run(key === null ? null : deps.sealer.seal(key.trim(), SPICY));
      audit(
        deps.db,
        deps.now(),
        c.var.user.id,
        key === null ? 'admin.spicy_key_removed' : 'admin.spicy_key_set',
      );
    }
    if (id !== undefined) {
      putSetting(deps.db, 'spotify.clientId', typeof id === 'string' ? id.trim() : null);
      audit(deps.db, deps.now(), c.var.user.id, 'admin.spotify_client_id', {
        set: Boolean(id),
      });
    }
    if (secret !== undefined) {
      deps.db
        .prepare(
          `INSERT INTO server_settings (key, value_json, secret_enc) VALUES ('spotify.clientSecret', NULL, ?)
           ON CONFLICT (key) DO UPDATE SET secret_enc = excluded.secret_enc`,
        )
        .run(secret === null ? null : deps.sealer.seal(secret.trim(), SPOTIFY_SECRET));
      audit(deps.db, deps.now(), c.var.user.id, 'admin.spotify_client_secret', {
        set: secret !== null,
      });
    }
    if (typeof match === 'boolean') {
      putSetting(deps.db, 'spotify.matchLibrary', match);
      audit(deps.db, deps.now(), c.var.user.id, 'admin.spotify_match_library', { on: match });
    }
    for (const [k, v] of gates) {
      putSetting(deps.db, `spotify.gates.${k}`, v);
      audit(deps.db, deps.now(), c.var.user.id, 'admin.spotify_gate', { [k]: v });
    }
    if (typeof totpAll === 'boolean') {
      putSetting(deps.db, 'auth.requireTotpForAll', totpAll);
      audit(deps.db, deps.now(), c.var.user.id, 'admin.require_totp', { on: totpAll });
    }
    return c.json(view());
  });

  // ---- users (M8 task 3) ----
  const admin = [requireUser, requireAdmin] as const;
  const target = (id: string) =>
    deps.db
      .prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(Number(id)) as
      | { id: number; username: string; role: 'admin' | 'user'; disabled: number }
      | undefined;

  app.get('/admin/users', ...admin, (c) => {
    const rows = deps.db
      .prepare(
        `SELECT u.id, u.username, u.role, u.disabled, u.totp_enabled, u.created_at,
           (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
           EXISTS (SELECT 1 FROM connections WHERE user_id = u.id AND provider = 'spotify') AS spotify,
           EXISTS (SELECT 1 FROM connections WHERE user_id = u.id AND provider = 'navidrome') AS navidrome
         FROM users u ORDER BY u.username`,
      )
      .all() as {
      id: number;
      username: string;
      role: string;
      disabled: number;
      totp_enabled: number;
      created_at: number;
      last_seen: number | null;
      spotify: number;
      navidrome: number;
    }[];
    const t = deps.now();
    return c.json(
      rows.map((r) => ({
        id: r.id,
        username: r.username,
        role: r.role,
        disabled: !!r.disabled,
        totpEnabled: !!r.totp_enabled,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen,
        lockedForMs: deps.limiter.lockedFor(r.username, t),
        connections: { navidrome: !!r.navidrome, spotify: !!r.spotify },
      })),
    );
  });

  app.patch('/admin/users/:id', ...admin, async (c: Context<AuthEnv>) => {
    const u = target(c.req.param('id') as string);
    if (!u) return c.json({ error: 'not_found' }, 404);
    const b: { role?: unknown; disabled?: unknown } | null = await jsonObject(c);
    if (!b) return c.json({ error: 'bad_user' }, 400);
    if (b.role !== undefined && b.role !== 'admin' && b.role !== 'user')
      return c.json({ error: 'bad_role' }, 400);
    if (b.disabled !== undefined && typeof b.disabled !== 'boolean')
      return c.json({ error: 'bad_user' }, 400);
    const demotes = b.role === 'user' || b.disabled === true;
    if (demotes && isLastAdmin(deps.db, u.id)) return c.json({ error: 'last_admin' }, 409);
    if (b.role === 'admin') {
      // An admin always has TOTP (§4.5): promotion waits until the user has enrolled.
      const totp = deps.db.prepare('SELECT totp_enabled FROM users WHERE id = ?').pluck().get(u.id);
      if (!totp) return c.json({ error: 'needs_totp' }, 409);
    }
    if (b.role) deps.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id);
    if (typeof b.disabled === 'boolean') {
      deps.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, u.id);
      if (b.disabled) revokeOthers(deps.db, u.id, null); // signed out everywhere
    }
    audit(deps.db, deps.now(), c.var.user.id, 'admin.user_changed', {
      userId: u.id,
      ...(b.role !== undefined && { role: b.role }),
      ...(b.disabled !== undefined && { disabled: b.disabled }),
    });
    return c.json({ ok: true });
  });

  app.post('/admin/users/:id/unlock', ...admin, (c) => {
    const u = target(c.req.param('id'));
    if (!u) return c.json({ error: 'not_found' }, 404);
    deps.limiter.unlock(u.username);
    audit(deps.db, deps.now(), c.var.user.id, 'admin.user_unlocked', { userId: u.id });
    return c.json({ ok: true });
  });

  app.delete('/admin/users/:id', ...admin, (c) => {
    const u = target(c.req.param('id'));
    if (!u) return c.json({ error: 'not_found' }, 404);
    // Their own account goes through Account → Delete (password + TOTP).
    if (u.id === c.var.user.id) return c.json({ error: 'use_account_deletion' }, 409);
    if (isLastAdmin(deps.db, u.id)) return c.json({ error: 'last_admin' }, 409);
    deleteUser(deps.db, u.id, deps.now(), c.var.user.id);
    return c.json({ ok: true });
  });

  // ---- invites (§4.2): single use, 72 h, stored hashed ----
  app.post('/admin/invites', ...admin, async (c: Context<AuthEnv>) => {
    const b: { username?: unknown } = await body(c);
    const username = typeof b.username === 'string' ? b.username.trim() : null;
    if (username !== null && username !== '' && !/^[\w.-]{1,64}$/.test(username))
      return c.json({ error: 'bad_username' }, 400);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = deps.now() + INVITE_TTL;
    deps.db
      .prepare(
        'INSERT INTO invites (token_hash, created_by, username, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(inviteHash(token), c.var.user.id, username || null, expiresAt);
    audit(deps.db, deps.now(), c.var.user.id, 'admin.invite_created');
    // The token is shown once, as a link the admin sends out of band.
    return c.json({ token, path: `/invite#${token}`, expiresAt }, 201);
  });

  app.get('/admin/invites', ...admin, (c) => {
    const rows = deps.db
      .prepare(
        `SELECT token_hash, username, expires_at FROM invites
         WHERE used_by IS NULL AND expires_at > ? ORDER BY expires_at`,
      )
      .all(deps.now()) as { token_hash: string; username: string | null; expires_at: number }[];
    return c.json(
      rows.map((r) => ({
        id: r.token_hash.slice(0, 16),
        username: r.username,
        expiresAt: r.expires_at,
      })),
    );
  });

  app.delete('/admin/invites/:id', ...admin, (c) => {
    const id = c.req.param('id');
    if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: 'not_found' }, 404);
    const gone = deps.db
      .prepare('DELETE FROM invites WHERE substr(token_hash, 1, 16) = ? AND used_by IS NULL')
      .run(id).changes;
    if (!gone) return c.json({ error: 'not_found' }, 404);
    audit(deps.db, deps.now(), c.var.user.id, 'admin.invite_revoked');
    return c.json({ ok: true });
  });

  // ---- audit log viewer ----
  app.get('/admin/audit', ...admin, (c) => {
    const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const rows = deps.db
      .prepare(
        `SELECT a.id, a.at, a.event, a.detail, u.username FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`,
      )
      .all(Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit) as {
      id: number;
      at: number;
      event: string;
      detail: string | null;
      username: string | null;
    }[];
    return c.json(
      rows.map((r) => ({
        id: r.id,
        at: r.at,
        event: r.event,
        username: r.username,
        detail: r.detail ? JSON.parse(r.detail) : null,
      })),
    );
  });

  return app;
}
