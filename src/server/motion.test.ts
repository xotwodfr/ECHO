import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { createApp } from './index.ts';
import { createMotion, motionKey, PRIORITY, videoContainer } from './motion.ts';
import { startFakeMotion } from './motion-fake.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { navidromeClientFor, navidromeUrlOf } from './navidrome/routes.ts';
import { call, testDeps } from './testing.ts';

// Animated lock-screen covers (docs/MOTION.md): a cover made from the album's still on its first
// request, queued one at a time with uploads first, served with Range and caching headers to a
// session or device token, kept under a size cap; an admin's uploaded video in its place.

const MP4 = Buffer.concat([
  Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0isommp42'),
  Buffer.alloc(200, 7),
]);
const MOV = Buffer.concat([Buffer.from('\0\0\0\x14ftypqt  \0\0\0\0qt  '), Buffer.alloc(100, 1)]);

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

describe('the video an upload may be', () => {
  it('MP4, M4V and QuickTime by their first bytes; HEIF images, M4A audio and the rest refused', () => {
    expect(videoContainer(MP4)).toBe('iso');
    expect(videoContainer(MOV)).toBe('iso');
    expect(videoContainer(Buffer.from('\0\0\0\x14ftypM4V \0\0\0\0M4V mp42'))).toBe('iso');
    expect(videoContainer(Buffer.from('\0\0\0\x08wide\0\0\0\x10mdat'))).toBe('quicktime');
    expect(videoContainer(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic'))).toBeNull();
    expect(videoContainer(Buffer.from('\0\0\0\x18ftypM4A \0\0\0\0M4A isom'))).toBeNull();
    expect(videoContainer(Buffer.from('\x89PNG\r\n\x1a\n\0\0\0\rIHDR'))).toBeNull();
    expect(videoContainer(Buffer.from('<html><script>'))).toBeNull();
    expect(videoContainer(Buffer.from('\0\0\0\x18ftyp'))).toBeNull(); // cut short
  });

  it('names a cover per Navidrome server, album and variant, nothing readable', () => {
    expect(motionKey('http://a:4533', 'al-1', 'g8')).toMatch(/^[0-9a-f]{40}$/);
    expect(motionKey('http://a:4533', 'al-1', 'g8')).not.toBe(
      motionKey('http://b:4533', 'al-1', 'g8'),
    );
    expect(motionKey('http://a:4533', 'al-1', 'g8')).not.toBe(
      motionKey('http://a:4533', 'al-1', 'g5'),
    );
  });
});

describe('motion covers', () => {
  let mock: MockSubsonic;
  const services: { close: () => void }[] = [];
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => {
    mock.close();
    for (const x of services) x.close();
  });

  async function setup(over: { url?: string; cacheBytes?: number; uploadMax?: number } = {}) {
    const service = await startFakeMotion(); // each test its own, so one test's queue never meets another's
    services.push(service);
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const dir = mkdtempSync(join(tmpdir(), 'echo-motion-'));
    const motion = createMotion({
      db,
      now: t.deps.auth.now,
      motionUrl: over.url ?? service.url,
      dir,
      cacheBytes: over.cacheBytes ?? 1e9,
      uploadMax: over.uploadMax ?? 1024 * 1024,
      scopeFor: (id) => navidromeUrlOf(db, id),
      navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
    });
    const app = createApp({ ...t.deps, motion });
    const user = (name: string, role: 'admin' | 'user') => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', ?, 0)",
          )
          .run(name, role).lastInsertRowid,
      );
      return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
    };
    const admin = user('ada', 'admin');
    const bo = user('bo', 'user');
    for (const u of [admin, bo]) {
      const put = await call(
        app,
        'PUT',
        '/api/v1/me/connections/navidrome',
        { username: 'ada', password: 'navidrome-pass' },
        u.cookie,
      );
      expect(put.status).toBe(200);
    }
    const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
      app.request(`http://localhost/api/v1${path}`, {
        ...init,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          cookie: init.cookie ?? bo.cookie,
          ...(init.headers as Record<string, string>),
        },
      });
    const json = async (path: string, cookie = bo.cookie) =>
      (await (await req(path, { cookie })).json()) as Record<string, unknown>;
    const upload = (albumId: string, body: BodyInit, type = 'video/mp4', cookie = admin.cookie) =>
      req(`/motion/${albumId}/upload`, {
        method: 'PUT',
        body,
        cookie,
        headers: { 'content-type': type },
        ...(body instanceof ReadableStream && { duplex: 'half' }),
      } as RequestInit & { cookie?: string });
    const status = (key: string) =>
      db.prepare('SELECT status FROM motion_jobs WHERE key = ?').pluck().get(key);
    const scope = navidromeUrlOf(db, bo.id);
    const key = (albumId: string, loop = 8) => motionKey(scope, albumId, `g${loop}`);
    return { ...t, db, app, motion, service, dir, admin, bo, req, json, upload, status, key };
  }

  it('is "off" without a motion service, and needs a session or device token', async () => {
    const t = testDeps();
    const db = t.deps.auth.db;
    db.prepare(
      "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'admin', 0)",
    ).run();
    const token = createSession(db, 1, 'device', t.clock.t);
    const get = (path: string, auth = `Bearer ${token}`) =>
      t.app.request(`http://localhost/api/v1${path}`, {
        headers: { host: 'localhost', authorization: auth },
      });
    expect(await (await get('/motion')).json()).toEqual({ enabled: false });
    expect(await (await get('/motion/al-1')).json()).toEqual({ status: 'off' });
    expect((await get('/motion/al-1/video')).status).toBe(404);
    expect(await (await get('/motion/al-1/upload')).json()).toEqual({
      enabled: false,
      upload: null,
    });
    const put = await t.app.request('http://localhost/api/v1/motion/al-1/upload', {
      method: 'PUT',
      body: MP4,
      headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'video/mp4' },
    });
    expect(put.status).toBe(409);
    expect((await get('/motion/al-1', '')).status).toBe(401);
    expect((await get('/motion/al-1/still', 'Bearer echo_dt_nope')).status).toBe(401);
  });

  it('a cover asked for is made from the album cover, then served with Range and caching headers', async () => {
    const s = await setup();
    const first = await s.req('/motion/al-1?shape=tall&loop=8');
    expect(first.status).toBe(202); // the still cover meanwhile
    expect(Number(first.headers.get('retry-after'))).toBeGreaterThanOrEqual(5);
    expect(await first.json()).toMatchObject({ status: expect.stringMatching(/queued|working/) });
    await until(() => s.status(s.key('al-1')) === 'ready');
    // The album's own cover reached the service (a PNG from the mock's getCoverArt).
    expect(s.service.sent.get(s.key('al-1'))?.subarray(1, 4).toString()).toBe('PNG');
    const ready = await s.json('/motion/al-1?shape=tall&loop=8');
    expect(ready).toEqual({
      status: 'ready',
      source: 'generated',
      style: 'light',
      shape: 'tall',
      seconds: 8,
      version: expect.any(String),
      video: '/api/v1/motion/al-1/video?shape=tall&loop=8',
      still: '/api/v1/motion/al-1/still?shape=tall&loop=8',
    });
    // A device token reads it too (the iPhone app).
    const token = createSession(s.db, s.bo.id, 'device', s.clock.t);
    const video = await s.app.request(`http://localhost${ready.video}`, {
      headers: { host: 'localhost', authorization: `Bearer ${token}`, range: 'bytes=4-11' },
    });
    expect(video.status).toBe(206);
    expect(video.headers.get('content-type')).toBe('video/mp4');
    expect(video.headers.get('content-range')).toMatch(/^bytes 4-11\//);
    expect(video.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(video.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await video.arrayBuffer()).toString()).toBe('ftypisom');
    const etag = video.headers.get('etag') as string;
    expect(etag).toMatch(/^".+-tall-video"$/);
    const again = await s.req('/motion/al-1/video?shape=tall&loop=8', {
      headers: { 'if-none-match': etag },
    });
    expect(again.status).toBe(304); // unchanged: the service is not asked
    const still = await s.req('/motion/al-1/still?shape=square&loop=8');
    expect(still.status).toBe(200);
    expect(still.headers.get('content-type')).toBe('image/jpeg');
    expect([...Buffer.from(await still.arrayBuffer()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(await s.json('/motion')).toMatchObject({ enabled: true, online: true, ready: 1 });
    s.motion.stop();
  });

  it('each loop length is its own cover; others, other shapes and odd ids are refused', async () => {
    const s = await setup();
    await s.req('/motion/al-2?loop=5');
    await s.req('/motion/al-2?loop=15');
    await until(
      () => s.status(s.key('al-2', 5)) === 'ready' && s.status(s.key('al-2', 15)) === 'ready',
    );
    expect(s.service.order).toEqual([s.key('al-2', 5), s.key('al-2', 15)]);
    expect((await s.req('/motion/al-2?loop=7')).status).toBe(400);
    expect((await s.req('/motion/al-2/video?shape=wide')).status).toBe(400);
    expect((await s.req('/motion/..%2Fetc')).status).toBe(400);
    s.motion.stop();
  });

  it('one cover at a time: uploads first, then covers in the order asked for', async () => {
    const s = await setup();
    let release = () => {};
    s.service.state.hold = new Promise<void>((r) => {
      release = r;
    });
    await s.req('/motion/al-1');
    await until(() => s.service.order.length === 1); // with the service, held there
    await s.req('/motion/al-2');
    await s.req('/motion/al-3');
    expect(await s.json('/motion/al-3')).toMatchObject({ status: 'queued', ahead: 2 });
    expect((await s.upload('al-4', MP4)).status).toBe(201);
    expect(await s.json('/motion/al-3')).toMatchObject({ ahead: 3 }); // the upload went ahead
    s.service.state.hold = null;
    release();
    await until(() => s.service.order.length === 4);
    const up = s.db
      .prepare("SELECT key FROM motion_jobs WHERE variant = 'u'")
      .pluck()
      .get() as string;
    expect(s.service.order).toEqual([s.key('al-1'), up, s.key('al-2'), s.key('al-3')]);
    expect(PRIORITY.upload).toBeGreaterThan(PRIORITY.asked);
    s.motion.stop();
  });

  it('generated covers over the size cap go, the one asked for longest ago first', async () => {
    const s = await setup({ cacheBytes: 450 }); // a fake cover is ~200 bytes: two fit
    for (const a of ['al-1', 'al-2']) {
      await s.req(`/motion/${a}`);
      await until(() => s.status(s.key(a)) === 'ready');
      s.clock.t += 1000;
    }
    await s.req('/motion/al-1'); // asked for again: al-2 is now the oldest
    s.clock.t += 1000;
    await s.req('/motion/al-3');
    await until(() => s.status(s.key('al-3')) === 'ready');
    await until(() => s.service.deleted.includes(s.key('al-2')));
    expect(s.status(s.key('al-2'))).toBeUndefined();
    expect(s.status(s.key('al-1'))).toBe('ready');
    expect(s.service.files.has(`${s.key('al-2')}/tall.mp4`)).toBe(false);
    // Asked for again, it is made again.
    expect((await s.req('/motion/al-2')).status).toBe(202);
    s.motion.stop();
  });

  it('a cover gone from the service is made again; an offline service is waited for', async () => {
    const s = await setup();
    await s.req('/motion/al-1');
    await until(() => s.status(s.key('al-1')) === 'ready');
    for (const n of ['tall.mp4', 'square.mp4', 'tall.jpg', 'square.jpg'])
      s.service.files.delete(`${s.key('al-1')}/${n}`);
    expect((await s.req('/motion/al-1/video')).status).toBe(202);
    await until(() => s.service.order.length === 2);
    s.motion.stop();

    const off = await setup({ url: 'http://127.0.0.1:9' });
    expect((await off.req('/motion/al-1')).status).toBe(202);
    await until(() => off.status(off.key('al-1')) === 'queued'); // back in the queue, not failed
    expect(await off.json('/motion')).toMatchObject({ enabled: true, online: false, queued: 1 });
    expect((await off.req('/motion/al-1/video')).status).toBe(202);
    off.motion.stop();
  });

  it('a cover the service cannot make fails at once; an error is tried again', async () => {
    const s = await setup();
    s.service.state.refuse.add(s.key('al-1'));
    s.service.state.fail.set(s.key('al-2'), 1);
    await s.req('/motion/al-1');
    await s.req('/motion/al-2');
    await until(() => s.status(s.key('al-1')) === 'failed');
    expect(await s.json('/motion/al-1')).toEqual({ status: 'failed' });
    expect((await s.req('/motion/al-1/still')).status).toBe(404); // the app keeps the still cover
    await until(() => s.status(s.key('al-2')) === 'queued'); // waiting 10 minutes to try again
    s.clock.t += 11 * 60_000;
    s.motion.kick();
    await until(() => s.status(s.key('al-2')) === 'ready');
    s.motion.stop();
  });

  it('one user cannot queue a whole library', async () => {
    const s = await setup();
    s.service.state.hold = new Promise<void>(() => {}); // nothing finishes
    for (let i = 0; i < 21; i++) await s.req(`/motion/x-${i}`);
    const busy = await s.req('/motion/x-99');
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('60');
    expect((await s.req('/motion/x-99', { cookie: s.admin.cookie })).status).toBe(202); // others can
    s.motion.stop();
  });

  it('an admin uploads a video: kept, recorded, audited, transcoded first, served in its place', async () => {
    const s = await setup();
    await s.req('/motion/al-1');
    await until(() => s.status(s.key('al-1')) === 'ready');
    const put = await s.upload('al-1', MP4);
    expect(put.status).toBe(201);
    expect(await put.json()).toEqual({
      status: expect.stringMatching(/queued|working/),
      type: 'mp4',
      bytes: MP4.length,
    });
    const row = s.db.prepare('SELECT * FROM motion_uploads').get() as Record<string, unknown>;
    expect(row).toMatchObject({ album_id: 'al-1', type: 'mp4', bytes: MP4.length, uploaded_by: 1 });
    expect(readdirSync(s.dir)).toEqual([row.file]);
    const audit = s.db.prepare('SELECT event, detail FROM audit_log ORDER BY id DESC').get() as {
      event: string;
      detail: string;
    };
    expect(audit.event).toBe('admin.motion_uploaded');
    expect(JSON.parse(audit.detail)).toEqual({ albumId: 'al-1', type: 'mp4', bytes: MP4.length });
    // The generated cover made way for it.
    await until(() => s.service.deleted.includes(s.key('al-1')));
    expect(s.status(s.key('al-1'))).toBeUndefined();
    await until(
      () =>
        (s.db
          .prepare("SELECT status FROM motion_jobs WHERE variant = 'u'")
          .pluck()
          .get() as string) === 'ready',
    );
    const up = s.db
      .prepare("SELECT key FROM motion_jobs WHERE variant = 'u'")
      .pluck()
      .get() as string;
    expect(s.service.sent.get(up)?.equals(MP4)).toBe(true); // the video itself went to the service
    // Every user on that Navidrome server gets it, whatever loop length they ask for.
    expect(await s.json('/motion/al-1?loop=12')).toMatchObject({
      status: 'ready',
      source: 'upload',
      style: 'video',
      seconds: 3,
    });
    expect(await s.json('/motion/al-1/upload', s.admin.cookie)).toEqual({
      enabled: true,
      upload: { type: 'mp4', bytes: MP4.length, uploadedAt: s.clock.t, status: 'ready' },
    });
    // Replaced: the old file goes.
    expect((await s.upload('al-1', MOV, 'video/quicktime')).status).toBe(201);
    const files = readdirSync(s.dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.mov$/);
    // Removed: file, row and transcode go, audited; a generated cover follows when asked for.
    const del = await s.req('/motion/al-1/upload', { method: 'DELETE', cookie: s.admin.cookie });
    expect(del.status).toBe(200);
    expect(readdirSync(s.dir)).toEqual([]);
    expect(s.db.prepare('SELECT COUNT(*) FROM motion_uploads').pluck().get()).toBe(0);
    expect(s.db.prepare('SELECT event FROM audit_log ORDER BY id DESC').pluck().get()).toBe(
      'admin.motion_removed',
    );
    expect(
      (await s.req('/motion/al-1/upload', { method: 'DELETE', cookie: s.admin.cookie })).status,
    ).toBe(404);
    expect((await s.req('/motion/al-1')).status).toBe(202);
    s.motion.stop();
  });

  it('only admins upload or remove, and only videos within the size limit', async () => {
    const s = await setup({ uploadMax: 4096 });
    expect((await s.upload('al-1', MP4, 'video/mp4', s.bo.cookie)).status).toBe(403);
    expect((await s.req('/motion/al-1/upload', { method: 'DELETE' })).status).toBe(403);
    expect((await s.req('/motion/al-1/upload')).status).toBe(403);
    expect((await s.upload('al-1', MP4, 'image/png')).status).toBe(415); // not a video type
    const html = await s.upload('al-1', Buffer.from('<html><script>alert(1)</script>'));
    expect(html.status).toBe(415); // declared a video, is not one
    expect(await html.json()).toEqual({ error: 'not_a_video' });
    const big = Buffer.concat([MP4, Buffer.alloc(5000)]);
    expect((await s.upload('al-1', big)).status).toBe(413); // its Content-Length says so
    // No length given: counted as it arrives, and cut off past the limit.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(big));
        c.close();
      },
    });
    expect((await s.upload('al-1', stream)).status).toBe(413);
    expect(readdirSync(s.dir)).toEqual([]); // nothing left behind
    expect(s.db.prepare('SELECT COUNT(*) FROM motion_uploads').pluck().get()).toBe(0);
    // The upload is the one route past the 64 KB body limit, and only for itself.
    expect((await s.upload('al-1', MP4)).status).toBe(201);
    const json = await s.req('/me/settings', {
      method: 'PUT',
      body: JSON.stringify({ x: 'y'.repeat(70_000) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(json.status).toBe(413);
    // A cookie upload from another origin is refused before anything is read (SEC: CSRF).
    const csrf = await s.app.request('http://localhost/api/v1/motion/al-2/upload', {
      method: 'PUT',
      body: MP4,
      headers: {
        host: 'localhost',
        origin: 'https://evil.test',
        cookie: s.admin.cookie,
        'content-type': 'video/mp4',
      },
    });
    expect(csrf.status).toBe(403);
    s.motion.stop();
  });

  it('a video the service refuses: the admin sees why, listeners get a generated cover meanwhile', async () => {
    const s = await setup();
    let release = () => {};
    s.service.state.hold = new Promise<void>((r) => {
      release = r;
    });
    expect((await s.upload('al-3', MP4)).status).toBe(201); // ftyp, so ECHO takes it
    const up = s.db
      .prepare("SELECT key FROM motion_jobs WHERE variant = 'u'")
      .pluck()
      .get() as string;
    s.service.state.refuse.add(up); // ffprobe's verdict, as the real service gives it
    s.service.state.hold = null;
    release();
    await until(() => s.status(up) === 'failed');
    expect(await s.json('/motion/al-3/upload', s.admin.cookie)).toMatchObject({
      upload: { status: 'failed', error: 'longer than 60 s' },
    });
    expect((await s.req('/motion/al-3')).status).toBe(202); // a generated one is made instead
    await until(() => s.status(s.key('al-3')) === 'ready');
    expect(await s.json('/motion/al-3')).toMatchObject({ status: 'ready', source: 'generated' });
    s.motion.stop();
  });

  it("uploads are scoped to the Navidrome server: another server's album of the same id is not it", async () => {
    const s = await setup();
    expect((await s.upload('al-1', MP4)).status).toBe(201);
    const row = s.db.prepare('SELECT scope FROM motion_uploads').pluck().get();
    expect(row).toBe(navidromeUrlOf(s.db, s.admin.id));
    s.db.prepare("UPDATE motion_uploads SET scope = 'https://other.example'").run();
    s.db.prepare("UPDATE motion_jobs SET scope = 'https://other.example'").run();
    expect(await s.json('/motion/al-1/upload', s.admin.cookie)).toMatchObject({ upload: null });
    expect(existsSync(s.dir)).toBe(true);
    s.motion.stop();
  });
});
