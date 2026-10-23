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
