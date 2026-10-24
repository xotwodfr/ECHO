import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashSecret } from '../../src/server/auth/password.ts';

// REL-01 and REL-02 (ACCEPTANCE_CRITERIA.md) against the mock Navidrome, whose faults this spec
// switches on and off. It runs in the "isolated" project, one test at a time.

test.describe.configure({ mode: 'serial' });
const MOCK = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 18787) + 1}`;
const faults = (q = '') => fetch(`${MOCK}/__faults?${q}`);
const PASSWORD = 'correct horse battery staple';

async function signedInWithNavidrome(page: Page) {
  const user = `rel-${randomBytes(4).toString('hex')}`;
  const db = new Database(join(tmpdir(), 'echo-e2e', 'data', 'echo.db'));
  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'user', 0)",
  ).run(user, await hashSecret(PASSWORD));
  db.close();
  await page.goto('/login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/settings/account');
  await page.getByLabel('Navidrome username').fill('ada');
  await page.getByLabel('Navidrome password', { exact: true }).fill('navidrome-pass');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.afterEach(() => faults());

test('REL-02: a broken stream is reloaded, then skipped with a toast', async ({ page }) => {
  await signedInWithNavidrome(page);
  await page.goto('/library/album/al-2');
  await faults('breakStreamAt=4000'); // every stream breaks after 4 KB
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByText('This track could not be played. Skipped to the next.')).toBeVisible({
    timeout: 15_000,
  });
  await faults(); // healthy again: the track it skipped to plays
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).not.toContainText('Copper Rain 1');
  await expect(dock).toHaveAttribute('data-status', 'playing', { timeout: 15_000 });
});

test('REL-01: Navidrome down shows in the dock, and recovers on its own', async ({ page }) => {
  await signedInWithNavidrome(page);
  await faults('down=1');
  await page.goto('/library/album/al-1'); // the album's tracks need Navidrome
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock.getByRole('status')).toContainText('Navidrome unreachable');
  await faults();
  // Recovery within one backoff interval (≤ 2 s at this point), no reload.
  await expect(dock.getByRole('status')).toHaveCount(0, { timeout: 5000 });
});
