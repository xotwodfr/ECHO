import type { Context, MiddlewareHandler } from 'hono';

// HTTP hardening (SETTINGS_AND_SECURITY.md §5): forwarded headers only from the trusted proxy, the
// Host check, the Origin check on cookie-authenticated unsafe methods, and the response headers
// and CSP. Without ECHO_PUBLIC_ORIGIN (development, E2E on 127.0.0.1) the origin-bound checks
// compare against the request's own Host instead.

export interface HttpConfig {
  publicOrigin: string | null;
  /** IPv4 CIDRs or exact addresses whose X-Forwarded-* headers are honoured (Caddy). */
  trustedProxy: string[];
}

export type Vars = { ip: string };

/** §5.6: request bodies ≤ 64 KB (no uploads); applied with hono/body-limit in index.ts. */
export const BODY_LIMIT = 64 * 1024;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://sdk.scdn.co",
    'frame-src https://sdk.scdn.co',
    "connect-src 'self' https://api.spotify.com",
    "img-src 'self' https://i.scdn.co data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "style-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://accounts.spotify.com",
    // Violations are reported to the server's log (SEC-08: none during the full E2E run).
    'report-uri /api/v1/csp-report',
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=()',
};

const v4 = (ip: string) => {
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  return m ? m.slice(1).reduce((n, o) => n * 256 + Number(o), 0) : null;
};

/** True if `ip` matches one of the trusted entries (exact, or IPv4 CIDR). */
export function isTrusted(ip: string, trusted: string[]) {
  const addr = v4(ip);
  return trusted.some((t) => {
    const [net, bits] = t.split('/');
    if (bits === undefined) return t === ip || (addr !== null && v4(t) === addr);
    const base = v4(net as string);
    const n = Number(bits);
    if (addr === null || base === null || !(n >= 0 && n <= 32)) return false;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (addr & mask) >>> 0 === (base & mask) >>> 0;
  });
}

export function hardening(
  cfg: HttpConfig,
  socketAddress: (c: Context) => string,
): MiddlewareHandler<{ Variables: Vars }> {
  const origin = cfg.publicOrigin ? new URL(cfg.publicOrigin) : null;
  return async (c, next) => {
    // Headers first, so refusals carry them too.
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
    if (origin?.protocol === 'https:')
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const socket = socketAddress(c);
    const viaProxy = isTrusted(socket, cfg.trustedProxy);
    // The client is the last hop Caddy appended; anyone else's forwarded headers are ignored.
    const forwarded = viaProxy
      ? c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
      : undefined;
    c.set('ip', forwarded || socket);
    const proto = viaProxy
      ? c.req.header('x-forwarded-proto')
      : new URL(c.req.url).protocol.replace(':', '');
    const host = c.req.header('host') ?? ''; // Caddy passes the Host through unchanged
    const health = c.req.path === '/api/v1/health';

    if (origin) {
      if (proto !== 'https' && !health) return c.json({ error: 'https_required' }, 403);
      if (host !== origin.host && !health) return c.json({ error: 'misdirected' }, 421);
    }
    // CSRF (§5.3): cookie-authenticated unsafe methods must come from our own origin. Bearer
    // tokens are not sent ambiently, so they are exempt; so is a native client asking for its
    // device token without any cookie and without an Origin (nothing ambient to ride on, API-02).
    const nativeDeviceLogin =
      c.req.path === '/api/v1/auth/device' && !c.req.header('cookie') && !c.req.header('origin');
    // The browser sends CSP reports itself; they change nothing but a log line.
    const cspReport = c.req.path === '/api/v1/csp-report';
    if (
      !SAFE.has(c.req.method) &&
      // A device token (no cookie is used with one); any other bearer is ignored by auth, which
      // then reads the cookie, so it must not skip this check.
      !c.req.header('authorization')?.startsWith('Bearer echo_dt_') &&
      !nativeDeviceLogin &&
      !cspReport
    ) {
      const want = origin ? origin.origin : `${proto}://${host}`;
      if (c.req.header('origin') !== want) return c.json({ error: 'bad_origin' }, 403);
    }
    await next();
  };
}
