import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { createApp } from './index.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { call, testDeps } from './testing.ts';

// SEC-11 (IMPLEMENTATION_PLAN.md M8 task 8): user B attacks every route with user A's identifiers
// and must neither read nor change A's connections, settings, queue, overrides, sessions or
// streams. Every /api/v1 route is listed below, either attacked or named as carrying no user data;
// a new route fails this test until it is placed.

let mock: MockSubsonic;
beforeAll(async () => {
  mock = await startMockSubsonic({});
});
afterAll(() => mock.close());

/** Routes with no per-user data or identifiers (health, who-am-I, setup and sign-in steps). */
const NO_USER_DATA = [
  'GET /health',
  'POST /csp-report',
  'GET /session',
  'GET /setup',
  'POST /setup',
  'POST /setup/totp',
  'POST /auth/login',
  'POST /auth/totp',
  'POST /auth/device',
  'POST /auth/logout',
  'GET /invite',
  'POST /invite',
  'POST /invite/totp',
  'GET /me',
  'GET /me/account',
  'POST /me/password',
  'POST /me/totp/start',
  'POST /me/totp/enable',
  'POST /me/totp/disable',
  'POST /me/recovery-codes',
  'DELETE /me',
  'POST /me/sessions/revoke-others',
  'DELETE /me/connections/navidrome',
  'PUT /me/connections/navidrome',
  'POST /me/connections/navidrome/test',
  'GET /lyrics', // shared cache by design; the override in it is per user (attacked below)
];

