import { expect, it } from 'vitest';
import { startSetup } from './auth/routes.ts';
import { fromBase32, hotp, stepAt } from './auth/totp.ts';
import { call, cookieOf, testDeps } from './testing.ts';

// The games and appearance sections of /me/settings: each game's record, the theme and light or
// dark follow the account, and only well-formed values are stored.

async function admin() {
  const t = testDeps();
  const token = startSetup(t.deps.auth) as string;
  const start = await call(t.app, 'POST', '/api/v1/setup', {
    token,
    username: 'ada',
    password: 'correct horse battery staple',
  });
  const { secret } = (await start.json()) as { secret: string };
  const finish = await call(t.app, 'POST', '/api/v1/setup/totp', {
    token,
    code: hotp(fromBase32(secret), stepAt(t.clock.t)),
  });
  return { app: t.app, cookie: cookieOf(finish) };
}

it('keeps each game record on the account and refuses malformed ones', async () => {
  const { app, cookie } = await admin();
  const fresh = await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json();
  expect(fresh.games.songGuesser).toEqual({ best: 0, streak: 0, rounds: 0 });

  const rec = { best: 840, streak: 7, rounds: 3 };
  const put = await call(
    app,
    'PUT',
    '/api/v1/me/settings',
    { games: { songGuesser: rec } },
    cookie,
  );
  expect(put.status).toBe(200);
  const after = await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json();
  expect(after.games.songGuesser).toEqual(rec);
  expect(after.games.timeline).toEqual({ best: 0, streak: 0, rounds: 0 });

  for (const bad of [
    { best: -1, streak: 0, rounds: 0 },
    { best: 1.5, streak: 0, rounds: 0 },
    { best: 1, streak: 0 },
    { best: 1, streak: 0, rounds: 0, extra: 1 },
    [1, 2, 3],
    'high',
  ])
    expect(
      (await call(app, 'PUT', '/api/v1/me/settings', { games: { timeline: bad } }, cookie)).status,
    ).toBe(400);
  expect(
    (await call(app, 'PUT', '/api/v1/me/settings', { games: { pinball: rec } }, cookie)).status,
  ).toBe(400);
});

it('keeps the theme and light or dark on the account, and refuses unknown ones', async () => {
  const { app, cookie } = await admin();
  const fresh = await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json();
  expect(fresh.appearance).toEqual({ theme: 'echo', dark: 'theme' });

  const put = await call(
    app,
    'PUT',
    '/api/v1/me/settings',
    { appearance: { theme: 'clay', dark: 'dark' } },
    cookie,
  );
  expect(put.status).toBe(200);
  const after = await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json();
  expect(after.appearance).toEqual({ theme: 'clay', dark: 'dark' });

  for (const bad of [
    { theme: 'winamp' },
    { theme: 3 },
    { dark: 'dim' },
    { dark: true },
    { accent: 'red' },
  ])
    expect(
      (await call(app, 'PUT', '/api/v1/me/settings', { appearance: bad }, cookie)).status,
    ).toBe(400);
  const kept = await (await call(app, 'GET', '/api/v1/me/settings', undefined, cookie)).json();
  expect(kept.appearance).toEqual({ theme: 'clay', dark: 'dark' });
});
