import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { REQUIRED_SCOPES } from '../shared/spotify-scopes.ts';
import { SPOTIFY_SEATS, spotifyClientSecret, spotifySeatsUsed, spotifySettings } from './admin.ts';
import { audit } from './audit.ts';
import type { AuthEnv } from './auth/routes.ts';
import type { Sealer } from './crypto.ts';
import type { Db } from './db/db.ts';
import type { Log } from './log.ts';

// Each user's Spotify connection (SETTINGS_AND_SECURITY.md §6.2, PLAYBACK_ARCHITECTURE.md §4.2):
// Authorization Code with PKCE against the admin's app (no client secret). The verifier and state
// live in memory for 10 minutes, bound to the session that started the flow; the refresh token is
// sealed in `connections`, the access token stays in memory and reaches only its own user's
// browser (`POST /spotify/token`), refreshed when fewer than 5 minutes remain.

export const SPOTIFY_SCOPES = REQUIRED_SCOPES;
const FLOW_TTL = 10 * 60_000;
const REFRESH_MARGIN = 5 * 60_000;
const SEALED = (userId: number) =>
  ({ table: 'connections', rowId: `${userId}|spotify`, column: 'secret_enc' }) as const;

export interface SpotifyDeps {
  db: Db;
  sealer: Sealer;
  now: () => number;
  /** https://accounts.spotify.com and https://api.spotify.com, overridable for the E2E mock. */
  accountsUrl: string;
  apiUrl: string;
  /** ECHO's public origin for the redirect URI; the request's own origin when unset (development). */
  publicOrigin: string | null;
  fetch?: typeof fetch;
}

export type SpotifyStatus = 'connected' | 'expired' | 'premium_required' | 'not_on_user_list';

