import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
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
    await expect(api('/session')).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(0); // the first probe (also a 502)
    expect(connectionStore.getState().server.down).toBe(true);
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
});
