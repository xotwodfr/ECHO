import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthEnv } from './auth/routes.ts';
import type { Db } from './db/db.ts';

// Per-user preferences that follow the user (SETTINGS_AND_SECURITY.md §7.1, `user_settings`,
// schema version 2). M7 has one: "Use my Spotify account to find lyrics for my library" (default
// off, LYRICS_INTEGRATION.md §4.3). M8 adds the rest; unknown keys are refused, never stored.

export interface UserSettings {
  version: 2;
  lyrics: { useSpotifyForLookup: boolean };
}

const DEFAULTS: UserSettings = { version: 2, lyrics: { useSpotifyForLookup: false } };

export function userSettings(db: Db, userId: number): UserSettings {
  const row = db.prepare('SELECT json FROM user_settings WHERE user_id = ?').get(userId) as
    | { json: string }
    | undefined;
  const saved = row ? (JSON.parse(row.json) as Partial<UserSettings>) : {};
  return { ...DEFAULTS, lyrics: { ...DEFAULTS.lyrics, ...saved.lyrics } };
}

export function settingsRoutes(db: Db, requireUser: MiddlewareHandler<AuthEnv>) {
  const app = new Hono<AuthEnv>();

  app.get('/me/settings', requireUser, (c) => c.json(userSettings(db, c.var.user.id)));

  app.put('/me/settings', requireUser, async (c) => {
    let b: { lyrics?: Record<string, unknown> } & Record<string, unknown>;
    try {
      b = await c.req.json();
    } catch {
      return c.json({ error: 'bad_settings' }, 400);
    }
    const bad =
      Object.keys(b).some((k) => k !== 'lyrics') ||
      Object.entries(b.lyrics ?? {}).some(
        ([k, v]) => k !== 'useSpotifyForLookup' || typeof v !== 'boolean',
      );
    if (bad) return c.json({ error: 'bad_settings' }, 400);
    const now = userSettings(db, c.var.user.id);
    const next: UserSettings = { ...now, lyrics: { ...now.lyrics, ...b.lyrics } };
    db.prepare(
      `INSERT INTO user_settings (user_id, json, version) VALUES (?, ?, 2)
       ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, version = 2`,
    ).run(c.var.user.id, JSON.stringify(next));
    return c.json(next);
  });

  return app;
}
