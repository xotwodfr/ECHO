import { expect, type Page, test } from '@playwright/test';
import { signedInWithNavidrome } from './helpers.ts';

// The Spotify-style pages and features (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md)
// over the mock Navidrome through ECHO's proxy: Home's shelves, hearts and Liked Songs, playlists,
// song radio and genres; the sleep timer on the fixture library's virtual clock.

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const library = (page: Page) => page.getByRole('navigation', { name: 'Your Library' });
const toast = (page: Page, text: string | RegExp) => page.locator('.toast-region').getByText(text);

test('Home: shortcuts and shelves from the server library', async ({ page }) => {
  await signedInWithNavidrome(page, 'home');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good /);
  const shortcuts = page.getByRole('list', { name: 'Your shortcuts' });
  await expect(shortcuts.getByRole('link', { name: 'Liked Songs' })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: 'Harbour Lights' })).toBeVisible();
  for (const shelf of ['Recently played', 'New in your library', 'Your most played']) {
    await expect(page.getByRole('region', { name: shelf }).locator('.tile').first()).toBeVisible();
  }
  // A card's green play button plays the album.
  const card = page.getByRole('region', { name: 'Recently played' }).locator('.tile').first();
  await card.hover();
  await card.getByRole('button', { name: /^Play / }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
});

test('hearts: a song into Liked Songs and out again', async ({ page }) => {
  await signedInWithNavidrome(page, 'heart');
  await page.goto('/library/album/al-3');
  const row = page.locator('.track-row', { hasText: 'Glass Weather 2' });
  await row.hover();
  await row.getByRole('button', { name: 'Add Glass Weather 2 to Liked Songs' }).click();
  await expect(toast(page, 'Added to Liked Songs')).toBeVisible();
  const saved = row.getByRole('button', { name: 'Remove Glass Weather 2 from Liked Songs' });
  await expect(saved).toHaveAttribute('aria-pressed', 'true');

  await library(page)
    .getByRole('link', { name: /^Liked Songs/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Liked Songs' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Glass Weather 2')).toBeVisible();
  // It survives a reload: the server has it.
  await page.reload();
  await expect(page.getByRole('main').getByText('Glass Weather 2')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Glass Weather 2 from Liked Songs' }).click();
  await expect(page.getByRole('main').getByText('Glass Weather 2')).toHaveCount(0);
});

test('an album saved to Your Library shows the green check, and unsaves', async ({ page }) => {
  await signedInWithNavidrome(page, 'save');
  await page.goto('/library/album/al-4');
  // The mock Navidrome outlives runs: start from not saved.
  const remove = page.getByRole('button', { name: 'Remove Long Exposure from Your Library' });
  const save = page.getByRole('button', { name: 'Save Long Exposure to Your Library' });
  await expect(remove.or(save)).toBeVisible();
  if (await remove.isVisible()) await remove.click();
  await save.click();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await remove.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
});

test('playlists: create, add a song, rename, remove the song, delete', async ({ page }) => {
  await signedInWithNavidrome(page, 'pl');
  // The mock Navidrome outlives runs: a name of this run's own.
  const renamed = `Late drives ${Date.now().toString(36)}`;
  await page.goto('/');
  await library(page).getByRole('button', { name: 'Create playlist' }).click();
  await expect(page).toHaveURL(/\/playlist\/pl-\d+$/);
  const url = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^My Playlist #\d+$/);
  await expect(page.getByText("Let's find something for your playlist")).toBeVisible();
  const name = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';

  // Add a song from an album's track menu.
  await page.goto('/library/album/al-1');
  const row = page.locator('.track-row', { hasText: 'Harbour Lights 3' });
  await row.hover();
  await row.getByRole('button', { name: 'More for Harbour Lights 3' }).click();
  await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
  await page.getByRole('dialog', { name: 'Add to playlist' }).getByRole('button', { name }).click();
  await expect(toast(page, `Added to ${name}`)).toBeVisible();

  await page.goto(url);
  await expect(page.getByRole('main').getByText('Harbour Lights 3')).toBeVisible();
  // Rename.
  await page.getByRole('button', { name: `More options for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit details' });
  await edit.getByLabel('Name').fill(renamed);
  await edit.getByLabel('Description').fill('For the coast road');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(page.getByText('For the coast road')).toBeVisible();
  await expect(library(page).getByRole('link', { name: new RegExp(`^${renamed}`) })).toBeVisible();
  // Remove the song.
  const entry = page.locator('.track-row', { hasText: 'Harbour Lights 3' });
  await entry.hover();
  await entry.getByRole('button', { name: 'More for Harbour Lights 3' }).click();
  await page.getByRole('menuitem', { name: 'Remove from this playlist' }).click();
  await expect(page.getByText("Let's find something for your playlist")).toBeVisible();
  // Delete, with confirmation.
  await page.getByRole('button', { name: `More options for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog', { name: `Delete ${renamed}?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(library(page).getByRole('link', { name: new RegExp(`^${renamed}`) })).toHaveCount(0);
});

test('song radio: a song and songs like it, as a radio', async ({ page }) => {
  await signedInWithNavidrome(page, 'radio');
  await page.goto('/library/album/al-1');
  const row = page.locator('.track-row', { hasText: 'Harbour Lights 1' });
  await row.hover();
  await row.getByRole('button', { name: 'More for Harbour Lights 1' }).click();
  await page.getByRole('menuitem', { name: 'Go to song radio' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(dock(page).locator('.dock-title')).toHaveText('Harbour Lights 1');
  await page.setViewportSize({ width: 1280, height: 800 }); // the queue as a sheet
  await dock(page).getByRole('button', { name: 'Queue' }).click();
  const queue = page.getByRole('dialog', { name: 'Queue' });
  // The mock's similar songs are the other albums' songs.
  await expect(
    queue.getByRole('list', { name: 'Then, from Harbour Lights 1 Radio' }),
  ).toContainText('Copper Rain 1');
});

test('Browse all: genre cards lead to their albums', async ({ page }) => {
  await signedInWithNavidrome(page, 'genre');
  await page.goto('/search');
  const browse = page.getByRole('region', { name: 'Browse all' });
  await expect(browse.getByRole('link', { name: /^Ambient/ })).toBeVisible();
  await expect(browse.getByRole('link', { name: /^Folk/ })).toBeVisible();
  await browse.getByRole('link', { name: /^Ambient/ }).click();
  await expect(page).toHaveURL(/\/genre\/Ambient$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ambient' })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Harbour Lights' })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Long Exposure' })).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Glass Weather' })).toHaveCount(0);
});

test('the sleep timer pauses after its minutes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); // a pill wide enough for the moon
  await page.clock.install();
  await page.goto('/library/album/al-harbour');
  await page.locator('.action-bar').getByRole('button', { name: 'Play Harbour Lights' }).click();
  await page.clock.runFor(150);
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await dock(page).getByRole('button', { name: 'Sleep timer' }).click();
  await page.getByRole('menuitem', { name: '5 minutes', exact: true }).click();
  await expect(toast(page, 'Sleep timer set: 5 minutes')).toBeVisible();
  await expect(dock(page).getByRole('button', { name: 'Sleep timer: 5 minutes' })).toBeVisible();
  await page.clock.runFor(5 * 60_000);
  await expect(dock(page)).toHaveAttribute('data-status', 'paused');
  await expect(dock(page).getByRole('button', { name: 'Sleep timer' })).toBeVisible();
});
