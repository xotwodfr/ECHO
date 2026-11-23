import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { createApp } from './index.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { call, testDeps } from './testing.ts';
import { createTogether, END_GRACE_MS, IDLE_MS, trackRefOf } from './together.ts';

// Listen together (docs/TOGETHER.md): one host, members on the same Navidrome server, a shared
// queue, the host's transport, and a state every member can turn into the same position.

const song = (id: string, durationMs = 180_000) => ({
  id,
  title: `Song ${id}`,
  artist: 'Ada',
  album: 'First',
  albumId: 'al-1',
  durationMs,
  cover: `/api/v1/navidrome/cover/${id}?size=600`,
});

type State = {
  id: string;
  url: string;
  host: { id: number; username: string };
  you: { id: number; host: boolean; member: boolean };
  members: { id: number; username: string; host: boolean; online: boolean }[];
  now: { uid: string; track: { id: string }; addedBy: { username: string } } | null;
  queue: { uid: string; track: { id: string }; addedBy: { username: string } }[];
  playing: boolean;
  startedAt: number | null;
  positionMs: number;
  serverTime: number;
  version: number;
};

describe('listen together', () => {
  let mock: MockSubsonic;
  const cleanup: (() => void)[] = [];
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => mock.close());
  afterEach(() => {
    for (const f of cleanup.splice(0)) f();
  });

  async function setup() {
    const base = testDeps();
    const together = createTogether({
      db: base.deps.auth.db,
      now: base.deps.auth.now,
      publicOrigin: 'https://echo.test',
    });
    cleanup.push(() => together.close());
    const t = { ...base, app: createApp({ ...base.deps, together }) };
    const clock = base.clock;
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const user = (name: string) => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
          )
          .run(name).lastInsertRowid,
      );
      const cookie = `__Host-echo_session=${createSession(db, id, 'web', clock.t)}`;
      return { id, cookie, name };
    };
    const host = user('ada');
    expect(
      (
        await call(
          t.app,
          'PUT',
          '/api/v1/me/connections/navidrome',
          { username: 'ada', password: 'navidrome-pass' },
          host.cookie,
        )
      ).status,
    ).toBe(200);
    const hostConn = db
      .prepare("SELECT config_json FROM connections WHERE user_id = ? AND provider = 'navidrome'")
      .pluck()
      .get(host.id) as string;
    /** A user on `url`'s Navidrome (the host's by default). */
    const connected = (name: string, url?: string) => {
      const u = user(name);
      const cfg = url ? JSON.stringify({ ...JSON.parse(hostConn), url }) : hostConn;
      db.prepare(
        "INSERT INTO connections (user_id, provider, config_json, secret_enc, status, updated_at) VALUES (?, 'navidrome', ?, NULL, 'ok', 0)",
      ).run(u.id, cfg);
      return u;
    };
    const as =
      (who: { cookie: string }) => async (method: string, path: string, body?: unknown) => {
        const res = await call(t.app, method, `/api/v1${path}`, body, who.cookie);
        return { status: res.status, body: (await res.json()) as State & { error?: string } };
      };
    return { ...t, clock, db, together, user, connected, host, as };
  }

  it('a host starts a session on the song playing; a member on the same library joins', async () => {
    const s = await setup();
    const ada = s.as(s.host);
    const made = await ada('POST', '/together', {
      track: song('s1'),
      positionMs: 30_000,
      playing: true,
      queue: [song('s2'), { bad: true }, song('s3')],
    });
    expect(made.status).toBe(201);
    expect(made.body.queue.map((q) => q.track.id)).toEqual(['s2', 's3']);
    const id = made.body.id;
    // 18 random bytes, base64url: 24 characters nobody guesses.
    expect(id).toMatch(/^[\w-]{24}$/);
    expect(made.body.url).toBe(`https://echo.test/together/${id}`);
    expect(made.body).toMatchObject({
      you: { host: true, member: true },
      playing: true,
      positionMs: 30_000,
      startedAt: s.clock.t - 30_000,
      serverTime: s.clock.t,
      now: { track: { id: 's1' }, addedBy: { username: 'ada' } },
    });

    const bob = s.connected('bob');
    const peek = await s.as(bob)('GET', `/together/${id}`);
    expect(peek.status).toBe(200);
    expect(peek.body.you).toMatchObject({ member: false, host: false });
    expect((await s.as(bob)('POST', `/together/${id}/queue`, { track: song('x') })).status).toBe(
      403,
    );
    const joined = await s.as(bob)('POST', `/together/${id}/join`);
    expect(joined.status).toBe(200);
    expect(joined.body.members.map((m) => m.username)).toEqual(['ada', 'bob']);

    // Ten seconds on, everyone computes the same position from startedAt.
    s.clock.t += 10_000;
    const later = await s.as(bob)('GET', `/together/${id}`);
    expect(later.body.positionMs).toBe(40_000);
    expect(later.body.serverTime - (later.body.startedAt ?? 0)).toBe(40_000);
    expect((await s.as(bob)('GET', '/together')).body).toMatchObject({ session: { id } });
  });

  it('another Navidrome server cannot join; neither can an unknown or malformed id', async () => {
    const s = await setup();
    const id = (await s.as(s.host)('POST', '/together', {})).body.id;
    const eve = s.connected('eve', 'http://other.test');
    const refused = await s.as(eve)('POST', `/together/${id}/join`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'other_library', host: 'ada' });
    expect((await s.as(eve)('GET', `/together/${id}`)).status).toBe(409);
    const nobody = s.user('carol'); // no Navidrome at all
    expect((await s.as(nobody)('POST', `/together/${id}/join`)).status).toBe(409);
    expect((await s.as(nobody)('POST', '/together', {})).status).toBe(409);
    const bob = s.connected('bob');
    expect((await s.as(bob)('GET', '/together/AAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await s.as(bob)('GET', '/together/..%2F..')).status).toBe(404);
  });

  it('everyone adds songs; the host controls playback; members remove only their own', async () => {
    const s = await setup();
    const ada = s.as(s.host);
    const id = (await ada('POST', '/together', {})).body.id;
    const bob = s.connected('bob');
    const asBob = s.as(bob);
    await asBob('POST', `/together/${id}/join`);

    // Nothing playing: the first song added starts for everyone.
    const first = await asBob('POST', `/together/${id}/queue`, { track: song('b1') });
    expect(first.body).toMatchObject({
      playing: true,
      positionMs: 0,
      now: { track: { id: 'b1' }, addedBy: { username: 'bob' } },
    });
    await ada('POST', `/together/${id}/queue`, { track: song('a1') });
    const next = await asBob('POST', `/together/${id}/queue`, { track: song('b2'), next: true });
    expect(next.body.queue.map((q) => [q.track.id, q.addedBy.username])).toEqual([
      ['b2', 'bob'],
      ['a1', 'ada'],
    ]);
    expect((await asBob('POST', `/together/${id}/queue`, { track: { id: 'x' } })).status).toBe(400);

    // Members cannot pause, seek or skip.
    for (const action of ['pause', 'play', 'next', 'seek'])
      expect((await asBob('POST', `/together/${id}/control`, { action })).status).toBe(403);
    // Members remove their own songs, not others'.
    const [b2, a1] = next.body.queue;
    expect((await asBob('DELETE', `/together/${id}/queue/${a1?.uid}`)).status).toBe(403);
    expect((await asBob('DELETE', `/together/${id}/queue/${b2?.uid}`)).status).toBe(200);
    // The host pauses, seeks, plays; the position follows.
    s.clock.t += 5000;
    const paused = await ada('POST', `/together/${id}/control`, { action: 'pause' });
    expect(paused.body).toMatchObject({ playing: false, positionMs: 5000, startedAt: null });
    s.clock.t += 60_000;
    expect((await asBob('GET', `/together/${id}`)).body.positionMs).toBe(5000);
    await ada('POST', `/together/${id}/control`, { action: 'seek', positionMs: 90_000 });
    const playing = await ada('POST', `/together/${id}/control`, { action: 'play' });
    expect(playing.body).toMatchObject({ playing: true, positionMs: 90_000 });
    expect(playing.body.startedAt).toBe(s.clock.t - 90_000);
    // Next, jump, and a host may remove anyone's song.
    const skipped = await ada('POST', `/together/${id}/control`, { action: 'next' });
    expect(skipped.body.now?.track.id).toBe('a1');
    expect(skipped.body.positionMs).toBe(0);
    // A stale "next" (the song already moved on) does not skip twice.
    const stale = await ada('POST', `/together/${id}/control`, {
      action: 'next',
      from: first.body.now?.uid,
    });
    expect(stale.body.now?.track.id).toBe('a1');
    const back = await ada('POST', `/together/${id}/control`, { action: 'previous' });
    expect(back.body.now?.track.id).toBe('b1');
    expect(back.body.queue.map((q) => q.track.id)).toEqual(['a1']);
    const q2 = await asBob('POST', `/together/${id}/queue`, { track: song('b3') });
    const b3 = q2.body.queue.find((q) => q.track.id === 'b3');
    const jumped = await ada('POST', `/together/${id}/control`, { action: 'jump', uid: b3?.uid });
    expect(jumped.body.now?.track.id).toBe('b3');
    const a1uid = jumped.body.queue[0]?.uid;
    expect((await ada('DELETE', `/together/${id}/queue/${a1uid}`)).body.queue).toEqual([]);
    expect((await ada('POST', `/together/${id}/control`, { action: 'dance' })).status).toBe(400);
  });

  it('a song that ends moves on to the next by itself, then stops at the end', async () => {
    const s = await setup();
    const ada = s.as(s.host);
    const id = (await ada('POST', '/together', { track: song('s1', 10_000), playing: true })).body
      .id;
    await ada('POST', `/together/${id}/queue`, { track: song('s2', 20_000) });
    s.clock.t += 10_000 + END_GRACE_MS + 3000;
    const st = (await ada('GET', `/together/${id}`)).body;
    expect(st.now?.track.id).toBe('s2');
    expect(st.positionMs).toBe(3000);
    s.clock.t += 30_000;
    const done = (await ada('GET', `/together/${id}`)).body;
    expect(done).toMatchObject({ now: null, playing: false, positionMs: 0 });
  });

  it('the host leaving ends the session; a member leaving does not; 12 idle hours end it', async () => {
    const s = await setup();
    const ada = s.as(s.host);
    const id = (await ada('POST', '/together', {})).body.id;
    const bob = s.connected('bob');
    await s.as(bob)('POST', `/together/${id}/join`);
    expect((await s.as(bob)('POST', `/together/${id}/leave`)).body).toMatchObject({ ended: false });
    expect((await ada('GET', `/together/${id}`)).body.members).toHaveLength(1);
    await s.as(bob)('POST', `/together/${id}/join`);
    expect((await ada('POST', `/together/${id}/leave`)).body).toMatchObject({ ended: true });
    expect((await s.as(bob)('GET', `/together/${id}`)).status).toBe(404);
    expect((await s.as(bob)('GET', '/together')).body).toEqual({ session: null });

    const id2 = (await ada('POST', '/together', {})).body.id;
    s.clock.t += IDLE_MS;
    expect((await ada('GET', `/together/${id2}`)).status).toBe(404);
  });

  it('a guest (the inviter’s connection copied) joins and adds songs', async () => {
    const s = await setup();
    const id = (await s.as(s.host)('POST', '/together', {})).body.id;
    const code = (
      (await (
        await call(s.app, 'POST', '/api/v1/guests/codes', { durationMs: 3_600_000 }, s.host.cookie)
      ).json()) as { code: string }
    ).code;
    const redeemed = (await (
      await s.app.request('http://localhost/api/v1/guests/redeem', {
        method: 'POST',
        headers: { host: 'localhost', 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).json()) as { token: string };
    const native = async (method: string, path: string, body?: unknown) =>
      s.app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          host: 'localhost',
          authorization: `Bearer ${redeemed.token}`,
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect((await native('POST', `/together/${id}/join`)).status).toBe(200);
    expect((await native('POST', `/together/${id}/queue`, { track: song('g1') })).status).toBe(200);
  });

  it('the event stream sends the state, then each change, then the end', async () => {
    const s = await setup();
    const ada = s.as(s.host);
    const id = (await ada('POST', '/together', { track: song('s1'), playing: true })).body.id;
    const res = await call(s.app, 'GET', `/api/v1/together/${id}/events`, undefined, s.host.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = '';
    const nextEvent = async () => {
      while (!buf.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value);
      }
      const i = buf.indexOf('\n\n');
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = JSON.parse(
        chunk
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n'),
      );
      return { event, data };
    };
    const first = await nextEvent();
    expect(first.event).toBe('state');
    expect(first.data).toMatchObject({ id, now: { track: { id: 's1' } }, serverTime: s.clock.t });
    await ada('POST', `/together/${id}/queue`, { track: song('s2') });
    const second = await nextEvent();
    expect(second.event).toBe('state');
    expect(second.data.queue).toHaveLength(1);
    expect((await ada('GET', `/together/${id}`)).body.members[0]?.online).toBe(true);
    await ada('POST', `/together/${id}/leave`);
    expect((await nextEvent()).event).toBe('end');
    await reader.cancel();
    // Not a member: no stream.
    const bob = s.connected('bob');
    expect(
      (await call(s.app, 'GET', `/api/v1/together/${id}/events`, undefined, bob.cookie)).status,
    ).toBe(404);
  });

  it('songs from the client are checked field by field', () => {
    expect(trackRefOf(null)).toBeNull();
    expect(trackRefOf({ id: 'a' })).toBeNull();
    expect(
      trackRefOf({ id: 'a', title: 't', durationMs: -5, cover: 'https://evil.test/x' }),
    ).toEqual({ id: 'a', title: 't', artist: '', album: '', durationMs: 0 });
    expect(trackRefOf({ ...song('a'), extra: 'dropped' })).toEqual(song('a'));
  });
});
