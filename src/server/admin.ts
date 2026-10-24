import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { audit } from './audit.ts';
import type { AuthEnv } from './auth/routes.ts';
import type { Sealer } from './crypto.ts';
import type { Db } from './db/db.ts';

// Admin → Server settings (SETTINGS_AND_SECURITY.md §6.3, §7.2). M6: the Spicy Lyrics secret key,
// sealed in `server_settings`, write-only (the API says whether one is saved, never what it is),
// and read only by the server's lyric source.

const SPICY = { table: 'server_settings', rowId: 'lyrics.spicyKey', column: 'secret_enc' } as const;

/** The Spicy key, or null when none is saved. */
export function spicyKey(db: Db, sealer: Sealer): string | null {
  const row = db
    .prepare("SELECT secret_enc FROM server_settings WHERE key = 'lyrics.spicyKey'")
    .get() as { secret_enc: string | null } | undefined;
  return row?.secret_enc ? sealer.open(row.secret_enc, SPICY) : null;
}

export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.var.user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
};

export function adminRoutes(
  deps: { db: Db; sealer: Sealer; now: () => number },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const app = new Hono<AuthEnv>();
  const saved = () => spicyKey(deps.db, deps.sealer) !== null;

  app.get('/admin/settings', requireUser, requireAdmin, (c) =>
    c.json({ lyrics: { spicyKeySaved: saved() } }),
  );

  app.put('/admin/settings', requireUser, requireAdmin, async (c: Context<AuthEnv>) => {
    let b: { lyrics?: { spicyKey?: unknown } };
    try {
      b = await c.req.json();
    } catch {
      return c.json({ error: 'bad_settings' }, 400);
    }
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
    return c.json({ lyrics: { spicyKeySaved: saved() } });
  });

  return app;
}
