import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashSecret } from '../../src/server/auth/password.ts';

// M5: the first real listening path. Sign in, connect your own Navidrome (the mock Subsonic server
// Playwright starts next to ECHO), browse it and play a track through ECHO's proxy.

const PASSWORD = 'correct horse battery staple';
let USER = '';

/** A fresh user without TOTP, straight into the E2E database. */
test.beforeEach(async ({ browserName }) => {
  USER = `e2e-${browserName}-${randomBytes(4).toString('hex')}`; // parallel runs never share one
  const db = new Database(join(tmpdir(), 'echo-e2e', 'data', 'echo.db'));
  const hash = await hashSecret(PASSWORD);
  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'user', 0)",
  ).run(USER, hash);
  db.close();
});

test('sign in, connect Navidrome, play a track from it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill('wrong password, twelve+');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Username or password is incorrect.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings/account');
  await expect(page.getByText(`Signed in as ${USER}`)).toBeVisible();
  // The server address is prefilled with ECHO_NAVIDROME_URL; the secret field never is.
  await expect(page.getByLabel('Server address')).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+$/);
  await page.getByLabel('Navidrome username').fill('ada');
  await page.getByLabel('Navidrome password', { exact: true }).fill('navidrome-pass');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(/\/$/); // reloads with the Navidrome provider

  await page.goto('/library');
  const tile = page.locator('.tile', { hasText: 'Harbour Lights' });
  await expect(tile).toBeVisible();
  await tile.getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Lights' })).toBeVisible();
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();

  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toHaveAttribute('data-status', 'playing');
  await expect(dock).toContainText('Harbour Lights 1');
  await expect(dock).toContainText('Navidrome');
  // Real audio through the proxy: song time moves on the scrubber (the clock follows the element).
  const seek = dock.getByRole('slider', { name: 'Seek' });
  const t0 = Number(await seek.getAttribute('aria-valuenow'));
  await expect
    .poll(async () => Number(await seek.getAttribute('aria-valuenow')), { timeout: 5000 })
    .toBeGreaterThan(t0 + 0.5);

  // Settings show the connection, never the secret.
  await page.goto('/settings/account');
  await expect(page.getByText(/Connected · Navidrome/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('navidrome-pass');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
