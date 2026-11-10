import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { createSession } from '../auth/sessions.ts';
import { createApp } from '../index.ts';
import { call, testDeps } from '../testing.ts';

// Over real sockets (ECHO behind @hono/node-server, a Subsonic server that never stops sending):
// app.request() cannot show what a closed connection does to the upstream request.

it('a listener that goes away closes the upstream stream', async () => {
  let open = 0;
  const up = http.createServer((req, res) => {
    if (!req.url?.includes('/rest/stream')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1' } }));
    }
    open++;
    res.on('close', () => open--);
    res.writeHead(200, { 'content-type': 'audio/flac' });
    const more = () => {
      while (!res.destroyed && res.write(Buffer.alloc(65536))) {}
    };
    res.on('drain', more);
    more();
  });
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', r));
  const t = testDeps();
  t.deps.navidrome.defaultUrl = `http://127.0.0.1:${(up.address() as AddressInfo).port}`;
  const app = createApp(t.deps);
  const db = t.deps.auth.db;
  const id = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES ('a', 'x', 'user', 0)",
      )
      .run().lastInsertRowid,
  );
  const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
  const c = await call(
    app,
    'PUT',
    '/api/v1/me/connections/navidrome',
    { username: 'a', password: 'b' },
    cookie,
  );
  expect(c.status).toBe(200);
  const echo = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => echo.once('listening', r));
  const port = (echo.address() as AddressInfo).port;
  const req = http.get(`http://127.0.0.1:${port}/api/v1/navidrome/stream/s1`, {
    headers: { cookie, host: 'localhost' },
  });
  const res = await new Promise<http.IncomingMessage>((r) => req.on('response', r));
  expect(res.statusCode).toBe(200);
  await new Promise((r) => res.once('data', r));
  expect(open).toBe(1);
  req.destroy();
  await new Promise((r) => setTimeout(r, 300));
  expect(open).toBe(0);
  echo.close();
  up.closeAllConnections();
  up.close();
});
