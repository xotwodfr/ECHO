import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { audit } from './audit.ts';
import type { AuthEnv } from './auth/routes.ts';
import type { Sealer } from './crypto.ts';
import type { Db } from './db/db.ts';

// Admin → Server settings (SETTINGS_AND_SECURITY.md §6.2, §6.3, §7.2): the Spicy Lyrics secret key,
// sealed in `server_settings`, write-only (the API says whether one is saved, never what it is),
// and read only by the server's lyric source; the Spotify app's Client ID (public in PKCE), its
// seats, and the policy gates G1/G2 (PLAYBACK_ARCHITECTURE.md §4.6, both on by default).

const SPICY = { table: 'server_settings', rowId: 'lyrics.spicyKey', column: 'secret_enc' } as const;

/** The Spicy key, or null when none is saved. */
export function spicyKey(db: Db, sealer: Sealer): string | null {
  const row = db
    .prepare("SELECT secret_enc FROM server_settings WHERE key = 'lyrics.spicyKey'")
    .get() as { secret_enc: string | null } | undefined;
  return row?.secret_enc ? sealer.open(row.secret_enc, SPICY) : null;
}

/** Development Mode allows 5 Spotify users per app (PLAYBACK_ARCHITECTURE.md §4.1). */
export const SPOTIFY_SEATS = 5;
const CLIENT_ID = /^[0-9a-f]{32}$/;

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

export function adminRoutes(
  deps: { db: Db; sealer: Sealer; now: () => number },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const app = new Hono<AuthEnv>();
  const view = () => ({
    lyrics: { spicyKeySaved: spicyKey(deps.db, deps.sealer) !== null },
    spotify: {
      ...spotifySettings(deps.db),
      seats: { used: spotifySeatsUsed(deps.db), max: SPOTIFY_SEATS },
    },
  });

  app.get('/admin/settings', requireUser, requireAdmin, (c) => c.json(view()));

  app.put('/admin/settings', requireUser, requireAdmin, async (c: Context<AuthEnv>) => {
    let b: {
      lyrics?: { spicyKey?: unknown };
      spotify?: { clientId?: unknown; gates?: { artPalette?: unknown; syncedLyrics?: unknown } };
    };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ error: 'bad_settings' }, 400);
    }
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
    for (const [k, v] of gates) {
      putSetting(deps.db, `spotify.gates.${k}`, v);
      audit(deps.db, deps.now(), c.var.user.id, 'admin.spotify_gate', { [k]: v });
    }
    return c.json(view());
  });

  return app;
}
