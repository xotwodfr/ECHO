import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, retryDelay } from './api.ts';
import { connectionStore } from './connection.ts';

// ON-UI-1: what marks the ECHO server unreachable (REL-01). Behind Caddy, a restarting ECHO is not a
// failed fetch but a bodiless 502; ECHO's own 5xx answers always carry a code.

const reply = (status: number, body: string | object) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('api() and reachability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connectionStore.setState({ server: { down: false }, navidrome: { down: false } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a proxy 502 with no ECHO body marks the server unreachable', async () => {
    vi.stubGlobal('fetch', reply(502, '<html>Bad Gateway</html>'));
    const failed = expect(api('/session')).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(0); // the first probe (also a 502)
    expect(connectionStore.getState().server.down).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); // the retries
    await failed;
  });

  it("ECHO's own 502 (Navidrome unreachable) blames Navidrome, not the server", async () => {
    vi.stubGlobal('fetch', reply(502, { code: 'navidrome.unreachable' }));
    await expect(api('/navidrome/rest/ping')).rejects.toMatchObject({
      code: 'navidrome.unreachable',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionStore.getState().server.down).toBe(false);
  });

  it('a 500 from ECHO is an error, not an outage', async () => {
    vi.stubGlobal('fetch', reply(500, { error: 'internal' }));
    await expect(api('/session')).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionStore.getState().server.down).toBe(false);
  });

  it('a GET that meets a passing failure is asked again, twice at most', async () => {
    const answers = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      reply(503, ''),
      reply(200, { ok: 1 }),
    ];
    const fetch = vi.fn(() => (answers.shift() ?? reply(502, ''))());
    vi.stubGlobal('fetch', fetch);
    const got = api('/session');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await got).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);

    const failed = expect(api('/session')).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(3000);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('a spent API budget waits for its retry-after', async () => {
    const answers = [
      async () =>
        new Response('{"error":"rate_limited"}', { status: 429, headers: { 'retry-after': '1' } }),
      reply(200, { ok: 1 }),
    ];
    const fetch = vi.fn(() => (answers.shift() as () => Promise<Response>)());
    vi.stubGlobal('fetch', fetch);
    const got = api('/me/settings');
    await vi.advanceTimersByTimeAsync(900);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(await got).toEqual({ ok: 1 });
  });

  it('a write is never sent twice, and an answer from ECHO is final', async () => {
    const fetch = vi.fn(reply(502, ''));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/me/queue', { method: 'PUT', body: {} })).rejects.toMatchObject({
      status: 502,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(reply(404, { error: 'not_found' }));
    await expect(api('/session')).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('the retry delay grows and is spread', () => {
    expect(retryDelay(0, 0)).toBe(150);
    expect(retryDelay(0, 1)).toBe(450);
    expect(retryDelay(1, 0.5)).toBe(900);
  });
});
