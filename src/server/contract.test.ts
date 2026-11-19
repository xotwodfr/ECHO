import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { startSetup } from './auth/routes.ts';
import { createSession } from './auth/sessions.ts';
import { fromBase32, hotp, STEP_S, stepAt } from './auth/totp.ts';
import { createApp } from './index.ts';
import { createMotion } from './motion.ts';
import { startFakeMotion } from './motion-fake.ts';
import { startMockSubsonic } from './navidrome/mock.ts';
import { navidromeClientFor, navidromeUrlOf } from './navidrome/routes.ts';
import { call, cookieOf, testDeps } from './testing.ts';

// API-01 (IMPLEMENTATION_PLAN.md M8 task 5): responses match docs/api/openapi.yaml. A scripted
// session walks the API as an admin, a user and an anonymous client; every response's status must
// be documented for its operation, and a JSON body must match the documented schema.

type Schema = Record<string, unknown>;
const spec = parse(readFileSync('docs/api/openapi.yaml', 'utf8')) as {
  paths: Record<
    string,
    Record<string, { responses?: Record<string, Schema>; security?: unknown[] }>
  >;
  components: { schemas: Record<string, Schema> };
};

/** The schema errors of `v` (a subset of JSON Schema: what the document uses). */
function check(schema: Schema | undefined, v: unknown, at = '$'): string[] {
  if (!schema) return [];
  if (typeof schema.$ref === 'string')
    return check(spec.components.schemas[schema.$ref.split('/').pop() as string], v, at);
  if (Array.isArray(schema.oneOf)) {
    const ok = (schema.oneOf as Schema[]).some((s) => check(s, v, at).length === 0);
    return ok ? [] : [`${at}: matches none of oneOf`];
  }
  const errs: string[] = [];
  if ('const' in schema && v !== schema.const) errs.push(`${at}: ${JSON.stringify(v)} ≠ const`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(v))
    errs.push(`${at}: ${JSON.stringify(v)} not in enum`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const kind =
      v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
    const ok = types.some((t) => t === kind || (t === 'number' && kind === 'integer'));
    if (!ok) return [`${at}: ${kind} is not ${types.join('|')}`];
  }
  if (
    typeof v === 'string' &&
    typeof schema.pattern === 'string' &&
    !new RegExp(schema.pattern).test(v)
  )
    errs.push(`${at}: "${v}" does not match ${schema.pattern}`);
  if (Array.isArray(v)) {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems)
      errs.push(`${at}: too few`);
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems)
      errs.push(`${at}: too many`);
    for (const [i, x] of v.entries()) errs.push(...check(schema.items as Schema, x, `${at}[${i}]`));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of (schema.required as string[] | undefined) ?? [])
      if (!(r in o)) errs.push(`${at}.${r}: required`);
    for (const [k, s] of Object.entries((schema.properties as Record<string, Schema>) ?? {}))
      if (k in o && o[k] !== undefined) errs.push(...check(s, o[k], `${at}.${k}`));
  }
  return errs;
}