interface Flow {
  userId: number;
  sessionHash: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

const b64url = (b: Buffer) => b.toString('base64url');
const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** `scopes`: what the user granted, as Spotify last said; empty when it never said. */
export type TokenResult =
  | { accessToken: string; expiresAt: number; scopes: string[] }
  | { error: 'not_connected' | 'expired' | 'unavailable' };

/**
 * The app's own token (client credentials) for Spotify's search, used only to match Navidrome tracks
 * (lyrics/spotifyMatch.ts): no user's account is involved. Null without a saved client secret or
 * when Spotify refuses; cached until a minute before it expires.
 */
export function createSpotifyAppToken(deps: SpotifyDeps, log?: Log) {
  const f: typeof fetch = (url, init) => (deps.fetch ?? fetch)(url, init);
  let cached: { token: string; expiresAt: number; for: string } | null = null;
  // A refusal is logged when it first happens or changes, not on every track that asks again.
  let lastRefusal = '';
  const refused = (extra: Record<string, unknown>) => {
    const sig = JSON.stringify(extra);
    if (sig !== lastRefusal) log?.('warn', 'spotify app token refused', extra);
    lastRefusal = sig;
    return null;
  };
  return async (): Promise<string | null> => {
    const { clientId } = spotifySettings(deps.db);
    const secret = spotifyClientSecret(deps.db, deps.sealer);
    if (!clientId || !secret) return null;
    if (cached && cached.for === clientId && cached.expiresAt > deps.now()) return cached.token;
    try {
      const res = await f(`${deps.accountsUrl}/api/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(8000),
      });
      const b = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (!res.ok || !b.access_token)
        return refused({
          status: res.status,
          error: b.error,
          detail: b.error_description,
          ...(res.status === 429 && {
            retryAfterS: Number(res.headers.get('retry-after')) || null,
          }),
        });
      lastRefusal = '';
      cached = {
        token: b.access_token,
        expiresAt: deps.now() + ((b.expires_in ?? 3600) - 60) * 1000,
        for: clientId,
      };
      return cached.token;
    } catch (err) {
      return refused({ detail: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * Each connected user's tokens: the sealed refresh token in `connections`, the access token in
 * memory, refreshed with under 5 minutes left, one refresh per user at a time (Spotify may rotate
 * the refresh token).
 */
export function createSpotifyTokens(deps: SpotifyDeps) {
  const f: typeof fetch = (url, init) => (deps.fetch ?? fetch)(url, init);
  const tokens = new Map<number, { accessToken: string; expiresAt: number; scopes: string[] }>();
  // Spotify may leave `scope` out of a refresh: the last one it gave holds until it says otherwise.
  const granted = new Map<number, string[]>();
  const scopesOf = (userId: number, scope: string | undefined) => {
    if (scope !== undefined) granted.set(userId, scope.split(' ').filter(Boolean));
    return granted.get(userId) ?? [];
  };
  const refreshing = new Map<number, Promise<TokenResult>>();

  const row = (userId: number) =>
    deps.db
      .prepare(
        "SELECT config_json, secret_enc, status FROM connections WHERE user_id = ? AND provider = 'spotify'",
      )
      .get(userId) as
      | { config_json: string; secret_enc: string | null; status: string }
      | undefined;

  const setStatus = (userId: number, status: SpotifyStatus) =>
    deps.db
      .prepare(
        "UPDATE connections SET status = ?, updated_at = ? WHERE user_id = ? AND provider = 'spotify'",
      )
      .run(status, deps.now(), userId);

  async function tokenRequest(clientId: string, params: Record<string, string>) {
    const res = await f(`${deps.accountsUrl}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...params }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    return { ok: res.ok && typeof body.access_token === 'string', body };
  }

  /** Who the token belongs to; a 403 means the account is not on the app's user list. */
  async function profile(accessToken: string) {
    const res = await f(`${deps.apiUrl}/v1/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403) return 'not_on_user_list' as const;
    if (!res.ok) throw new Error(`spotify /me ${res.status}`);
    const me = (await res.json()) as { id?: string; display_name?: string; product?: string };
    return { id: String(me.id ?? ''), name: me.display_name ?? null, product: me.product ?? null };
  }

  async function refresh(userId: number): Promise<TokenResult> {
    const r = row(userId);
    const { clientId } = spotifySettings(deps.db);
    if (!r?.secret_enc || !clientId) return { error: 'not_connected' };
    const refreshToken = deps.sealer.tryOpen(r.secret_enc, SEALED(userId));
    if (refreshToken === null) {
      // Sealed with another master key (a restore without it): reconnect.
      setStatus(userId, 'expired');
      return { error: 'expired' };
    }
    let out: Awaited<ReturnType<typeof tokenRequest>>;
    try {
      out = await tokenRequest(clientId, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    } catch {
      return { error: 'unavailable' };
    }
    if (!out.ok) {
      if (out.body.error === 'invalid_grant') {
        setStatus(userId, 'expired');
        tokens.delete(userId);
        return { error: 'expired' };
      }
      return { error: 'unavailable' };
    }
    // A refresh without a new refresh token keeps the old one [C].
    if (out.body.refresh_token && out.body.refresh_token !== refreshToken)
      deps.db
        .prepare(
          "UPDATE connections SET secret_enc = ?, updated_at = ? WHERE user_id = ? AND provider = 'spotify'",
        )
        .run(deps.sealer.seal(out.body.refresh_token, SEALED(userId)), deps.now(), userId);
    if (r.status === 'expired') {
      const { product } = JSON.parse(r.config_json) as { product?: string };
      setStatus(userId, product === 'premium' ? 'connected' : 'premium_required');
    }
    const t = {
      accessToken: out.body.access_token as string,
      expiresAt: deps.now() + (out.body.expires_in ?? 3600) * 1000,
      scopes: scopesOf(userId, out.body.scope),
    };
    tokens.set(userId, t);
    return t;
  }

  return {
    f,
    row,
    tokenRequest,
    profile,
    remember: (
      userId: number,
      t: { accessToken: string; expiresAt: number; scope: string | undefined },
    ) =>
      tokens.set(userId, {
        accessToken: t.accessToken,
        expiresAt: t.expiresAt,
        scopes: scopesOf(userId, t.scope),
      }),
    forget: (userId: number) => {
      tokens.delete(userId);
      granted.delete(userId);
    },
    /** A live access token for the user, refreshing when fewer than 5 minutes remain. */
    async accessToken(userId: number): Promise<TokenResult> {
      // Only while connected: user ids are reused after a delete, and a disconnect during a refresh
      // must not leave a token behind.
      if (!row(userId)?.secret_enc) {
        tokens.delete(userId);
        granted.delete(userId);
        return { error: 'not_connected' };
      }
      const have = tokens.get(userId);
      if (have && have.expiresAt - deps.now() > REFRESH_MARGIN) return have;
      let p = refreshing.get(userId);
      if (!p) {
        p = refresh(userId).finally(() => refreshing.delete(userId));
        refreshing.set(userId, p);
      }
      return p;
    },
  };
}

export type SpotifyTokens = ReturnType<typeof createSpotifyTokens>;

export function spotifyRoutes(
  deps: SpotifyDeps,
  requireUser: MiddlewareHandler<AuthEnv>,
  t: SpotifyTokens = createSpotifyTokens(deps),
) {
  const app = new Hono<AuthEnv>();
  const flows = new Map<string, Flow>();
  const { row, tokenRequest, profile } = t;
  const sweep = () => {
    for (const [k, v] of flows) if (v.expiresAt <= deps.now()) flows.delete(k);
  };

  app.get('/spotify/login', requireUser, (c) => {
    const user = c.var.user;
    const { clientId } = spotifySettings(deps.db);
    if (!clientId) return c.json({ error: 'spotify.not_configured' }, 409);
    if (!row(user.id) && spotifySeatsUsed(deps.db) >= SPOTIFY_SEATS)
      return c.json({ error: 'spotify.seats_full' }, 409);
    sweep();
    const verifier = b64url(randomBytes(64));
    const state = b64url(randomBytes(32));
    const redirectUri = `${deps.publicOrigin ?? new URL(c.req.url).origin}/api/v1/spotify/callback`;
    flows.set(state, {
      userId: user.id,
      sessionHash: user.sessionHash,
      verifier,
      redirectUri,
      expiresAt: deps.now() + FLOW_TTL,
    });
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      state,
      scope: SPOTIFY_SCOPES.join(' '),
    });
    return c.redirect(`${deps.accountsUrl}/authorize?${q}`, 302);
  });

  app.get('/spotify/callback', requireUser, async (c: Context<AuthEnv>) => {
    const user = c.var.user;
    const back = (result: string) =>
      c.redirect(`/settings/account?spotify=${encodeURIComponent(result)}`, 302);
    const { state = '', code, error } = c.req.query();
    sweep();
    // Single use: whatever happens next, this state is spent.
    const key = [...flows.keys()].find((k) => sameText(k, state));
    const flow = key ? flows.get(key) : undefined;
    if (key) flows.delete(key);
    if (!flow || flow.userId !== user.id || flow.sessionHash !== user.sessionHash)
      return back('bad_state');
    if (error || !code) return back(error === 'access_denied' ? 'denied' : 'failed');
    const { clientId } = spotifySettings(deps.db);
    if (!clientId) return back('not_configured');
    let me: Awaited<ReturnType<typeof profile>>;
    let out: Awaited<ReturnType<typeof tokenRequest>>;
    try {
      out = await tokenRequest(clientId, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
      });
      if (!out.ok || !out.body.refresh_token) return back('failed');
      me = await profile(out.body.access_token as string);
    } catch {
      return back('failed');
    }
    if (me === 'not_on_user_list') return back('not_on_user_list');
    // Seats are checked again: another user may have connected while this one was at Spotify.
    if (!row(user.id) && spotifySeatsUsed(deps.db) >= SPOTIFY_SEATS) return back('seats_full');
    const status: SpotifyStatus = me.product === 'premium' ? 'connected' : 'premium_required';
    deps.db
      .prepare(
        `INSERT INTO connections (user_id, provider, config_json, secret_enc, status, updated_at)
         VALUES (?, 'spotify', ?, ?, ?, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET config_json = excluded.config_json,
           secret_enc = excluded.secret_enc, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(
        user.id,
        JSON.stringify({ spotifyUserId: me.id, displayName: me.name, product: me.product }),
        deps.sealer.seal(out.body.refresh_token, SEALED(user.id)),
        status,
        deps.now(),
      );
    t.remember(user.id, {
      accessToken: out.body.access_token as string,
      expiresAt: deps.now() + (out.body.expires_in ?? 3600) * 1000,
      scope: out.body.scope,
    });
    audit(deps.db, deps.now(), user.id, 'spotify.connected', { product: me.product });
    return back(status);
  });

  app.post('/spotify/token', requireUser, async (c) => {
    c.header('Cache-Control', 'no-store');
    const r = await t.accessToken(c.var.user.id);
    if ('error' in r) {
      const status = r.error === 'unavailable' ? 503 : r.error === 'expired' ? 401 : 404;
      return c.json({ error: `spotify.${r.error}` }, status);
    }
    return c.json(r);
  });

  app.get('/spotify/status', requireUser, (c) => {
    const s = spotifySettings(deps.db);
    const r = row(c.var.user.id);
    const config = r
      ? (JSON.parse(r.config_json) as { displayName?: string; product?: string })
      : {};
    return c.json({
      configured: s.clientId !== null,
      clientId: s.clientId,
      gates: s.gates,
      seatsFull: !r && spotifySeatsUsed(deps.db) >= SPOTIFY_SEATS,
      connection: r
        ? {
            status: r.status as SpotifyStatus,
            displayName: config.displayName ?? null,
            product: config.product ?? null,
          }
        : null,
    });
  });

  app.delete('/spotify/connection', requireUser, (c) => {
    const id = c.var.user.id;
    deps.db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = 'spotify'").run(id);
    t.forget(id);
    audit(deps.db, deps.now(), id, 'spotify.disconnected');
    return c.json({ ok: true });
  });

  return app;
}
