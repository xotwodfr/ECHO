import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REQUIRED_SCOPES } from '../shared/spotify-scopes.ts';
import { createSession } from './auth/sessions.ts';
import { createSpotifyAppToken } from './spotify.ts';
import { call, testDeps } from './testing.ts';

// SETTINGS_AND_SECURITY.md §6.2: PKCE bound to the session, sealed refresh tokens, per-user access
// tokens, seats, and the error states, against a fake Spotify.

const CLIENT_ID = 'c'.repeat(32);

function fakeSpotify() {
  const s = {
    product: 'premium',
    meStatus: 200,
    refreshError: null as string | null,
    rotate: false,
    /** What the token response grants (`scope`); undefined: omitted, as some refreshes do. */
    scope: 'streaming user-library-read' as string | undefined,
    issued: 0,
    challenge: '',
    verifiers: [] as string[],
    requests: [] as URLSearchParams[],
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://accounts.spotify.test/api/token') {
      const p = new URLSearchParams(String(init?.body));
      s.requests.push(p);
      if (p.get('grant_type') === 'authorization_code') {
        s.verifiers.push(p.get('code_verifier') ?? '');
        if (p.get('code') !== 'good-code')
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
      } else if (s.refreshError) return Response.json({ error: s.refreshError }, { status: 400 });
      s.issued++;
      return Response.json({
        access_token: `at-${s.issued}`,
        expires_in: 3600,
        ...(s.scope !== undefined && { scope: s.scope }),
        ...((p.get('grant_type') === 'authorization_code' || s.rotate) && {
          refresh_token: `rt-${s.issued}`,
        }),
      });
    }
    if (u === 'https://api.spotify.test/v1/me') {
      if (s.meStatus !== 200) return new Response('{}', { status: s.meStatus });
      return Response.json({ id: 'sp-user', display_name: 'Ada', product: s.product });
    }
    return new Response('{}', { status: 404 });
  };
  return { s, fetch: fetch as typeof globalThis.fetch };
}

describe('createSpotifyAppToken', () => {
  const SECRET = { table: 'server_settings', rowId: 'spotify.clientSecret', column: 'secret_enc' };
  function appToken(reply: () => Response) {
    const t = testDeps();
    const db = t.deps.auth.db;
    db.prepare("INSERT INTO server_settings (key, value_json) VALUES ('spotify.clientId', ?)").run(
      JSON.stringify(CLIENT_ID),
    );
    db.prepare(
      "INSERT INTO server_settings (key, secret_enc) VALUES ('spotify.clientSecret', ?)",
    ).run(t.deps.spotify.sealer.seal('shh-secret', SECRET));
    const logs: { msg: string; extra?: Record<string, unknown> }[] = [];
    let asked = 0;
    const get = createSpotifyAppToken(
      {
        ...t.deps.spotify,
        fetch: (async () => {
          asked++;
          return reply();
        }) as unknown as typeof fetch,
      },
      (_level, msg, extra) => logs.push({ msg, extra }),
    );
    return { get, logs, asked: () => asked };
  }

  it('a refusal is logged once with Spotify’s reason, and gives no token', async () => {
    const x = appToken(() =>
      Response.json(
        { error: 'invalid_client', error_description: 'Invalid client secret' },
        { status: 400 },
      ),
    );
    expect(await x.get()).toBeNull();
    expect(await x.get()).toBeNull();
    expect(x.asked()).toBe(2);
    expect(x.logs).toHaveLength(1); // the same refusal again is not logged again
    expect(x.logs[0]).toMatchObject({
      msg: 'spotify app token refused',
      extra: { status: 400, error: 'invalid_client', detail: 'Invalid client secret' },
    });
  });

  it('a good answer is cached and logs nothing', async () => {
    const x = appToken(() => Response.json({ access_token: 'at', expires_in: 3600 }));
    expect(await x.get()).toBe('at');
    expect(await x.get()).toBe('at');
    expect(x.asked()).toBe(1);
    expect(x.logs).toHaveLength(0);
  });
});

function setup() {
  const fake = fakeSpotify();
  const t = testDeps();
  t.deps.spotify.fetch = fake.fetch;
  const db = t.deps.auth.db;
  db.prepare("INSERT INTO server_settings (key, value_json) VALUES ('spotify.clientId', ?)").run(
    JSON.stringify(CLIENT_ID),
  );
  const user = (name: string) => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
        )
        .run(name).lastInsertRowid,
    );
    return { id, cookie: `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}` };
  };
  return { t, db, fake, user };
}

