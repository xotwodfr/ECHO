import { describe, expect, it } from 'vitest';
import { app } from './index.ts';

describe('GET /api/v1/health', () => {
  it('answers ok without authentication and is not cached', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('exposes nothing else under /api', async () => {
    const res = await app.request('/api/v1/anything');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('deep-link fallback', () => {
  // Positive case (an extension-less path serves index.html) needs a built client: tests/e2e/shell.
  it('never answers a missing file with the client', async () => {
    expect((await app.request('/not-built.html')).status).toBe(404);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });
});
