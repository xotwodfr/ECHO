import { createStore } from 'zustand/vanilla';
import { REQUIRED_SCOPES } from '../../shared/spotify-scopes.ts';
import type { AppError } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { strings } from '../strings.ts';

// The Spotify Web API from the browser (PLAYBACK_ARCHITECTURE.md §4.5): the short-lived access token
// comes from ECHO's server (the refresh token never leaves it). 429 honours Retry-After once; a 401
// asks ECHO for a fresh token once; a 403 means the account is missing from the app's user list.

export const SPOTIFY_API = 'https://api.spotify.com';

let cached: { accessToken: string; expiresAt: number; scopes?: string[] } | null = null;
let pending: Promise<string> | null = null;

export class SpotifyError extends Error {
  readonly appError: AppError;
  constructor(appError: AppError) {
    super(appError.code);
    this.appError = appError;
  }
}

const err = (code: string, userMessage: string, retriable = false): AppError => ({
  code,
  provider: 'spotify',
  retriable,
  userMessage,
});

/** The current user's access token, from ECHO (cached until a minute before it expires). */
export function spotifyToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000)
    return Promise.resolve(cached.accessToken);
  pending ??= api<{ accessToken: string; expiresAt: number; scopes?: string[] }>('/spotify/token', {
    method: 'POST',
  })
    .then(
      (t) => {
        cached = t;
        const missing = missingScopes();
        if (missing.join() !== spotifyScopes.getState().missing.join())
          spotifyScopes.setState({ missing });
        return t.accessToken;
      },
      (e: unknown) => {
        cached = null;
        if (e instanceof ApiError && e.status === 401)
          throw new SpotifyError(err('spotify.expired', strings.spotify.expired));
        throw new SpotifyError(err('spotify.unavailable', strings.spotify.unavailable, true));
      },
    )
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** What the current connection lacks (`missingScopes`), for the parts of the UI that wait for it. */
export const spotifyScopes = createStore<{ missing: string[] }>()(() => ({ missing: [] }));

/** A call refused for a scope the connection lacks (`spotify.scope`): treated as "nothing yet". */
export const isScopeError = (e: unknown) =>
  e instanceof SpotifyError && e.appError.code === 'spotify.scope';

/**
 * The scopes ECHO needs that the user's connection lacks (it predates them): a reconnect adds them.
 * Empty while no token has been fetched, or when the server could not say.
 */
export function missingScopes(): string[] {
  const have = cached?.scopes;
  if (!have?.length) return [];
  return REQUIRED_SCOPES.filter((s) => !have.includes(s));
}

/** Forget the token (disconnect, sign-out). */
export function forgetSpotifyToken() {
  cached = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Web API call; JSON in and out, null for 204. */
export async function spotifyApi<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number> } = {},
): Promise<T | null> {
  const url = new URL(path, SPOTIFY_API);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v));
  let retried = false;
  let refreshed = false;
  for (;;) {
    const token = await spotifyToken(refreshed);
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }).catch(() => null);
    if (!res) throw new SpotifyError(err('spotify.unavailable', strings.spotify.unavailable, true));
    if (res.status === 429 && !retried) {
      retried = true;
      await sleep(Math.min(30, Number(res.headers.get('retry-after')) || 1) * 1000);
      continue;
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (res.status === 403) {
      // A connection made before a scope was added: reconnecting grants it.
      const why = await res
        .json()
        .then((b: { error?: { message?: string } }) => b.error?.message ?? '')
        .catch(() => '');
      if (/scope/i.test(why))
        throw new SpotifyError(err('spotify.scope', strings.spotify.reconnectScopes));
      throw new SpotifyError(
        err('spotify.not_on_user_list', strings.spotify.status.not_on_user_list as string),
      );
    }
    if (res.status === 401) throw new SpotifyError(err('spotify.expired', strings.spotify.expired));
    if (!res.ok)
      throw new SpotifyError(
        err(`spotify.http_${res.status}`, strings.spotify.unavailable, res.status >= 500),
      );
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
}
