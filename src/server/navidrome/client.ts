import { createHash, randomBytes } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Target } from './url.ts';

// One user's Subsonic connection (PLAYBACK_ARCHITECTURE.md §5.2): every request signed with that
// user's credentials — a fresh salt and md5(password + salt) per request, or the API key alone when
// the server advertises `apiKeyAuthentication` — and sent to the address pinned when the URL was
// checked (url.ts), with TLS still verified against the hostname.

export type Credentials = { username: string; password: string } | { apiKey: string };

export const API_VERSION = '1.16.1';
const TIMEOUT_MS = 15_000; // idle socket
const DEADLINE_MS = 30_000; // a whole JSON reply
const MAX_JSON_BYTES = 16 * 1024 * 1024;

export class SubsonicError extends Error {
  readonly status: number; // HTTP status, or 0 for a network failure
  readonly code: number | null; // Subsonic error code
  constructor(message: string, status: number, code: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** Subsonic 40/41/43/44 and HTTP 401: the credentials were rejected. */
  get auth() {
    return this.status === 401 || [40, 41, 43, 44].includes(this.code ?? -1);
  }
}

export function authParams(c: Credentials, salt = randomBytes(6).toString('hex')) {
  if ('apiKey' in c) return { apiKey: c.apiKey };
  return {
    u: c.username,
    t: createHash('md5')
      .update(c.password + salt)
      .digest('hex'),
    s: salt,
  };
}

type Params = Record<string, string | string[]>;

/** Query parameters a caller may never set: auth and protocol are ours. */
const RESERVED = new Set(['u', 'p', 't', 's', 'apiKey', 'c', 'v', 'f']);

export function createClient(target: Target, creds: Credentials) {
  const lookup: LookupFunction = (_host, opts, cb) => {
    const family = target.address.includes(':') ? 6 : 4;
    if (opts?.all) cb(null, [{ address: target.address, family }]);
    else cb(null, target.address, family);
  };
  const base = target.url.href.replace(/\/+$/, '');

  function urlFor(method: string, params: Params) {
    const q = new URLSearchParams();
    // A repeated parameter (createPlaylist's songId) arrives as a list and leaves as one per value.
    for (const [k, v] of Object.entries(params))
      if (!RESERVED.has(k)) for (const x of [v].flat()) q.append(k, x);
    for (const [k, v] of Object.entries(authParams(creds))) q.set(k, v);
    q.set('v', API_VERSION);
    q.set('c', 'ECHO');
    q.set('f', 'json');
    return `${base}/rest/${method}?${q}`;
  }

  /** The raw response; the caller owns (and must consume or destroy) the body. */
  function request(method: string, params: Params, headers: Record<string, string> = {}) {
    const url = urlFor(method, params);
    const mod = url.startsWith('https:') ? https : http;
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = mod.get(url, { lookup, headers, timeout: TIMEOUT_MS }, resolve);
      req.on('timeout', () => req.destroy(new SubsonicError('timeout', 0)));
      req.on('error', (err) =>
        reject(err instanceof SubsonicError ? err : new SubsonicError(err.message, 0)),
      );
    });
  }

  /** A JSON method; resolves with `subsonic-response`, rejects with a SubsonicError. */
  async function call(method: string, params: Params = {}) {
    const res = await request(method, params, { accept: 'application/json' });
    const chunks: Buffer[] = [];
    let size = 0;
    const deadline = setTimeout(() => res.destroy(new SubsonicError('timeout', 0)), DEADLINE_MS);
    try {
      for await (const c of res) {
        size += (c as Buffer).length;
        // A reply this large is not one the allow-listed methods give; stop reading it.
        if (size > MAX_JSON_BYTES) {
          res.destroy();
          throw new SubsonicError('response too large', 200);
        }
        chunks.push(c as Buffer);
      }
    } catch (err) {
      throw err instanceof SubsonicError ? err : new SubsonicError((err as Error).message, 0);
    } finally {
      clearTimeout(deadline);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (res.statusCode !== 200)
      throw new SubsonicError(`HTTP ${res.statusCode}`, res.statusCode ?? 0);
    let body: {
      'subsonic-response'?: Record<string, unknown> & {
        status?: string;
        error?: { code?: number; message?: string };
      };
    };
    try {
      body = JSON.parse(text);
    } catch {
      throw new SubsonicError('not a Subsonic server', 200);
    }
    const r = body['subsonic-response'];
    if (!r) throw new SubsonicError('not a Subsonic server', 200);
    if (r.status !== 'ok')
      throw new SubsonicError(r.error?.message ?? 'failed', 200, r.error?.code ?? null);
    return r;
  }

  return { call, request };
}

export type SubsonicClient = ReturnType<typeof createClient>;
