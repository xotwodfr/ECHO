import { expect, type Page, test } from '@playwright/test';
import { forgetWanted, signedInWithNavidrome } from './helpers.ts';

// The Wanted list: one list for everyone on the server, of music that is not in Navidrome yet.
// Added from a search that finds nothing or on its own page; found once the library has it.
// The list is shared and the E2E database outlives runs, so each test uses its own text (the
// browsers run at once) and takes it off the list again.

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const row = (page: Page, text: string) =>
  page.getByRole('list', { name: 'Wanted' }).getByRole('listitem').filter({ hasText: text });
const unique = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;
const norm = (s: string) => s.toLowerCase();

test('a search that finds nothing adds to Wanted, and the list says who added it', async ({
  page,
}) => {
  const text = unique('xylophone suite');
  await signedInWithNavidrome(page, 'want');
  try {
    await page.goto(`/search?q=${encodeURIComponent(text)}`);
    await page.getByRole('button', { name: 'Add to Wanted' }).click();
    await expect(page.getByText('Added to Wanted')).toBeVisible();
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/library\/wanted$/);
    await expect(row(page, text)).toContainText('Not in Navidrome yet');
    await expect(row(page, text)).toContainText('Added by you');
    await expect(row(page, text).getByRole('link', { name: 'YouTube Music' })).toHaveAttribute(
      'href',
      `https://music.youtube.com/search?q=${encodeURIComponent(text)}`,
    );
    // Your Library lists the list too.
    await expect(page.locator('.library-panel').getByText('Wanted', { exact: true })).toBeVisible();
  } finally {
    forgetWanted(norm(text));
  }
});

test('what the library has is marked, plays from its album, and is removed', async ({
  page,
}, info) => {
  // Two texts that both match the mock's "Harbour Lights" album: one per browser, run at once.
  const text = info.project.name === 'firefox' ? 'Lowfield Harbour Lights' : 'Harbour Lights';
  forgetWanted(norm(text));
  await signedInWithNavidrome(page, 'want');
  await page.goto('/library/wanted');
  await page.getByLabel('Add something').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(row(page, text)).toContainText('In your library');
  await row(page, text).getByRole('button', { name: 'Play Harbour Lights' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(dock(page)).toContainText('Harbour Lights 1');
  await row(page, text)
    .getByRole('button', { name: `Remove ${text} from Wanted` })
    .click();
  await expect(row(page, text)).toHaveCount(0);
});

test('on a phone the Wanted page opens from Your Library', async ({ page }) => {
  const text = unique('Quiet Harbour Tapes');
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInWithNavidrome(page, 'want');
  try {
    await page.goto('/library');
    await page.getByRole('link', { name: /^Wanted/ }).click();
    await expect(page).toHaveURL(/\/library\/wanted$/);
    await page.getByLabel('Add something').fill(text);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(row(page, text)).toBeVisible();
  } finally {
    forgetWanted(norm(text));
  }
});
