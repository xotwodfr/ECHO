import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { hardening, isTrusted, SECURITY_HEADERS, type Vars } from './http.ts';
import { call, testDeps } from './testing.ts';

// SETTINGS_AND_SECURITY.md §5.

function probe(
  publicOrigin: string | null,
  socket: string,
  trustedProxy: string[] = ['172.18.0.0/16'],
) {
  const app = new Hono<{ Variables: Vars }>();
  app.use(
    '*',
    hardening({ publicOrigin, trustedProxy }, () => socket),
  );
  app.all('*', (c) => c.json({ ip: c.var.ip }));
  return app;
}

describe('trusted proxy (§5.1)', () => {
  it('matches exact addresses and IPv4 CIDRs, including IPv4-mapped IPv6', () => {
    expect(isTrusted('172.18.0.5', ['172.18.0.0/16'])).toBe(true);
    expect(isTrusted('::ffff:172.18.3.4', ['172.18.0.0/16'])).toBe(true);
    expect(isTrusted('172.19.0.5', ['172.18.0.0/16'])).toBe(false);
    expect(isTrusted('10.0.0.2', ['10.0.0.2'])).toBe(true);
    expect(isTrusted('10.0.0.3', ['10.0.0.2'])).toBe(false);
    expect(isTrusted('::1', ['::1'])).toBe(true);
    expect(isTrusted('1.2.3.4', ['1.2.3.0/40'])).toBe(false);
    expect(isTrusted('1.2.3.4', [])).toBe(false);
  });

  it('X-Forwarded-For is honoured only from the proxy, and only its last hop', async () => {
    const headers = {
      host: 'echo.test',
      'x-forwarded-for': '6.6.6.6, 198.51.100.9',
      'x-forwarded-proto': 'https',
    };
    const via = await probe('https://echo.test', '172.18.0.2').request('http://echo.test/', {
      headers,
    });
    expect(await via.json()).toEqual({ ip: '198.51.100.9' });
    const direct = await probe(null, '203.0.113.7').request('http://echo.test/', { headers });
    expect(await direct.json()).toEqual({ ip: '203.0.113.7' });
  });

  it('with a public origin, plain http is refused (but not the health check)', async () => {
    const app = probe('https://echo.test', '203.0.113.7');
    const spoofed = await app.request('http://echo.test/api/v1/me', {
      headers: { host: 'echo.test', 'x-forwarded-proto': 'https' }, // not from the proxy
    });
    expect(spoofed.status).toBe(403);
    expect(
      (await app.request('http://echo.test/api/v1/health', { headers: { host: 'echo.test' } }))
        .status,
    ).toBe(200);
  });
});

describe('Host and Origin (§5.2, §5.3)', () => {
  const proxied = (host: string, extra: Record<string, string> = {}) => ({
    headers: { host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.9', ...extra },
  });

  it('a request for another host is misdirected (421)', async () => {
    const app = probe('https://echo.test', '172.18.0.2');
    expect((await app.request('http://x/', proxied('evil.test'))).status).toBe(421);
    expect((await app.request('http://x/', proxied('echo.test'))).status).toBe(200);
  });

  it('unsafe methods need our Origin unless they carry a bearer token', async () => {
    const app = probe('https://echo.test', '172.18.0.2');
    const post = (extra: Record<string, string>) =>
      app.request('http://x/', { method: 'POST', ...proxied('echo.test', extra) });
    expect((await post({})).status).toBe(403);
    expect((await post({ origin: 'https://evil.test' })).status).toBe(403);
    expect((await post({ origin: 'https://echo.test' })).status).toBe(200);
    expect((await post({ authorization: 'Bearer echo_dt_x' })).status).toBe(200);
    // ON-SEC-3: only ECHO's own device token is exempt; any other bearer falls back to the cookie
    // (auth/routes.ts), so it must not skip the Origin check.
    expect((await post({ authorization: 'Bearer x', origin: 'https://evil.test' })).status).toBe(
      403,
    );
    expect((await app.request('http://x/', proxied('echo.test'))).status).toBe(200); // GET
  });

  it('without a public origin (development) the request’s own host is the origin', async () => {
    const app = probe(null, '127.0.0.1');
    const post = (origin: string) =>
      app.request('http://localhost/', {
        method: 'POST',
        headers: { host: 'localhost:8080', origin },
      });
    expect((await post('http://localhost:8080')).status).toBe(200);
    expect((await post('http://evil.test')).status).toBe(403);
  });
});

describe('response headers and limits (§5.4, §5.6)', () => {
  it('every response carries the headers, refusals too; HSTS only on https', async () => {
    for (const res of [
      await probe(null, '1.1.1.1').request('http://x/', { headers: { host: 'x' } }),
      await probe(null, '1.1.1.1').request('http://x/', { method: 'POST', headers: { host: 'x' } }), // 403
    ]) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
      expect(res.headers.get('strict-transport-security')).toBeNull();
    }
    const https = await probe('https://echo.test', '172.18.0.2').request('http://x/', {
      headers: { host: 'echo.test', 'x-forwarded-proto': 'https' },
    });
    expect(https.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('microphone=()');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('request bodies over 64 KB are refused', async () => {
    const { app } = testDeps();
    const res = await call(app, 'POST', '/api/v1/auth/login', {
      username: 'a',
      password: 'x'.repeat(70_000),
    });
    expect(res.status).toBe(413);
  });
});

describe('the native device login (API-02)', () => {
  it('needs no Origin without cookies; with a cookie or a foreign Origin it is checked', async () => {
    const { testDeps } = await import('./testing.ts');
    const { app } = testDeps();
    const post = (headers: Record<string, string>) =>
      app.request('http://localhost/api/v1/auth/device', {
        method: 'POST',
        headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ username: 'x', password: 'y', name: 'Phone' }),
      });
    expect((await post({})).status).toBe(401); // reached the route: wrong credentials
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ cookie: '__Host-echo_session=abc' })).status).toBe(403);
    // Any other unsafe route without Origin stays refused.
    const login = await app.request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(login.status).toBe(403);
  });
});
