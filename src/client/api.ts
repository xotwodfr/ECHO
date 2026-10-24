// The ECHO server's API (TECHNICAL_ARCHITECTURE.md §6.2): same-origin JSON with the session cookie.

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
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, (body ?? {}) as Record<string, string>);
  return body as T;
}
