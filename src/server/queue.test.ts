import { describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { call, testDeps } from './testing.ts';

// M5 task 9: the per-user queue, compare-and-set.

function setup() {
  const t = testDeps();
  const db = t.deps.auth.db;
  const cookieFor = (name: string) => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
        )
        .run(name).lastInsertRowid,
    );
    return `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
  };
  return { ...t, cookieFor };
}

const Q = (title: string) => ({
  now: { key: `navidrome:${title}`, title },
  nextUp: [],
  context: [],
  history: [],
});

describe('the queue follows the user', () => {
  it('starts empty, stores, and reads back with its position', async () => {
    const s = setup();
    const ada = s.cookieFor('ada');
    expect(await (await call(s.app, 'GET', '/api/v1/me/queue', undefined, ada)).json()).toEqual({
      queue: null,
      positionMs: 0,
      updatedAt: 0,
    });
    const put = await call(
      s.app,
      'PUT',
      '/api/v1/me/queue',
      { queue: Q('a'), positionMs: 12_000, baseUpdatedAt: 0 },
      ada,
    );
    const { updatedAt } = (await put.json()) as { updatedAt: number };
    expect(updatedAt).toBe(s.clock.t);
    const got = await (await call(s.app, 'GET', '/api/v1/me/queue', undefined, ada)).json();
    expect(got).toEqual({ queue: Q('a'), positionMs: 12_000, updatedAt });
  });

  it('a write based on an older version is refused with the newer queue (another device)', async () => {
    const s = setup();
    const ada = s.cookieFor('ada');
    const v1 = (
      (await (
        await call(s.app, 'PUT', '/api/v1/me/queue', { queue: Q('phone'), baseUpdatedAt: 0 }, ada)
      ).json()) as { updatedAt: number }
    ).updatedAt;
    s.clock.t += 1000;
    const v2 = (
      (await (
        await call(
          s.app,
          'PUT',
          '/api/v1/me/queue',
          { queue: Q('phone-2'), baseUpdatedAt: v1 },
          ada,
        )
      ).json()) as { updatedAt: number }
    ).updatedAt;
    expect(v2).toBeGreaterThan(v1);
    // The laptop still thinks v1 is current.
    const stale = await call(
      s.app,
      'PUT',
      '/api/v1/me/queue',
      { queue: Q('laptop'), baseUpdatedAt: v1 },
      ada,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: 'changed_elsewhere',
      queue: Q('phone-2'),
      updatedAt: v2,
    });
    // Two writes in one millisecond still order.
    const v3 = (
      (await (
        await call(s.app, 'PUT', '/api/v1/me/queue', { queue: Q('x'), baseUpdatedAt: v2 }, ada)
      ).json()) as { updatedAt: number }
    ).updatedAt;
    expect(v3).toBeGreaterThan(v2);
  });

  it('is per user, needs a session, and only takes an object', async () => {
    const s = setup();
    const ada = s.cookieFor('ada');
    const bo = s.cookieFor('bo');
    await call(s.app, 'PUT', '/api/v1/me/queue', { queue: Q('ada'), baseUpdatedAt: 0 }, ada);
    expect(
      await (await call(s.app, 'GET', '/api/v1/me/queue', undefined, bo)).json(),
    ).toMatchObject({ queue: null });
    expect((await call(s.app, 'GET', '/api/v1/me/queue')).status).toBe(401);
    for (const body of [
      { queue: [], baseUpdatedAt: 0 },
      { queue: 'x', baseUpdatedAt: 0 },
      { queue: {} },
    ])
      expect((await call(s.app, 'PUT', '/api/v1/me/queue', body, ada)).status).toBe(400);
  });

  it('keeps the youtube slot apart', async () => {
    const s = setup();
    const ada = s.cookieFor('ada');
    await call(s.app, 'PUT', '/api/v1/me/queue', { queue: Q('a'), baseUpdatedAt: 0 }, ada);
    const put = await call(
      s.app,
      'PUT',
      '/api/v1/me/queue/youtube',
      { queue: Q('y'), positionMs: 5, baseUpdatedAt: 0 },
      ada,
    );
    expect(put.status).toBe(200);
    const nav = (await (await call(s.app, 'GET', '/api/v1/me/queue', undefined, ada)).json()) as {
      queue: unknown;
    };
    expect(nav.queue).toEqual(Q('a'));
    const yt = (await (
      await call(s.app, 'GET', '/api/v1/me/queue/youtube', undefined, ada)
    ).json()) as { queue: unknown; positionMs: number };
    expect(yt).toMatchObject({ queue: Q('y'), positionMs: 5 });
    const stale = await call(
      s.app,
      'PUT',
      '/api/v1/me/queue/youtube',
      { queue: Q('z'), baseUpdatedAt: 0 },
      ada,
    );
    expect(stale.status).toBe(409);
  });
});
