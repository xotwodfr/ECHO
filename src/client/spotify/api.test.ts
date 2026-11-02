import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_SCOPES } from '../../shared/spotify-scopes.ts';

// The Web API helper (PLAYBACK_ARCHITECTURE.md §4.5): a 403 for a missing scope is a reconnect,
// not "missing from the app's user list"; the token says which scopes the user granted.

const granted = ['streaming', 'user-library-read'];
vi.mock('../api.ts', () => ({
  ApiError: class extends Error {},
  api: async () => ({ accessToken: 'at', expiresAt: Date.now() + 3_600_000, scopes: granted }),
}));
const { forgetSpotifyToken, missingScopes, spotifyApi, spotifyToken } = await import('./api.ts');

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

  it('missingScopes lists what the token lacks', async () => {
    await spotifyToken();
    expect(missingScopes()).toEqual(REQUIRED_SCOPES.filter((s) => !granted.includes(s)));
  });
});
