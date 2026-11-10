import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession, sessionStore } from './session.ts';

// PR xotwodfr/ECHO#4's first full CI run: Firefox reported a render error on /settings/account,
// "can't access property "status", e is null". api() answers null for a 2xx whose body does not
// parse (a read cut short when the page moves on), and loadSession stored that as the session, so
// every `session.status` in the top bar threw and the app fell back to its reload screen.

const signedIn = {
  status: 'signedIn',
  username: 'ada',
  role: 'user',
  navidrome: true,
} as const;

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStore.setState({ status: 'unknown' }, true);
  });

  it('stores the session the server answers', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(signedIn)));
    await expect(loadSession()).resolves.toEqual(signedIn);
    expect(sessionStore.getState()).toEqual(signedIn);
  });

  it('keeps the session it has when an answer is not a session', async () => {
    sessionStore.setState(signedIn, true);
    for (const body of ['', 'null', '{"ok":true}']) {
      vi.stubGlobal('fetch', async () => new Response(body));
      await expect(loadSession()).resolves.toEqual(signedIn);
      expect(sessionStore.getState()).toEqual(signedIn);
    }
  });
});