type Setup = ReturnType<typeof setup>;

async function login(t: Setup['t'], cookie: string) {
  const res = await call(t.app, 'GET', '/api/v1/spotify/login', undefined, cookie);
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location') as string);
}

async function connect(x: Setup, who: { cookie: string }) {
  const auth = await login(x.t, who.cookie);
  const state = auth.searchParams.get('state');
  const res = await call(
    x.t.app,
    'GET',
    `/api/v1/spotify/callback?code=good-code&state=${state}`,
    undefined,
    who.cookie,
  );
  return {
    auth,
    res,
    result: new URL(res.headers.get('location') as string, 'http://x').searchParams.get('spotify'),
  };
}

describe('Spotify PKCE', () => {
  it('needs the admin’s Client ID first', async () => {
    const x = setup();
    x.db.prepare("DELETE FROM server_settings WHERE key = 'spotify.clientId'").run();
    const a = x.user('ada');
    const res = await call(x.t.app, 'GET', '/api/v1/spotify/login', undefined, a.cookie);
    expect(res.status).toBe(409);
  });

  it('redirects with S256 over the verifier it later sends, the scopes and the redirect URI', async () => {
    const x = setup();
    const a = x.user('ada');
    const { auth, result } = await connect(x, a);
    expect(auth.origin + auth.pathname).toBe('https://accounts.spotify.test/authorize');
    const q = auth.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe('http://localhost/api/v1/spotify/callback');
    expect(q.get('scope')).toContain('streaming');
    const verifier = x.fake.s.verifiers[0] as string;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(q.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(x.fake.s.requests[0]?.get('client_secret')).toBeNull();
    expect(result).toBe('connected');
  });

  it('seals the refresh token; the access token reaches only its own user', async () => {
    const x = setup();
    const a = x.user('ada');
    const b = x.user('bo');
    await connect(x, a);
    const stored = x.db
      .prepare("SELECT secret_enc FROM connections WHERE user_id = ? AND provider = 'spotify'")
      .pluck()
      .get(a.id) as string;
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('rt-1');
    const tok = await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, a.cookie);
    expect(tok.headers.get('cache-control')).toBe('no-store');
    const text = await tok.text();
    expect(JSON.parse(text)).toMatchObject({ accessToken: 'at-1' });
    expect(text).not.toContain('rt-1');
    expect((await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, b.cookie)).status).toBe(
      404,
    );
  });

  it('the token says which scopes it carries, kept when a refresh omits them', async () => {
    const x = setup();
    const a = x.user('ada');
    await connect(x, a);
    const token = async () =>
      (await (
        await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, a.cookie)
      ).json()) as { scopes: string[] };
    expect((await token()).scopes).toEqual(['streaming', 'user-library-read']);
    x.fake.s.scope = undefined;
    x.t.clock.t += 60 * 60_000; // refreshed, without a scope in the answer
    expect((await token()).scopes).toEqual(['streaming', 'user-library-read']);
  });

  it('asks Spotify for every scope ECHO needs', async () => {
    const x = setup();
    const a = x.user('ada');
    const q = await login(x.t, a.cookie);
    expect(q.searchParams.get('scope')).toBe(REQUIRED_SCOPES.join(' '));
  });

  it('a state is single use and belongs to the session that started the flow', async () => {
    const x = setup();
    const a = x.user('ada');
    const b = x.user('bo');
    const state = (await login(x.t, a.cookie)).searchParams.get('state');
    const cb = (cookie: string) =>
      call(
        x.t.app,
        'GET',
        `/api/v1/spotify/callback?code=good-code&state=${state}`,
        undefined,
        cookie,
      );
    // Another user's browser with A's state (a login CSRF): refused, and the state is spent.
    expect((await cb(b.cookie)).headers.get('location')).toContain('spotify=bad_state');
    expect((await cb(a.cookie)).headers.get('location')).toContain('spotify=bad_state');
    expect(x.fake.s.requests).toHaveLength(0);

    // A second session of the same user cannot finish it either.
    const other = `__Host-echo_session=${createSession(x.db, a.id, 'web', x.t.clock.t)}`;
    const s2 = (await login(x.t, a.cookie)).searchParams.get('state');
    const r = await call(
      x.t.app,
      'GET',
      `/api/v1/spotify/callback?code=good-code&state=${s2}`,
      undefined,
      other,
    );
    expect(r.headers.get('location')).toContain('spotify=bad_state');
  });

  it('a state expires after 10 minutes', async () => {
    const x = setup();
    const a = x.user('ada');
    const state = (await login(x.t, a.cookie)).searchParams.get('state');
    x.t.clock.t += 10 * 60_000 + 1;
    const r = await call(
      x.t.app,
      'GET',
      `/api/v1/spotify/callback?code=good-code&state=${state}`,
      undefined,
      a.cookie,
    );
    expect(r.headers.get('location')).toContain('spotify=bad_state');
  });

  it('names Free accounts, accounts missing from the app’s user list, and a refused consent', async () => {
    const x = setup();
    x.fake.s.product = 'free';
    expect((await connect(x, x.user('ada'))).result).toBe('premium_required');
    x.fake.s.meStatus = 403;
    const bo = x.user('bo');
    expect((await connect(x, bo)).result).toBe('not_on_user_list');
    expect(
      x.db.prepare('SELECT COUNT(*) FROM connections WHERE user_id = ?').pluck().get(bo.id),
    ).toBe(0);
    const state = (await login(x.t, bo.cookie)).searchParams.get('state');
    const r = await call(
      x.t.app,
      'GET',
      `/api/v1/spotify/callback?error=access_denied&state=${state}`,
      undefined,
      bo.cookie,
    );
    expect(r.headers.get('location')).toContain('spotify=denied');
  });

  it('five seats: a sixth user cannot start, connected users can reconnect', async () => {
    const x = setup();
    const users = ['a', 'b', 'c', 'd', 'e'].map((n) => x.user(n));
    for (const u of users) expect((await connect(x, u)).result).toBe('connected');
    const sixth = x.user('f');
    expect(
      (await call(x.t.app, 'GET', '/api/v1/spotify/login', undefined, sixth.cookie)).status,
    ).toBe(409);
    const st = await call(x.t.app, 'GET', '/api/v1/spotify/status', undefined, sixth.cookie);
    expect((await st.json()).seatsFull).toBe(true);
    expect((await connect(x, users[0] as { cookie: string })).result).toBe('connected');
  });

  it('refreshes with under 5 minutes left, keeps the refresh token unless rotated', async () => {
    const x = setup();
    const a = x.user('ada');
    await connect(x, a); // at-1, rt-1
    const token = async () =>
      (await (
        await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, a.cookie)
      ).json()) as {
        accessToken: string;
      };
    x.t.clock.t += 54 * 60_000;
    expect((await token()).accessToken).toBe('at-1');
    x.t.clock.t += 2 * 60_000; // 4 minutes left
    expect((await token()).accessToken).toBe('at-2');
    expect(x.fake.s.requests.at(-1)?.get('refresh_token')).toBe('rt-1');
    x.fake.s.rotate = true;
    x.t.clock.t += 60 * 60_000;
    expect((await token()).accessToken).toBe('at-3'); // and rt-3 replaces rt-1
    x.t.clock.t += 60 * 60_000;
    await token();
    expect(x.fake.s.requests.at(-1)?.get('refresh_token')).toBe('rt-3');
  });

  it('invalid_grant: "Sign-in expired" until the user reconnects', async () => {
    const x = setup();
    const a = x.user('ada');
    await connect(x, a);
    x.fake.s.refreshError = 'invalid_grant';
    x.t.clock.t += 60 * 60_000;
    const r = await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, a.cookie);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'spotify.expired' });
    const st = await (
      await call(x.t.app, 'GET', '/api/v1/spotify/status', undefined, a.cookie)
    ).json();
    expect(st.connection).toMatchObject({ status: 'expired', displayName: 'Ada' });
  });

  // ON-SEC-2: user ids are reused (INTEGER PRIMARY KEY), and the access token cache is keyed by id.
  it('a deleted user’s cached access token never reaches the next user with the same id', async () => {
    const x = setup();
    const a = x.user('ada');
    await connect(x, a);
    x.db.prepare('DELETE FROM users WHERE id = ?').run(a.id); // cascades to the connection
    const c = x.user('cy');
    expect(c.id).toBe(a.id);
    const r = await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, c.cookie);
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain('at-');
  });

  it('disconnect deletes the row and frees the seat', async () => {
    const x = setup();
    const a = x.user('ada');
    await connect(x, a);
    expect(
      (await call(x.t.app, 'DELETE', '/api/v1/spotify/connection', undefined, a.cookie)).status,
    ).toBe(200);
    expect(x.db.prepare('SELECT COUNT(*) FROM connections').pluck().get()).toBe(0);
    expect((await call(x.t.app, 'POST', '/api/v1/spotify/token', undefined, a.cookie)).status).toBe(
      404,
    );
  });
});
