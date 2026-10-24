import type { MiddlewareHandler } from 'hono';
import { LOG_LEVELS, type LogLevel } from './config.ts';

// Logging and redaction (SETTINGS_AND_SECURITY.md §9): JSON lines on stdout, every one through a
// central redactor: the exact text of every secret the server has decrypted, secret query
// parameters, credential headers and token shapes become «redacted». Access lines record the route
// template, status, duration and user id, never the raw path or query string.

export type Log = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;

const MASK = '«redacted»';
const PARAMS = [
  'u',
  'p',
  't',
  's',
  'apiKey',
  'token',
  'code',
  'code_verifier',
  'state',
  'sig',
  'refresh_token',
  'access_token',
  'password',
  'client_secret',
];
const PATTERNS: RegExp[] = [
  // Query parameters (and form fields) that carry secrets.
  new RegExp(`([?&](?:${PARAMS.join('|')})=)[^&\\s"'#]*`, 'g'),
  // Credential headers, as written by Node and fetch errors.
  /((?:authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)[^"'\n]+/gi,
  /(Bearer\s+)[\w.~+/=-]+/g,
  /(__Host-echo_session=)[^;\s"']+/g,
  // Token shapes: device tokens, Spicy keys, sealed values.
  /()echo_dt_[\w-]+/g,
  /()sl_(?:sk|pk)_[\w-]+/g,
  /()v1:[\w-]{16}:[\w-]{16,}/g,
  // JSON fields that hold secrets, also inside JSON that is itself a string (escaped quotes).
  /(\\?"(?:password|secret|token|refresh_token|access_token|apiKey|code|code_verifier|totp_secret)\\?"\s*:\s*\\?")[^"\\]*/gi,
];

/** Plaintexts decrypted lately, masked word for word (bounded: the oldest are forgotten). */
export function createSecretSet(max = 2000) {
  const set = new Set<string>();
  return {
    add(s: string) {
      if (s.length < 6) return; // too short to mask without wrecking ordinary text
      set.delete(s);
      set.add(s);
      if (set.size > max) set.delete(set.values().next().value as string);
    },
    values: () => [...set],
  };
}

/** A secret as it can appear in a log line: raw, JSON-escaped, or URL-encoded (security review). */
const forms = (s: string) => [
  ...new Set([
    s,
    JSON.stringify(s).slice(1, -1),
    encodeURIComponent(s),
    encodeURIComponent(s).replace(/%20/g, '+'),
  ]),
];

export function redact(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  for (const s of secrets)
    for (const f of forms(s)) if (out.includes(f)) out = out.split(f).join(MASK);
  for (const re of PATTERNS) out = out.replace(re, `$1${MASK}`);
  return out;
}

export function createLogger(
  min: LogLevel,
  opts: { write?: (line: string) => void; secrets?: () => Iterable<string> } = {},
): Log {
  const write = opts.write ?? ((line) => console.log(line));
  return (level, msg, extra = {}) => {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(min)) return;
    const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...extra }, (_k, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    );
    write(redact(line, opts.secrets?.() ?? []));
  };
}

/** One access line per API request: route template, status, duration, user id (§9). */
export function accessLog(log: Log): MiddlewareHandler<{ Variables: { user?: { id: number } } }> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    log('info', 'request', {
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      user: c.get('user')?.id ?? null,
    });
  };
}
