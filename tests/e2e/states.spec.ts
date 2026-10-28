import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, faults, signedInWithNavidrome } from './helpers.ts';

// DS-07 (DESIGN_SYSTEM.md §10): loading in flat bars at the final size with no layout shift, errors
// inside their block with Retry, a freshness note while Navidrome is unreachable. REL-05: an ended
// session opens a sign-in sheet over the current screen and returns to it.

// Runs in the `isolated` project (playwright.config.ts): it breaks the shared mock Navidrome.
test.describe.configure({ mode: 'serial' });
test.afterEach(() => faults());

test('Library: skeleton tiles at the real size, then the albums with no layout shift', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'st');
  await faults('slowMs=1500');
  await page.goto('/library');
  const skeleton = page.locator('.tile--loading').first();
  await expect(skeleton).toBeVisible();
  const before = await skeleton.boundingBox();
  await faults();
  const tile = page.locator('.tile:not(.tile--loading)').first();
  await expect(tile).toBeVisible({ timeout: 10_000 });
  const after = await tile.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.y).toBe(before?.y);
  expect(after?.width).toBe(before?.width);
  // The art square is the same size; text lines below it are the same height.
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(2);
});

test('Library: an error stays in its block with Retry, which recovers', async ({ page }) => {
  await signedInWithNavidrome(page, 'st');
  await page.route('**/api/v1/navidrome/rest/getAlbumList2*', (r) => r.abort());
  await page.goto('/library');
  const err = page.getByRole('alert').filter({ hasText: "Couldn't load your library." });
  await expect(err).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible(); // not a full-screen error
  await page.unroute('**/api/v1/navidrome/rest/getAlbumList2*');
  await err.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.tile:not(.tile--loading)').first()).toBeVisible();
});

test('Playlists and an album: rows load in bars; a failed list says so with Retry', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'st');
  let fail = true;
  await page.route('**/api/v1/navidrome/rest/getPlaylists*', (r) =>
    fail ? r.abort() : r.continue(),
  );
  await page.goto('/library/playlists');
  const err = page.getByRole('alert').filter({ hasText: "Couldn't load playlists." });
  await expect(err).toBeVisible();
  fail = false;
  await err.getByRole('button', { name: 'Retry' }).click();
  await expect(err).toHaveCount(0);
  // An album opened directly: its skeleton, never "not in your library", while it loads.
  await faults('slowMs=1200');
  await page.goto('/library/album/al-2');
  await expect(page.locator('.track-row--loading').first()).toBeVisible();
  await expect(page.getByText('This album is not in your library.')).toHaveCount(0);
  await faults();
  await expect(page.getByRole('heading', { name: 'Copper Rain' })).toBeVisible({ timeout: 10_000 });
});

// ON-UI-2: an album whose tracks failed to load said "0 tracks" (from the list) or "not in your
// library" (opened directly), with no error and no way to retry.
test('An album that fails to load says so with Retry, which recovers', async ({ page }) => {
  await signedInWithNavidrome(page, 'st');
  let fail = true;
  await page.route('**/api/v1/navidrome/rest/getAlbum?*', (r) => (fail ? r.abort() : r.continue()));
  await page.goto('/library/album/al-2');
  const err = page.getByRole('alert').filter({ hasText: "Couldn't load this album." });
  await expect(err).toBeVisible();
  await expect(page.getByText('This album is not in your library.')).toHaveCount(0);
  fail = false;
  await err.getByRole('button', { name: 'Retry' }).click();
  await expect(err).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Copper Rain' })).toBeVisible();
  await expect(page.locator('.track-row:not(.track-row--loading)').first()).toBeVisible();
});

test('Offline: the library stays, with a freshness note while Navidrome is unreachable', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'st');
  await page.goto('/library');
  await expect(page.locator('.tile:not(.tile--loading)').first()).toBeVisible();
  await faults('down=1');
  // Anything that reaches Navidrome now notices; the album list stays on screen.
  await page.locator('.tile:not(.tile--loading)').first().getByRole('button').click();
  await expect(page.getByText(/Navidrome is unreachable\. Showing what was loaded at/)).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.locator('.tile:not(.tile--loading)').first()).toBeVisible();
});

test('REL-05: an ended session opens the sign-in sheet over the same screen and returns to it', async ({
  page,
}) => {
  const user = await signedInWithNavidrome(page, 'st');
  await page.goto('/library/album/al-1');
  await expect(page.getByRole('heading', { name: 'Harbour Lights' })).toBeVisible();
  // The session is revoked elsewhere (cookie cleared here, as a revocation would leave it useless).
  await page.context().clearCookies();
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Username').fill(user);
  await sheet.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await sheet.getByRole('button', { name: 'Sign in' }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/library\/album\/al-1$/);
  await expect(page.getByRole('heading', { name: 'Harbour Lights' })).toBeVisible();
});
