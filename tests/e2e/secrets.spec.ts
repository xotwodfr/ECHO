import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { playAlbum, signedInWithNavidrome } from './helpers.ts';

// SEC-03: no secret in the client bundle, in browser storage, in what the API returned during a
// session, or in the database file in plaintext. The secrets are the E2E fixtures': the mock
// Navidrome password, and the shapes of server-side keys.

const FIXTURE_SECRETS = ['navidrome-pass'];
const SHAPES = [/sl_sk_[\w-]{6,}/, /echo_dt_[\w-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

test('SEC-03: bundle, browser storage, API responses and the database hold no secret', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for a scan');
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/api/v1/')) return;
    try {
      bodies.push(await r.text());
    } catch {} // streams and redirects have no text
  });
  await signedInWithNavidrome(page, 'sec');
  await playAlbum(page, 'al-1');
  await page.goto('/settings/account');
  await page.goto('/settings');

  // The bundle: every script and stylesheet the page loaded.
  const assets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[href]')]
      .map((e) => ('src' in e && e.src) || (e as HTMLLinkElement).href)
      .filter((u) => u.startsWith(location.origin)),
  );
  expect(assets.length).toBeGreaterThan(0);
  for (const a of assets) {
    const text = await (await page.request.get(a)).text();
    for (const s of FIXTURE_SECRETS) expect(text, a).not.toContain(s);
    for (const re of SHAPES) expect(text, a).not.toMatch(re);
  }

  // Browser storage: localStorage, sessionStorage and IndexedDB.
  const storage = await page.evaluate(async () => {
    const dump = (st: Storage) => JSON.stringify(Object.fromEntries(Object.entries(st)));
    const dbs = (await indexedDB.databases?.())?.map((d) => d.name) ?? [];
    return { local: dump(localStorage), session: dump(sessionStorage), dbs };
  });
  expect(storage.dbs).toEqual([]);
  // (document.cookie shows the session only because the E2E helper set it from script; the
  // server's own Set-Cookie is HttpOnly, checked in src/server/auth/routes.test.ts.)
  const stored = `${storage.local}${storage.session}`;
  for (const s of FIXTURE_SECRETS) expect(stored).not.toContain(s);

  // What the API sent this browser.
  const sent = bodies.join('\n');
  for (const s of FIXTURE_SECRETS) expect(sent).not.toContain(s);
  for (const re of SHAPES) expect(sent).not.toMatch(re);

  // The database file, read raw: secrets are sealed, never plaintext.
  const db = readFileSync(join(tmpdir(), 'echo-e2e', 'data', 'echo.db')).toString('latin1');
  for (const s of FIXTURE_SECRETS) expect(db).not.toContain(s);
});
