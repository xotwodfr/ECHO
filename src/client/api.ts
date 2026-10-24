import { reportDown } from './connection.ts';

// The ECHO server's API (TECHNICAL_ARCHITECTURE.md §6.2): same-origin JSON with the session cookie.
// No answer at all marks the server unreachable, and a proxy reporting Navidrome unreachable marks
// that (connection.ts); both then retry with backoff.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string | null;
  constructor(status: number, body: { error?: string; code?: string; userMessage?: string }) {
    super(body.code ?? body.error ?? `HTTP ${status}`);
    this.status = status;
    this.code = body.code ?? body.error ?? `http_${status}`;
    this.userMessage = body.userMessage ?? null;
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    reportDown('server');
    throw err;
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const e = new ApiError(res.status, (body ?? {}) as Record<string, string>);
    if (e.code === 'navidrome.unreachable') reportDown('navidrome');
    throw e;
  }
  return body as T;
}
