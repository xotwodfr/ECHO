import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { audit } from './audit.ts';
import {
  type AuthDeps,
  type AuthEnv,
  ipHint,
  jsonObject,
  setSessionCookie,
  str,
} from './auth/routes.ts';
import { createSession } from './auth/sessions.ts';
import type { Vars } from './http.ts';

// Sign in with your phone (like WhatsApp Web): the web sign-in page asks for a request and shows
// its id as a QR code; the ECHO app, signed in on a phone, scans it, shows which browser is asking
// (and from where), and approves. The browser, which alone holds the request's poll secret, then
// gets a session of its own. Requests live two minutes in memory and are used once. A guest
// cannot approve (auth/routes.ts GUEST_DENY).

export const QR_TTL_MS = 2 * 60_000;
const MAX_PENDING = 2000;

interface Request {
  poll: string;
  expiresAt: number;
  browser: string;
  ip: string;
  approvedBy: number | null;
}

/** "Chrome on Windows", "Safari on iPhone": enough for the phone to recognise the request. */
export function browserOf(ua: string | undefined) {
  const u = ua ?? '';
  const name = /Edg\//.test(u)
    ? 'Edge'
    : /OPR\//.test(u)
      ? 'Opera'
      : /Firefox\//.test(u)
        ? 'Firefox'
        : /Chrome\//.test(u)
          ? 'Chrome'
          : /Safari\//.test(u)
            ? 'Safari'
            : 'A browser';
  const os = /Windows/.test(u)
    ? 'Windows'
    : /iPhone|iPad/.test(u)
      ? 'iPhone'
      : /Mac OS X/.test(u)
        ? 'Mac'
        : /Android/.test(u)
          ? 'Android'
          : /CrOS/.test(u)
            ? 'ChromeOS'
            : /Linux/.test(u)
              ? 'Linux'
              : '';
  return os ? `${name} on ${os}` : name;
}

export function qrLoginRoutes(
  deps: AuthDeps & { publicOrigin: string | null },
  requireUser: MiddlewareHandler<AuthEnv>,
) {
  const { db, now, limiter } = deps;
  const pending = new Map<string, Request>();
  const app = new Hono<AuthEnv & { Variables: Vars }>();

  const sweep = (t: number) => {
    for (const [id, r] of pending) if (r.expiresAt <= t) pending.delete(id);
  };
  const live = (id: unknown, t: number) => {
    const k = str(id, 64);
    const r = k ? pending.get(k) : undefined;
    return r && r.expiresAt > t ? { id: k as string, r } : null;
  };

  /** The sign-in page asks for a request: its id goes in the QR code, the poll secret stays with it. */
  app.post('/auth/qr', (c) => {
    const t = now();
    if (!limiter.qrAllows(c.var.ip, t)) return c.json({ error: 'rate_limited' }, 429);
    sweep(t);
    if (pending.size >= MAX_PENDING) return c.json({ error: 'busy' }, 503);
    const id = randomBytes(16).toString('base64url');
    const poll = randomBytes(32).toString('base64url');
    pending.set(id, {
      poll,
      expiresAt: t + QR_TTL_MS,
      browser: browserOf(c.req.header('user-agent')),
      ip: ipHint(c.var.ip),
      approvedBy: null,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        id,
        poll,
        url: `${deps.publicOrigin ?? new URL(c.req.url).origin}/link#${id}`,
        expiresAt: t + QR_TTL_MS,
      },
      201,
    );
  });

  /** The phone, signed in, sees who is asking before approving. */
  app.post('/auth/qr/peek', requireUser, async (c) => {
    const q = live((await jsonObject(c))?.id, now());
    if (!q || q.r.approvedBy !== null) return c.json({ error: 'expired' }, 404);
    return c.json({ browser: q.r.browser, ip: q.r.ip, expiresAt: q.r.expiresAt });
  });

  /** The phone approves: the browser that asked gets a session for this user. */
  app.post('/auth/qr/approve', requireUser, async (c) => {
    const t = now();
    const q = live((await jsonObject(c))?.id, t);
    if (!q || q.r.approvedBy !== null) return c.json({ error: 'expired' }, 404);
    q.r.approvedBy = c.var.user.id;
    audit(db, t, c.var.user.id, 'login.qr_approved', { browser: q.r.browser, ip: q.r.ip });
    return c.json({ ok: true, browser: q.r.browser });
  });

  /** The sign-in page waits: pending, then signed in (a session cookie) once approved, or expired. */
  app.post('/auth/qr/poll', async (c) => {
    const t = now();
    const b = await jsonObject(c);
    const q = live(b?.id, t);
    const secret = str(b?.poll, 128) ?? '';
    if (!q) return c.json({ status: 'expired' });
    const want = Buffer.from(q.r.poll);
    const got = Buffer.from(secret);
    // Only the browser that asked can collect the session.
    if (want.length !== got.length || !timingSafeEqual(want, got))
      return c.json({ status: 'expired' });
    if (q.r.approvedBy === null) return c.json({ status: 'pending' });
    pending.delete(q.id);
    const uid = q.r.approvedBy;
    const user = db.prepare('SELECT disabled FROM users WHERE id = ?').get(uid) as
      | { disabled: number }
      | undefined;
    if (!user || user.disabled) return c.json({ status: 'expired' });
    setSessionCookie(c, createSession(db, uid, 'web', t, { ipHint: q.r.ip }));
    audit(db, t, uid, 'login.qr', { browser: q.r.browser });
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'approved' });
  });

  return app;
}
