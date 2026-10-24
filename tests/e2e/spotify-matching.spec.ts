import { expect, test } from '@playwright/test';
import { clearLyricsCache, playAlbum, signedInWithNavidrome } from './helpers.ts';

// Spotify matching for Navidrome tracks (LYRICS_INTEGRATION.md §4.3) on the mock services, which
// know no track: a playing track is tried at once, shows up as "not found" for the admin, and is
// corrected from the Stage's ⓘ menu or from the list.

const LINK = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc';

test('an admin fixes the playing track’s match from the Stage, and fixes a miss from the list', async ({
  page,
}) => {
  clearLyricsCache();
  await signedInWithNavidrome(page, 'adm', 'admin');
  await playAlbum(page, 'al-3'); // Glass Weather: LRCLIB lyrics, so the ⓘ menu is there
  await expect(page.locator('.stage-attribution')).toHaveText(/LRCLIB/);
  await page.locator('.stage-attribution').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Fix Spotify match…' }).click();

  await expect(page).toHaveURL(/\/settings\/admin$/);
  const section = page.getByRole('region', { name: 'Spotify matching' });
  await expect(section.getByText(/tracks matched/)).toBeVisible();
  const fix = section.locator('#fix-one-track');
  // The E2E database outlives a run: an empty link first forgets any earlier correction.
  await fix.getByRole('button', { name: 'Save' }).click();
  await expect(fix.getByText('Now: no match')).toBeVisible();
  await fix.getByRole('textbox').fill('not a link');
  await fix.getByRole('button', { name: 'Save' }).click();
  await expect(fix.getByText('That is not a Spotify track link.')).toBeVisible();
  await fix.getByRole('textbox').fill(LINK);
  await fix.getByRole('button', { name: 'Save' }).click();
  await expect(fix.getByText('Now: 4uLU6hMCjMI75M1A2tKUQC (set by hand)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Player' })).toHaveAttribute(
    'data-status',
    'playing',
  ); // playback went on: in-app navigation

  // The list of misses holds what was tried without a match; a link removes the row.
  await page.getByRole('button', { name: 'Match now' }).click();
  const misses = section.locator('.match-misses li');
  await expect(misses.first()).toBeVisible({ timeout: 15_000 });
  const field = misses.first().getByRole('textbox');
  const label =
    (await field.getAttribute('aria-label')) ?? (await misses.first().locator('label').innerText());
  await field.fill(LINK);
  await misses.first().getByRole('button', { name: 'Save' }).click();
  await expect(section.getByRole('textbox', { name: label, exact: true })).toHaveCount(0);
});

test('a user without admin has no fix in the ⓘ menu', async ({ page }) => {
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-3');
  await expect(page.locator('.stage-attribution')).toHaveText(/LRCLIB/);
  await page.locator('.stage-attribution').getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: 'Choose automatically' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Fix Spotify match…' })).toHaveCount(0);
});
