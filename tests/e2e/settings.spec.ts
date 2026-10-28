import { expect, type Page, test } from '@playwright/test';
import { fromBase32, hotp, stepAt } from '../../src/server/auth/totp.ts';
import { E2E_PASSWORD, signedIn } from './helpers.ts';

// M8: Preferences (persisted per user, per device), Account (password, two-factor, sessions,
// deletion), Admin (invites, users) and the invite page. SEC-14, ACC-02, ACC-03 end to end.

const code = (secret: string) => hotp(fromBase32(secret), stepAt(Date.now()));

async function freshSession(page: Page, username: string) {
  // A second browser session for the same user, through the API (the login form is rate limited).
  const res = await page.request.post('/api/v1/auth/login', {
    data: { username, password: E2E_PASSWORD },
    headers: { origin: 'http://localhost:18787' },
  });
  expect(res.ok()).toBe(true);
}

test('Preferences save themselves, follow the user, and keep per-device keys local', async ({
  page,
  context,
}) => {
  await signedIn(page, 'pref');
  await page.goto('/settings');
  const intensity = page.getByRole('group', { name: 'Reverb intensity' });
  await intensity.getByRole('button', { name: 'Subtle' }).click();
  await page
    .getByRole('group', { name: 'Lyric size' })
    .getByRole('button', { name: 'Large', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Show lyrics without timing' }).click();
  await page
    .getByRole('group', { name: 'Streaming quality' })
    .getByRole('button', { name: '128 kbps' })
    .click();
  await expect
    .poll(
      async () => (await (await page.request.get('/api/v1/me/settings')).json()).visuals.intensity,
    )
    .toBe('subtle');
  const server = await (await page.request.get('/api/v1/me/settings')).json();
  expect(server.lyrics).toMatchObject({ sizeScale: 1.15, showUnsynced: false });
  expect(server.playback.quality).toBeUndefined(); // per device: never on the server
  expect(await page.evaluate(() => localStorage.getItem('echo.playback.quality'))).toBe('"128"');
  await page.reload();
  await expect(intensity.getByRole('button', { name: 'Subtle' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('switch', { name: 'Show lyrics without timing' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // The lyric size reaches the Stage's CSS.
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--ly-scale')),
  ).toBe('1.15');
  // Another device of the same user: the synced keys follow, the device key does not.
  const other = await context.browser()?.newContext({ baseURL: 'http://localhost:18787' });
  const p2 = (await other?.newPage()) as Page;
  await p2.goto('/login');
  const cookies = await context.cookies();
  await other?.addCookies(cookies);
  await p2.goto('/settings');
  await expect(
    p2.getByRole('group', { name: 'Reverb intensity' }).getByRole('button', { name: 'Subtle' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    p2.getByRole('group', { name: 'Streaming quality' }).getByRole('button', { name: 'Auto' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await other?.close();
});

test('SEC-14: changing the password signs out every other session', async ({ page }) => {
  const user = await signedIn(page, 'pw');
  await freshSession(page, user); // page.request shares the cookie jar: it now holds the new one
  await page.goto('/settings/account');
  // This browser's cookie is the API login's now; sessions: the helper's and the API's.
  const sessions = page.getByRole('region', { name: 'Sessions & devices' });
  await expect(sessions.getByRole('listitem')).toHaveCount(2);
  await page.getByLabel('Current password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Signed out 1 other session.')).toBeVisible();
  await page.reload();
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
});

test('two-factor on from Account: the key, a code, recovery codes once', async ({ page }) => {
  await signedIn(page, 'tf');
  await page.goto('/settings/account');
  const block = page.getByRole('region', { name: /Two-factor sign-in/ });
  await block.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await block.getByRole('button', { name: 'Turn on' }).click();
  const key = (await block.locator('.totp-key code').innerText()).replace(/\s/g, '');
  await block.getByLabel('Authentication code').fill(code(key));
  await block.getByRole('button', { name: 'Verify' }).click();
  await expect(block.locator('.recovery-codes li')).toHaveCount(10);
  await expect(block.getByText('On', { exact: true })).toBeVisible();
});

test('ACC-02: an admin invites; the invitee joins as a plain user who sees none of the admin', async ({
  page,
  browser,
}) => {
  await signedIn(page, 'adm', 'admin');
  await page.goto('/settings/admin');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const link = await page.locator('.invite-link code').innerText();
  expect(link).toMatch(/\/invite#[\w-]{43}$/);
  await expect(
    page.getByRole('region', { name: 'Users & invites' }).getByText(/expires/),
  ).toBeVisible();

  const ctx = await browser.newContext({ baseURL: 'http://localhost:18787' });
  const guest = await ctx.newPage();
  await guest.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  const name = `inv-${Date.now().toString(36)}`;
  await guest.getByLabel('Username').fill(name);
  await guest.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await guest.getByRole('button', { name: 'Create account' }).click();
  await expect(guest).toHaveURL(/\/$/);
  expect(await (await guest.request.get('/api/v1/me')).json()).toEqual({
    username: name,
    role: 'user',
  });
  await guest.goto('/settings');
  await expect(guest.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  expect((await guest.request.get('/api/v1/admin/users')).status()).toBe(403);
  // The link works once.
  const again = await ctx.newPage();
  await ctx.clearCookies();
  await again.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await again.getByLabel('Username').fill(`${name}x`);
  await again.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await again.getByRole('button', { name: 'Create account' }).click();
  await expect(again.getByText('This invite is used, revoked or expired.')).toBeVisible();
  await ctx.close();
});

test('ACC-03: deleting the account needs the password, and signs out for good', async ({
  page,
}) => {
  const user = await signedIn(page, 'del');
  await page.goto('/settings/account');
  const block = page.getByRole('region', { name: 'Delete account' });
  await block.getByRole('button', { name: 'Delete account' }).click();
  await block.getByLabel('Password', { exact: true }).fill('not my password!');
  await block.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete account' }).click();
  await expect(block.getByText('That password is not right.')).toBeVisible();
  await block.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await block.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const login = await page.request.post('/api/v1/auth/login', {
    data: { username: user, password: E2E_PASSWORD },
    headers: { origin: 'http://localhost:18787' },
  });
  expect(login.status()).toBe(401);
});

// ON-UI-4: a failed audit-log load showed "No entries yet", saying nothing had happened.
test('the audit log says when it could not load, and Retry recovers', async ({ page }) => {
  await signedIn(page, 'adm', 'admin');
  let fail = true;
  await page.route('**/api/v1/admin/audit?*', (r) => (fail ? r.abort() : r.continue()));
  await page.goto('/settings/admin');
  const err = page.getByRole('alert').filter({ hasText: "Couldn't load this." });
  await expect(err).toBeVisible();
  fail = false;
  await err.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(err).toHaveCount(0);
});
