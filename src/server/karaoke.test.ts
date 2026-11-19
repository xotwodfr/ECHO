import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { createApp } from './index.ts';
import { createKaraoke, PRIORITY, stemKey } from './karaoke.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { navidromeClientFor, navidromeUrlOf } from './navidrome/routes.ts';
import { call, testDeps } from './testing.ts';

// Karaoke mode (docs/KARAOKE.md): songs queued for the stem service, the one asked for first, sent
// there from the user's Navidrome one at a time, and the results proxied back with Range.

/** A stand-in stem service: keeps what it was sent; answers 422 for a key while `fail` has tries left. */
async function startFakeStems() {
  const files = new Map<string, Buffer>();
  const order: string[] = [];
  const state = { fail: new Map<string, number>(), hold: null as null | Promise<void> };
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'PUT' && url.startsWith('/separate/')) {
      const key = url.slice(10);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      order.push(key);
      if (state.hold) await state.hold;
      const fails = state.fail.get(key) ?? 0;
      if (fails > 0) {
        state.fail.set(key, fails - 1);
        res.writeHead(422, { 'content-type': 'application/json' });
        return res.end('{"error":"separation_failed"}');
      }
      files.set(key, Buffer.concat(chunks));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ bytes: files.get(key)?.length, seconds: 1 }));
    }
    if (req.method === 'GET' && url.startsWith('/stems/')) {
      const body = files.get(url.slice(7));
      if (!body) {
        res.writeHead(404);
        return res.end();
      }
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : body.length - 1;
        res.writeHead(206, {
          'content-type': 'audio/mp4',
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'content-length': end - start + 1,
        });
        return res.end(body.subarray(start, end + 1));
      }
      res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': body.length });
      return res.end(body);
    }
    if (url === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
      return res.end(JSON.stringify({ songs: files.size, bytes, working: null }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, files, order, state, close: () => server.close() };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

describe('karaoke', () => {
  let mock: MockSubsonic;
  let stems: Awaited<ReturnType<typeof startFakeStems>>;
  const services: { close: () => void }[] = [];
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => {
    mock.close();
    for (const x of services) x.close();
  });

  async function setup(over: { stemsUrl?: string; maxSeconds?: number; library?: boolean } = {}) {
    stems = await startFakeStems(); // each test its own, so one test's queue never meets another's
    services.push(stems);
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const karaoke = createKaraoke({
      db,
      now: t.deps.auth.now,
      stemsUrl: over.stemsUrl ?? stems.url,
      maxSeconds: over.maxSeconds ?? 1200,
      library: over.library ?? true,
      scopeFor: (id) => navidromeUrlOf(db, id),
      navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
      libraries: async () => {
        const client = await navidromeClientFor(t.deps.navidrome, 1);
        return client ? [{ scope: navidromeUrlOf(db, 1), userId: 1, client }] : [];
      },
    });
    const app = createApp({ ...t.deps, karaoke });
    db.prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'admin', 0)",
    ).run();
    const cookie = `__Host-echo_session=${createSession(db, 1, 'web', t.clock.t)}`;
    const put = await call(
      app,
      'PUT',
      '/api/v1/me/connections/navidrome',
      { username: 'ada', password: 'navidrome-pass' },
      cookie,
    );
    expect(put.status).toBe(200);
    const get = async (path: string) =>
      (await (await call(app, 'GET', `/api/v1${path}`, undefined, cookie)).json()) as Record<
        string,
        unknown
      >;
    const status = (id: string) =>
      db.prepare('SELECT status FROM stems_jobs WHERE track_id = ?').pluck().get(id);
    return { ...t, db, app, karaoke, cookie, get, status };
  }

  it('a song is named per Navidrome server: the same id on another server is another song', () => {
    expect(stemKey('http://a:4533', 's-1')).toMatch(/^[0-9a-f]{40}$/);
    expect(stemKey('http://a:4533', 's-1')).not.toBe(stemKey('http://b:4533', 's-1'));
  });

  it('is "off" without a stem service', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    db.prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'user', 0)",
    ).run();
    const cookie = `__Host-echo_session=${createSession(db, 1, 'web', t.clock.t)}`;
    const res = await call(t.app, 'GET', '/api/v1/karaoke/al-1-t1', undefined, cookie);
    expect(await res.json()).toEqual({ status: 'off' });
    expect(await (await call(t.app, 'GET', '/api/v1/karaoke', undefined, cookie)).json()).toEqual({
      enabled: false,
    });
    expect((await call(t.app, 'GET', '/api/v1/karaoke/al-1-t1')).status).toBe(401);
  });

  it('a song asked for is separated, then served with Range', async () => {
    const s = await setup();
    expect(await s.get('/karaoke/al-1-t1')).toMatchObject({ ahead: 0 });
    await until(() => s.status('al-1-t1') === 'ready');
    const key = stemKey(navidromeUrlOf(s.db, 1), 'al-1-t1');
    // The song's own bytes reached the service (a WAV from the mock).
    expect(stems.files.get(key)?.subarray(0, 4).toString()).toBe('RIFF');
    expect(await s.get('/karaoke/al-1-t1')).toEqual({
      status: 'ready',
      url: '/api/v1/karaoke/al-1-t1/audio',
    });
    const res = await s.app.request('http://localhost/api/v1/karaoke/al-1-t1/audio', {
      headers: { host: 'localhost', cookie: s.cookie, range: 'bytes=0-3' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-3\//);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('RIFF');
    expect(await s.get('/karaoke')).toMatchObject({ enabled: true, online: true, ready: 1 });
    // Home's shelf: the ready song, as the user's Navidrome describes it.
    const ready = (await s.get('/karaoke/ready')) as { songs: { id: string; title: string }[] };
    expect(ready.songs.map((x) => x.id)).toEqual(['al-1-t1']);

    // Gone from the service's disk: asked for again, made again.
    stems.files.delete(key);
    const gone = await call(s.app, 'GET', '/api/v1/karaoke/al-1-t1/audio', undefined, s.cookie);
    expect(gone.status).toBe(409);
    await until(() => stems.files.has(key));
    s.karaoke.stop();
  });

  it('the song asked for now goes before songs coming up, and those before the library', async () => {
    const s = await setup();
    let release = () => {};
    stems.state.hold = new Promise<void>((r) => {
      release = r;
    });
    const keyOf = (id: string) => stemKey(navidromeUrlOf(s.db, 1), id);
    await s.karaoke.sweep(); // every song at the lowest priority; the first starts at once
    await until(() => stems.order.length === 1); // the first is with the service, held there
    const first = s.karaoke.working();
    const [now, soon] = mock.songs.map((x) => x.id).filter((id) => keyOf(id) !== first);
    expect(await s.get(`/karaoke/${soon}?soon=1`)).toMatchObject({ status: 'queued' });
    expect(await s.get(`/karaoke/${now}`)).toMatchObject({ status: 'queued', ahead: 1 });
    expect(await s.get(`/karaoke/${soon}?soon=1`)).toMatchObject({ ahead: 2 });
    stems.state.hold = null;
    release();
    await until(() => stems.order.length >= 3);
    expect(stems.order.slice(0, 3)).toEqual([first, keyOf(now as string), keyOf(soon as string)]);
    s.karaoke.stop();
  });

  it('the library sweep queues each song once', async () => {
    const s = await setup();
    s.karaoke.stop(); // the queue only
    const n = await s.karaoke.sweep();
    expect(n).toBe(mock.songs.length);
    expect(await s.karaoke.sweep()).toBe(0);
    expect(s.db.prepare('SELECT DISTINCT priority FROM stems_jobs').pluck().all()).toEqual([
      PRIORITY.library,
    ]);
    // Asking for one raises it, never lowers it.
    await s.get('/karaoke/al-1-t2');
    await s.get('/karaoke/al-1-t2?soon=1');
    expect(
      s.db.prepare("SELECT priority FROM stems_jobs WHERE track_id = 'al-1-t2'").pluck().get(),
    ).toBe(PRIORITY.now);
  });

  it('a song that cannot be separated is tried three times, then reported failed', async () => {
    const s = await setup();
    const key = stemKey(navidromeUrlOf(s.db, 1), 'al-3-t1');
    const left = () => stems.state.fail.get(key);
    stems.state.fail.set(key, 3);
    await s.get('/karaoke/al-3-t1');
    await until(() => left() === 2);
    expect(await s.get('/karaoke/al-3-t1')).toMatchObject({ status: 'queued' });
    // Retries wait: ten minutes, then twenty.
    s.karaoke.kick();
    await new Promise((r) => setTimeout(r, 50));
    expect(left()).toBe(2);
    s.clock.t += 10 * 60_000;
    s.karaoke.kick();
    await until(() => left() === 1);
    s.clock.t += 20 * 60_000;
    s.karaoke.kick();
    await until(() => s.status('al-3-t1') === 'failed');
    expect(await s.get('/karaoke/al-3-t1')).toEqual({ status: 'failed' });
    // A week on (or after a restart), a failed song is tried again: the service may be fixed by then.
    s.clock.t += 7 * 86_400_000;
    stems.state.fail.set(key, 0);
    await s.karaoke.sweep();
    await until(() => s.status('al-3-t1') === 'ready');
    s.karaoke.stop();
  });

  it('a song longer than the limit is skipped; an unreachable service keeps the queue', async () => {
    const short = await setup({ maxSeconds: 10 });
    await short.get('/karaoke/al-1-t1');
    await until(() => short.status('al-1-t1') === 'skipped');
    expect(await short.get('/karaoke/al-1-t1')).toEqual({ status: 'skipped' });
    short.karaoke.stop();

    const offline = await setup({ stemsUrl: 'http://127.0.0.1:9' });
    await offline.get('/karaoke/al-1-t1');
    await new Promise((r) => setTimeout(r, 100));
    expect(offline.status('al-1-t1')).toBe('queued');
    expect(await offline.get('/karaoke')).toMatchObject({ online: false, queued: 1 });
    offline.karaoke.stop();
  });
});
