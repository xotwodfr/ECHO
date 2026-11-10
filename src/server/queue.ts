import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';

// The queue follows the user (IMPLEMENTATION_PLAN.md M5 task 9; TECHNICAL_ARCHITECTURE.md §5.5):
// one JSON queue per user. Writes are compare-and-set on `updatedAt`, so a device writing over a
// newer queue from another device is told (409, with the newer queue) instead of silently winning.
// While a song plays only its position moves: PATCH saves that alone, under the same rule, so a
// player does not send its whole queue (up to 64 KB) every 15 s.
// A queue holding YouTube songs lives in its own slot (`/me/queue/youtube`), read by the web only:
// the Android app plays Navidrome alone and reads `/me/queue`.

const SLOTS = { '/me/queue': 'queue_state', '/me/queue/youtube': 'queue_state_youtube' } as const;

export function queueRoutes(
  deps: { db: Db; now: () => number },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const app = new Hono<AuthEnv>();

  for (const [path, table] of Object.entries(SLOTS)) {
    app.get(path, requireUser, (c) => read(c, table));
    app.put(path, requireUser, (c) => write(c, table));
    app.patch(path, requireUser, (c) => move(c, table));
  }

  function read(c: Context<AuthEnv>, table: string) {
    c.header('Cache-Control', 'no-store');
    const row = deps.db
      .prepare(`SELECT json, updated_at FROM ${table} WHERE user_id = ?`)
      .get(c.var.user.id) as { json: string; updated_at: number } | undefined;
    if (!row) return c.json({ queue: null, positionMs: 0, updatedAt: 0 });
    const { queue, positionMs } = JSON.parse(row.json) as { queue: unknown; positionMs: number };
    return c.json({ queue, positionMs, updatedAt: row.updated_at });
  }

  async function write(c: Context<AuthEnv>, table: string) {
    const b: { queue?: unknown; positionMs?: unknown; baseUpdatedAt?: unknown } | null =
      await jsonObject(c);
    if (
      !b ||
      typeof b.queue !== 'object' ||
      Array.isArray(b.queue) ||
      typeof b.baseUpdatedAt !== 'number'
    )
      return c.json({ error: 'bad_queue' }, 400);
    const positionMs = typeof b.positionMs === 'number' && b.positionMs >= 0 ? b.positionMs : 0;
    const id = c.var.user.id;
    const base = b.baseUpdatedAt;
    const result = deps.db.transaction(() => {
      const row = deps.db
        .prepare(`SELECT json, updated_at FROM ${table} WHERE user_id = ?`)
        .get(id) as { json: string; updated_at: number } | undefined;
      if (row && row.updated_at > base) return { conflict: row };
      // Strictly increasing, even for two writes in the same millisecond.
      const at = Math.max(deps.now(), (row?.updated_at ?? 0) + 1);
      deps.db
        .prepare(
          `INSERT INTO ${table} (user_id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        )
        .run(id, JSON.stringify({ queue: b.queue, positionMs }), at);
      return { updatedAt: at };
    })();
    if ('conflict' in result && result.conflict) return conflict(c, result.conflict);
    return c.json(result);
  }

  function conflict(c: Context<AuthEnv>, row: { json: string; updated_at: number }) {
    const { queue, positionMs } = JSON.parse(row.json) as { queue: unknown; positionMs: number };
    return c.json(
      { error: 'changed_elsewhere', queue, positionMs, updatedAt: row.updated_at },
      409,
    );
  }

  /** The position alone, into the queue this device last saw; 404 when nothing is saved. */
  async function move(c: Context<AuthEnv>, table: string) {
    const b: { positionMs?: unknown; baseUpdatedAt?: unknown } | null = await jsonObject(c);
    if (
      !b ||
      typeof b.positionMs !== 'number' ||
      !(b.positionMs >= 0) ||
      typeof b.baseUpdatedAt !== 'number'
    )
      return c.json({ error: 'bad_queue' }, 400);
    const { positionMs, baseUpdatedAt: base } = b;
    const id = c.var.user.id;
    const result = deps.db.transaction(() => {
      const row = deps.db
        .prepare(`SELECT json, updated_at FROM ${table} WHERE user_id = ?`)
        .get(id) as { json: string; updated_at: number } | undefined;
      if (!row) return null;
      if (row.updated_at > base) return { conflict: row };
      const at = Math.max(deps.now(), row.updated_at + 1);
      deps.db
        .prepare(
          `UPDATE ${table} SET json = json_set(json, '$.positionMs', ?), updated_at = ?
           WHERE user_id = ?`,
        )
        .run(positionMs, at, id);
      return { updatedAt: at };
    })();
    if (!result) return c.json({ error: 'no_queue' }, 404);
    if ('conflict' in result && result.conflict) return conflict(c, result.conflict);
    return c.json(result);
  }

  return app;
}
