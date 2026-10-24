import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashSecret } from '../../src/server/auth/password.ts';
import { signedInWithNavidrome } from './helpers.ts';

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
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
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

test('the queue follows you to another device', async ({ page, browser }) => {
  const signIn = async (p: typeof page) => {
    await p.goto('/login');
    await p.getByLabel('Username').fill(USER);
    await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p).toHaveURL(/\/$/);
  };
  await signIn(page);
  await page.goto('/settings/account');
  await page.getByLabel('Navidrome username').fill('ada');
  await page.getByLabel('Navidrome password', { exact: true }).fill('navidrome-pass');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/library/album/al-3');
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toContainText('Glass Weather 1');
  // Saved a moment after it changed.
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get('/api/v1/me/queue')).json()) as {
            queue: { now?: { title: string } } | null;
          }
        ).queue?.now?.title,
      { timeout: 8000 },
    )
    .toBe('Glass Weather 1');

  // The other device: a fresh browser, the same account.
  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  const otherDock = other.getByRole('region', { name: 'Player' });
  await expect(otherDock).toContainText('Glass Weather 1');
  await expect(otherDock).toHaveAttribute('data-status', 'paused'); // restored, not playing
  await other.context().close();
});

test('the server library: sorts, playlists, starred and search (LIB-01, SRCH-01)', async ({
  page,
}) => {
  await signedInWithNavidrome(page);

  await page.goto('/library');
  const titles = () => page.locator('.tile').allInnerTexts();
  // Recently added first (the mock orders by year), then A–Z.
  await expect.poll(async () => (await titles())[0]).toContain('Glass Weather');
  await page.getByRole('button', { name: 'A–Z' }).click();
  await expect.poll(async () => (await titles())[0]).toContain('Copper Rain');
  await expect(page.getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/library/playlists');
  await page.getByRole('button', { name: 'Evening' }).click();
  await expect(page.getByRole('region', { name: 'Player' })).toContainText('Harbour Lights 1');

  await page.goto('/library/starred');
  await expect(page.getByRole('main').getByText('Harbour Lights 2')).toBeVisible();

  await page.goto('/search?q=glass');
  await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Glass Weather' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Glass Weather 3')).toBeVisible(); // tracks from search3
});

test('album tracks hand over without a gap (PLAY-04, two voices)', async ({ page }) => {
  await signedInWithNavidrome(page);
  await page.goto('/library/album/al-1');
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toHaveAttribute('data-status', 'playing');
  // Near the end of the 20 s first track; the second is already buffered (20 s before the end).
  const seek = dock.getByRole('slider', { name: 'Seek' });
  const box = await seek.boundingBox();
  if (!box) throw new Error('seek');
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await expect(dock).toContainText('Harbour Lights 2', { timeout: 10_000 });
  await expect(dock).toHaveAttribute('data-status', 'playing');
  const gaps = await page.evaluate(
    () => (window as unknown as { __echoGaps?: number[] }).__echoGaps ?? [],
  );
  console.log(`PLAY-04 hand-over: ${gaps.map((g) => g.toFixed(1)).join(', ')} ms`);
  expect(gaps.length).toBeGreaterThan(0);
  // PLAY-04's 50 ms is checked by hand on a real gapless album; here, under the parallel suite's load
  // on a shared machine, the hand-over is 8-9 ms when quiet and must stay well under 100 ms.
  expect(gaps.at(-1)).toBeLessThan(100);
});
