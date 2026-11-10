import { reportDown } from './connection.ts';
import { sessionExpired, sessionStore } from './session.ts';

const signedIn = () => sessionStore.getState().status === 'signedIn';

// The ECHO server's API (TECHNICAL_ARCHITECTURE.md §6.2): same-origin JSON with the session cookie.
// No answer at all marks the server unreachable, and a proxy reporting Navidrome unreachable marks
// that (connection.ts); both then retry with backoff.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string | null;
  /** The whole error body (e.g. the lyric sources tried with a 404). */
  readonly body: Record<string, unknown>;
  constructor(status: number, body: { error?: string; code?: string; userMessage?: string }) {
    super(body.code ?? body.error ?? `HTTP ${status}`);
    this.status = status;
    this.code = body.code ?? body.error ?? `http_${status}`;
    this.userMessage = body.userMessage ?? null;
    this.body = body as Record<string, unknown>;
  }
}

const TIMEOUT_MS = 45_000; // past the server's own deadlines for what it asks of others (30 s)
const RETRIES = 2; // of a GET only: asking twice changes nothing

/** 0.3 s, then 0.9 s, each ×0.5–1.5: the tabs of a network that came back do not ask in step. */
export const retryDelay = (attempt: number, rand = Math.random()) =>
  300 * 3 ** attempt * (0.5 + rand);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A GET that met a passing failure (no answer, the proxy's bodiless 502–504, or the API budget's
 * 429) is asked again, twice at most; everything else fails at once. No answer in 45 s is a failure.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  for (let attempt = 0; ; attempt++) {
    const again = method === 'GET' && attempt < RETRIES;
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Outlives the page (a save on `pagehide`); such a body may be at most 64 KB.
        ...(init.keepalive && { keepalive: true }),
      });
    } catch (err) {
      reportDown('server');
      if (!again || (err as Error)?.name === 'TimeoutError') throw err;
      await sleep(retryDelay(attempt));
      continue;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}
    if (res.ok) return body as T;
    const e = new ApiError(res.status, (body ?? {}) as Record<string, string>);
    // A 502–504 without ECHO's own error body came from the proxy in front of it (Caddy while ECHO
    // restarts): unreachable, as when the fetch itself fails.
    const proxy = res.status >= 502 && res.status <= 504 && e.code === `http_${res.status}`;
    if (e.code === 'navidrome.unreachable') reportDown('navidrome');
    else if (proxy) reportDown('server');
    if (again && (proxy || res.status === 429)) {
      // The budget says when it has room again (`retry-after`, in seconds).
      const after = res.status === 429 ? Number(res.headers.get('retry-after')) * 1000 || 0 : 0;
      await sleep(after + retryDelay(attempt));
      continue;
    }
    // A signed-in page whose session ended: sign in again in place (REL-05).
    if (res.status === 401 && e.code === 'unauthenticated' && signedIn())
      sessionExpired.setState({ expired: true });
    throw e;
  }
}