describe('SEC-11: isolation between users', () => {
  it('B gets none of A, through every route', async () => {
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const app = createApp(t.deps);
    const db = t.deps.auth.db;
    const user = (name: string, role = 'user') => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', ?, 0)",
          )
          .run(name, role).lastInsertRowid,
      );
      return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
    };
    const A = user('alice');
    const B = user('bob');
    const attacked = new Set<string>();
    const as = async (who: { cookie: string }, method: string, path: string, body?: unknown) => {
      const route = `${method} ${path.replace(/^\/api\/v1/, '').split('?')[0]}`;
      attacked.add(route);
      return call(app, method, path, body, who.cookie);
    };
    const json = async (r: Response) => JSON.stringify(await r.json().catch(() => null));

    // A's world: Navidrome, a queue, an override, settings, a device.
    expect(
      (
        await as(A, 'PUT', '/api/v1/me/connections/navidrome', {
          username: 'ada',
          password: 'navidrome-pass',
        })
      ).status,
    ).toBe(200);
    const track = mock.songs[0]?.id as string;
    const aQueue = {
      now: { key: `navidrome:${track}`, title: 'ALICE-QUEUE' },
      nextUp: [],
      context: [],
      history: [],
      provider: 'navidrome',
    };
    await as(A, 'PUT', '/api/v1/me/queue', { queue: aQueue, positionMs: 1234, baseUpdatedAt: 0 });
    await as(A, 'PUT', `/api/v1/me/tracks/navidrome:${track}/override`, {
      offsetMs: 450,
      pinnedSource: 'lrclib',
    });
    await as(A, 'PUT', '/api/v1/me/settings', { visuals: { intensity: 'subtle' } });
    const aPlay = {
      track: {
        provider: 'navidrome',
        id: track,
        title: 'ALICE-PLAY',
        artists: [{ name: 'ALICE-ARTIST' }],
        album: { title: 'ALICE-ALBUM' },
        durationMs: 1000,
        artwork: [],
      },
      context: { kind: 'album', id: 'ALICE-CONTEXT', title: 'ALICE-CONTEXT' },
    };
    for (let i = 0; i < 6; i++) await as(A, 'POST', '/api/v1/me/plays', aPlay);
    createSession(db, A.id, 'device', t.clock.t, { name: 'ALICE-PHONE' });
    const aSessions = db
      .prepare('SELECT id_hash FROM sessions WHERE user_id = ?')
      .pluck()
      .all(A.id) as string[];
    const aSigned = (await (
      await as(A, 'GET', `/api/v1/navidrome/stream-url/${track}`)
    ).json()) as { url: string };

    // B reads: nothing of A's comes back.
    const reads = [
      '/api/v1/me/queue',
      `/api/v1/me/tracks/navidrome:${track}/override`,
      '/api/v1/me/settings',
      '/api/v1/me/plays/recent',
      '/api/v1/me/plays/contexts',
      '/api/v1/me/mixes',
      '/api/v1/me/wrapped',
      '/api/v1/me/sessions',
      '/api/v1/me/connections/navidrome',
    ];
    for (const p of reads) {
      const body = await json(await as(B, 'GET', p));
      // Text marks only: numbers like A's position could also appear by chance (the mock's
      // random port is in B's connection answer); those are checked as fields below.
      for (const mark of ['ALICE', 'subtle', 'navidrome-pass', ...aSessions])
        expect(body, `${p} leaks ${mark}`).not.toContain(mark);
    }
    const field = async (p: string) =>
      JSON.parse(await json(await call(app, 'GET', p, undefined, B.cookie)));
    expect((await field('/api/v1/me/queue')).queue).toBeNull();
    expect((await field(`/api/v1/me/tracks/navidrome:${track}/override`)).offsetMs).toBe(0);
    expect(
      JSON.parse(
        await json(await call(app, 'GET', '/api/v1/me/connections/navidrome', undefined, B.cookie)),
      ).connected,
    ).toBe(false);

    // B writes with A's identifiers: A's data is unchanged.
    await as(B, 'PUT', '/api/v1/me/queue', { queue: null, positionMs: 0, baseUpdatedAt: 0 });
    await as(B, 'PUT', `/api/v1/me/tracks/navidrome:${track}/override`, { offsetMs: -50 });
    await as(B, 'PUT', '/api/v1/me/settings', { visuals: { intensity: 'balanced' } });
    await as(B, 'POST', '/api/v1/me/plays', { ...aPlay, track: { ...aPlay.track, title: 'B' } });
    for (const id of aSessions)
      expect((await as(B, 'DELETE', `/api/v1/me/sessions/${id}`)).status).toBe(404);
    expect(
      JSON.parse(await json(await call(app, 'GET', '/api/v1/me/queue', undefined, A.cookie))).queue
        .now.title,
    ).toBe('ALICE-QUEUE');
    expect(
      JSON.parse(
        await json(
          await call(
            app,
            'GET',
            `/api/v1/me/tracks/navidrome:${track}/override`,
            undefined,
            A.cookie,
          ),
        ),
      ).offsetMs,
    ).toBe(450);
    expect(
      JSON.parse(await json(await call(app, 'GET', '/api/v1/me/settings', undefined, A.cookie)))
        .visuals.intensity,
    ).toBe('subtle');
    expect(
      db
        .prepare('SELECT COUNT(*) FROM plays WHERE user_id = ? AND title = ?')
        .pluck()
        .get(A.id, 'ALICE-PLAY'),
    ).toBe(6);
    expect(db.prepare('SELECT COUNT(*) FROM sessions WHERE user_id = ?').pluck().get(A.id)).toBe(
      aSessions.length,
    );

    // Streams, covers and the proxy: B has no Navidrome, so nothing of A's server reaches B.
    for (const p of [
      `/api/v1/navidrome/stream/${track}`,
      `/api/v1/navidrome/stream-url/${track}`,
      `/api/v1/navidrome/cover/${track}`,
      '/api/v1/navidrome/rest/getAlbumList2?type=newest',
    ])
      expect((await as(B, 'GET', p)).status, p).toBeGreaterThanOrEqual(400);
    expect(
      (await as(B, 'POST', '/api/v1/navidrome/rest/star?id=x', {})).status,
    ).toBeGreaterThanOrEqual(400);
    // A's signed URL rebound to B (uid swapped) fails; B cannot mint one for A.
    const forged = aSigned.url.replace(`uid=${A.id}`, `uid=${B.id}`);
    expect((await as(B, 'GET', forged)).status).toBe(401);
    // A Navidrome album's palette is scoped to A's server: B (no server) gets the fallback.
    const pal = await (
      await as(B, 'GET', `/api/v1/palette/navidrome:${mock.songs[0]?.albumId}`)
    ).json();
    expect(pal.source).toBe('fallback');

    // Admin routes, with A's id: B is not an admin.
    for (const [m, p] of [
      ['GET', '/api/v1/admin/settings'],
      ['PUT', '/api/v1/admin/settings'],
      ['GET', '/api/v1/admin/users'],
      ['PATCH', `/api/v1/admin/users/${A.id}`],
      ['DELETE', `/api/v1/admin/users/${A.id}`],
      ['POST', `/api/v1/admin/users/${A.id}/unlock`],
      ['GET', '/api/v1/admin/invites'],
      ['POST', '/api/v1/admin/invites'],
      ['DELETE', '/api/v1/admin/invites/0123456789abcdef'],
      ['GET', '/api/v1/admin/audit'],
      ['GET', '/api/v1/admin/spotify-matching'],
      ['POST', '/api/v1/admin/spotify-matching/run'],
      ['GET', '/api/v1/admin/spotify-matching/misses'],
      ['GET', `/api/v1/admin/spotify-matching/tracks/${mock.songs[0]?.id}`],
      ['PUT', `/api/v1/admin/spotify-matching/tracks/${mock.songs[0]?.id}`],
    ] as const)
      expect(
        (await as(B, m, p, m === 'GET' || m === 'DELETE' ? undefined : {})).status,
        `${m} ${p}`,
      ).toBe(403);

    // Every route is either attacked above or carries no user data.
    const served = new Set<string>();
    for (const r of app.routes)
      if (
        r.path.startsWith('/api/v1/') &&
        ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'].includes(r.method)
      )
        served.add(`${r.method} ${r.path.slice('/api/v1'.length)}`);
    const placed = (r: string) => {
      const re = new RegExp(`^${r.replace(/:\w+/g, '[^/]+')}$`);
      return NO_USER_DATA.includes(r) || [...attacked].some((a) => re.test(a));
    };
    expect([...served].filter((r) => !placed(r)).sort()).toEqual([]);
  });
});
