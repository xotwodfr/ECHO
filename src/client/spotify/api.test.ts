import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_SCOPES } from '../../shared/spotify-scopes.ts';

// The Web API helper (PLAYBACK_ARCHITECTURE.md §4.5): a 403 for a missing scope is a reconnect,
// not "missing from the app's user list"; the token says which scopes the user granted.

const granted = ['streaming', 'user-library-read'];
vi.mock('../api.ts', () => ({
  ApiError: class extends Error {},
  api: async () => ({ accessToken: 'at', expiresAt: Date.now() + 3_600_000, scopes: granted }),
}));
const { forgetSpotifyToken, missingScopes, spotifyApi, spotifyCooldown, spotifyToken } =
  await import('./api.ts');

const answer = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe('spotifyApi', () => {
  beforeEach(() => forgetSpotifyToken());
  afterEach(() => vi.unstubAllGlobals());

  it('403 insufficient scope → spotify.scope', async () => {
    answer(403, { error: { status: 403, message: 'Insufficient client scope' } });
    await expect(spotifyApi('/v1/me/top/tracks')).rejects.toMatchObject({
      appError: { code: 'spotify.scope' },
    });
  });

  it('other 403 → not_on_user_list', async () => {
    answer(403, {
      error: { status: 403, message: 'User not registered in the Developer Dashboard' },
    });
    await expect(spotifyApi('/v1/me')).rejects.toMatchObject({
      appError: { code: 'spotify.not_on_user_list' },
    });
  });

  it('a 403 with Spotify’s own reason shows that reason, not "user list"', async () => {
    answer(403, {
      error: {
        status: 403,
        message: 'Active premium subscription required for the owner of the app',
      },
    });
    await expect(spotifyApi('/v1/me/albums')).rejects.toMatchObject({
      appError: {
        code: 'spotify.forbidden',
        userMessage: expect.stringContaining('premium subscription required for the owner'),
      },
    });
  });

  it('a long Retry-After stops the calls instead of being slept through and repeated', async () => {
    const fetchMock = vi.fn(
      async () => new Response('', { status: 429, headers: { 'retry-after': '68167' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(spotifyApi('/v1/me/albums')).rejects.toMatchObject({
      appError: { code: 'spotify.rate_limited', userMessage: expect.stringContaining('19 hours') },
    });
    // Cooling down: later calls fail at once, without asking Spotify again.
    await expect(spotifyApi('/v1/me/playlists')).rejects.toMatchObject({
      appError: { code: 'spotify.rate_limited' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spotifyCooldown()).toBeGreaterThan(18 * 3600_000);
    forgetSpotifyToken(); // a reconnect may try again
    expect(spotifyCooldown()).toBe(0);
  });

  it('QUOTA_EXCEEDED is Development Mode’s quota, not a 30 s window: no retry, a long pause', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' },
          }),
          { status: 429 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(spotifyApi('/v1/me/albums')).rejects.toMatchObject({
      appError: { code: 'spotify.rate_limited', userMessage: expect.stringContaining('quota') },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // not slept through and asked again
    expect(spotifyCooldown()).toBeGreaterThan(10 * 60_000);
  });

  it('missingScopes lists what the token lacks', async () => {
    await spotifyToken();
    expect(missingScopes()).toEqual(REQUIRED_SCOPES.filter((s) => !granted.includes(s)));
  });
});
