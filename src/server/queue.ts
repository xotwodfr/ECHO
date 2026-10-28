import { Hono, type MiddlewareHandler } from 'hono';
import { type AuthEnv, jsonObject } from './auth/routes.ts';
import type { Db } from './db/db.ts';

// The queue follows the user (IMPLEMENTATION_PLAN.md M5 task 9; TECHNICAL_ARCHITECTURE.md §5.5):
// one JSON queue per user. Writes are compare-and-set on `updatedAt`, so a device writing over a
// newer queue from another device is told (409, with the newer queue) instead of silently winning.

export function queueRoutes(
  deps: { db: Db; now: () => number },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const app = new Hono<AuthEnv>();

  app.get('/me/queue', requireUser, (c) => {
    c.header('Cache-Control', 'no-store');
    const row = deps.db
      .prepare('SELECT json, updated_at FROM queue_state WHERE user_id = ?')
      .get(c.var.user.id) as { json: string; updated_at: number } | undefined;
    if (!row) return c.json({ queue: null, positionMs: 0, updatedAt: 0 });
    const { queue, positionMs } = JSON.parse(row.json) as { queue: unknown; positionMs: number };
    return c.json({ queue, positionMs, updatedAt: row.updated_at });
  });

  app.put('/me/queue', requireUser, async (c) => {
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
        .prepare('SELECT json, updated_at FROM queue_state WHERE user_id = ?')
        .get(id) as { json: string; updated_at: number } | undefined;
      if (row && row.updated_at > base) return { conflict: row };
      // Strictly increasing, even for two writes in the same millisecond.
      const at = Math.max(deps.now(), (row?.updated_at ?? 0) + 1);
      deps.db
        .prepare(
          `INSERT INTO queue_state (user_id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        )
        .run(id, JSON.stringify({ queue: b.queue, positionMs }), at);
      return { updatedAt: at };
    })();
    if ('conflict' in result && result.conflict) {
      const { queue, positionMs: pos } = JSON.parse(result.conflict.json) as {
        queue: unknown;
        positionMs: number;
      };
      return c.json(
        {
          error: 'changed_elsewhere',
          queue,
          positionMs: pos,
          updatedAt: result.conflict.updated_at,
        },
        409,
      );
    }
    return c.json(result);
  });

  return app;
}