// Literal paths before templated ones: /me/sessions/revoke-others is not /me/sessions/{id}.
const templates = Object.keys(spec.paths)
  .map((p) => ({ p, re: new RegExp(`^${p.replace(/\{\w+\}/g, '[^/]+')}$`) }))
  .sort((a, b) => (a.p.match(/\{/g)?.length ?? 0) - (b.p.match(/\{/g)?.length ?? 0));

function operation(method: string, path: string) {
  const bare = path.replace(/^\/api\/v1/, '').split('?')[0] as string;
  const t = templates.find((x) => x.re.test(bare));
  return t ? { key: `${method} ${t.p}`, op: spec.paths[t.p]?.[method.toLowerCase()] } : null;
}

describe('API-01: responses match the OpenAPI document', () => {
  it('a scripted session: every status documented, every JSON body valid', async () => {
    const t = testDeps();
    const seen = new Set<string>();
    const problems: string[] = [];
    const req = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const res = await call(t.app, method, path, body, cookie);
      const found = operation(method, path);
      if (!found?.op) {
        problems.push(`${method} ${path}: not documented`);
        return res;
      }
      seen.add(found.key);
      // The document's rule (info.description): every operation under the global security answers
      // 401 without a session, so 401 need not be listed on each.
      if (res.status === 401 && found.op.security?.length !== 0) return res;
      const doc = found.op.responses?.[String(res.status)] ?? found.op.responses?.default;
      if (!doc) {
        problems.push(`${found.key} → ${res.status}: status not documented`);
        return res;
      }
      const schema = (doc.content as Record<string, { schema?: Schema }> | undefined)?.[
        'application/json'
      ]?.schema;
      if (schema && res.headers.get('content-type')?.includes('application/json')) {
        const errs = check(schema, await res.clone().json());
        for (const e of errs) problems.push(`${found.key} → ${res.status}: ${e}`);
      }
      return res;
    };

    // Setup (anonymous), then the admin.
    await req('GET', '/api/v1/health');
    await req('GET', '/api/v1/session');
    const token = startSetup(t.deps.auth) as string;
    await req('GET', '/api/v1/setup');
    const start = await req('POST', '/api/v1/setup', {
      token,
      username: 'ada',
      password: 'correct horse battery staple',
    });
    const { secret } = (await start.json()) as { secret: string };
    const code = () => hotp(fromBase32(secret), stepAt(t.clock.t));
    const fin = await req('POST', '/api/v1/setup/totp', { token, code: code() });
    const admin = cookieOf(fin);
    t.clock.t += STEP_S * 1000;

    // Account.
    for (const p of ['/session', '/me', '/me/account', '/me/sessions', '/me/settings', '/me/queue'])
      await req('GET', `/api/v1${p}`, undefined, admin);
    await req('PUT', '/api/v1/me/settings', { visuals: { intensity: 'subtle' } }, admin);
    await req('PUT', '/api/v1/me/settings', { nope: 1 }, admin);
    await req('PUT', '/api/v1/me/queue', { queue: null, positionMs: 0, baseUpdatedAt: 0 }, admin);
    await req('GET', '/api/v1/me/tracks/navidrome:t1/override', undefined, admin);
    await req('PUT', '/api/v1/me/tracks/navidrome:t1/override', { offsetMs: 50 }, admin);
    await req('GET', '/api/v1/lyrics?trackKey=navidrome:t1&title=a&artist=b', undefined, admin);
    await req('GET', '/api/v1/me/connections/navidrome', undefined, admin);
    await req('GET', '/api/v1/me/connections/youtube', undefined, admin);
    await req('GET', '/api/v1/youtube/home', undefined, admin);
    await req('GET', '/api/v1/youtube/library', undefined, admin); // 409: not signed in
    await req('GET', '/api/v1/youtube/search?q=fake', undefined, admin);
    await req('GET', '/api/v1/palette/fixture:night-sun', undefined, admin);
    await req(
      'POST',
      '/api/v1/me/recovery-codes',
      { password: 'correct horse battery staple', code: code() },
      admin,
    );
    await req('POST', '/api/v1/me/password', { current: 'wrong wrong wrong', next: 'x' }, admin);
    await req('POST', '/api/v1/me/sessions/revoke-others', {}, admin);

    // Admin.
    await req('GET', '/api/v1/admin/settings', undefined, admin);
    await req('PUT', '/api/v1/admin/settings', { spotify: { matchLibrary: false } }, admin);
    await req('GET', '/api/v1/admin/users', undefined, admin);
    const inv = await req('POST', '/api/v1/admin/invites', {}, admin);
    const { token: invite } = (await inv.json()) as { token: string };
    await req('GET', '/api/v1/admin/invites', undefined, admin);
    await req('GET', '/api/v1/admin/audit?limit=5', undefined, admin);

    // An invited user, and what they may not do.
    await req('GET', '/api/v1/invite');
    const joined = await req('POST', '/api/v1/invite', {
      token: invite,
      username: 'bo',
      password: 'correct horse battery staple',
    });
    const bo = cookieOf(joined);
    await req('GET', '/api/v1/admin/users', undefined, bo);
    await req('PATCH', '/api/v1/admin/users/2', { disabled: false }, admin);
    await req('POST', '/api/v1/admin/users/2/unlock', {}, admin);
    await req('DELETE', '/api/v1/me/sessions/nope', undefined, bo);
    await req('POST', '/api/v1/auth/device', {
      username: 'bo',
      password: 'correct horse battery staple',
      name: 'Phone',
    });
    await req('POST', '/api/v1/auth/login', { username: 'bo', password: 'wrong wrong wrong' });
    await req('POST', '/api/v1/me/totp/start', { password: 'correct horse battery staple' }, bo);
    await req('POST', '/api/v1/me/totp/enable', { code: '000000' }, bo);
    await req('POST', '/api/v1/auth/totp', { challenge: 'nope', code: '000000' });
    await req('POST', '/api/v1/admin/invites', { username: 'cy' }, admin);
    const list = (await (await req('GET', '/api/v1/admin/invites', undefined, admin)).json()) as {
      id: string;
    }[];
    await req('DELETE', `/api/v1/admin/invites/${list[0]?.id}`, undefined, admin);
    await req('DELETE', '/api/v1/me', { password: 'correct horse battery staple' }, bo);
    await req('DELETE', '/api/v1/admin/users/99', undefined, admin);
    await req('POST', '/api/v1/auth/logout', {}, admin);
    await req('GET', '/api/v1/me', undefined, bo);

    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(40);
  });

  it('animated lock-screen covers, off and on: every status documented, every JSON body valid', async () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    const req = async (
      app: ReturnType<typeof createApp>,
      method: string,
      path: string,
      init: { cookie: string; body?: BodyInit; headers?: Record<string, string> },
    ) => {
      const res = await app.request(`http://localhost${path}`, {
        method,
        body: init.body,
        headers: {
          host: 'localhost',
          origin: 'http://localhost',
          cookie: init.cookie,
          ...init.headers,
        },
      });
      const found = operation(method, path);
      if (!found?.op) {
        problems.push(`${method} ${path}: not documented`);
        return res;
      }
      seen.add(`${found.key} ${res.status}`);
      const doc = found.op.responses?.[String(res.status)];
      if (!doc) problems.push(`${found.key} → ${res.status}: status not documented`);
      const schema = (doc?.content as Record<string, { schema?: Schema }> | undefined)?.[
        'application/json'
      ]?.schema;
      if (schema && res.headers.get('content-type')?.includes('application/json'))
        for (const e of check(schema, await res.clone().json()))
          problems.push(`${found.key} → ${res.status}: ${e}`);
      return res;
    };
    const mp4 = Buffer.concat([
      Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0isommp42'),
      Buffer.alloc(64),
    ]);

    // Off: no motion service.
    const off = testDeps();
    off.deps.auth.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('ada', 'x', 'admin', 0)",
      )
      .run();
    const offCookie = `__Host-echo_session=${createSession(off.deps.auth.db, 1, 'web', off.clock.t)}`;
    for (const p of [
      '/motion',
      '/motion/al-1',
      '/motion/al-1/video',
      '/motion/al-1/still',
      '/motion/al-1/upload',
    ])
      await req(off.app, 'GET', `/api/v1${p}`, { cookie: offCookie });
    await req(off.app, 'PUT', '/api/v1/motion/al-1/upload', {
      cookie: offCookie,
      body: mp4,
      headers: { 'content-type': 'video/mp4' },
    });
    await req(off.app, 'DELETE', '/api/v1/motion/al-1/upload', { cookie: offCookie });

    // On: a stand-in motion service and the mock Navidrome.
    const mock = await startMockSubsonic({});
    const service = await startFakeMotion();
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const motion = createMotion({
      db,
      now: t.deps.auth.now,
      motionUrl: service.url,
      dir: mkdtempSync(join(tmpdir(), 'echo-motion-')),
      cacheBytes: 1e9,
      uploadMax: 4096,
      scopeFor: (id) => navidromeUrlOf(db, id),
      navidrome: (id) => navidromeClientFor(t.deps.navidrome, id),
    });
    const app = createApp({ ...t.deps, motion });
    for (const [name, role] of [
      ['ada', 'admin'],
      ['bo', 'user'],
    ])
      db.prepare(
        'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, 0)',
      ).run(name, 'x', role);
    const admin = `__Host-echo_session=${createSession(db, 1, 'web', t.clock.t)}`;
    const bo = `__Host-echo_session=${createSession(db, 2, 'web', t.clock.t)}`;
    await req(app, 'GET', '/api/v1/motion/al-1', { cookie: bo }); // 409: no Navidrome yet
    for (const cookie of [admin, bo])
      await call(
        app,
        'PUT',
        '/api/v1/me/connections/navidrome',
        { username: 'ada', password: 'navidrome-pass' },
        cookie,
      );
    await req(app, 'GET', '/api/v1/motion', { cookie: bo });
    await req(app, 'GET', '/api/v1/motion/al-1?loop=7', { cookie: bo });
    await req(app, 'GET', '/api/v1/motion/al-1/video', { cookie: bo });
    for (let i = 0; i < 200 && (await motion.jobFor(2, 'al-1', 8))?.status !== 'ready'; i++)
      await new Promise((r) => setTimeout(r, 10));
    await req(app, 'GET', '/api/v1/motion/al-1?shape=square', { cookie: bo });
    const video = await req(app, 'GET', '/api/v1/motion/al-1/video', {
      cookie: bo,
      headers: { range: 'bytes=0-3' },
    });
    await req(app, 'GET', '/api/v1/motion/al-1/video', {
      cookie: bo,
      headers: { 'if-none-match': video.headers.get('etag') ?? '' },
    });
    await req(app, 'GET', '/api/v1/motion/al-1/still', { cookie: bo });
    await req(app, 'GET', '/api/v1/motion/al-1/upload', { cookie: bo });
    await req(app, 'DELETE', '/api/v1/motion/al-1/upload', { cookie: bo });
    await req(app, 'GET', '/api/v1/motion/al%20one/still', { cookie: bo });
    await req(app, 'PUT', '/api/v1/motion/al-1/upload', {
      cookie: admin,
      body: 'x',
      headers: { 'content-type': 'text/html' },
    });
    await req(app, 'PUT', '/api/v1/motion/al-1/upload', {
      cookie: admin,
      body: Buffer.alloc(5000),
      headers: { 'content-type': 'video/mp4' },
    });
    await req(app, 'PUT', '/api/v1/motion/al-1/upload', {
      cookie: admin,
      body: mp4,
      headers: { 'content-type': 'video/mp4' },
    });
    await req(app, 'GET', '/api/v1/motion/al-1/upload', { cookie: admin });
    await req(app, 'DELETE', '/api/v1/motion/al-1/upload', { cookie: admin });
    await req(app, 'DELETE', '/api/v1/motion/al-1/upload', { cookie: admin });
    motion.stop();
    mock.close();
    service.close();

    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });
});
