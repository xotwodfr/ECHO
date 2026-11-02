import { expect, type Page, test } from '@playwright/test';
import { fakeSpotify, SP_ALBUM } from './fake-spotify.ts';
import { connectSpotify, releaseSpotify, signedInWithNavidrome } from './helpers.ts';

// The library switch (docs/superpowers/specs/2026-11-02-source-switch-design.md): one source's
// albums at a time; a link to the other source's item switches to it; playback carries on.

test.describe.configure({ mode: 'default' });
let user: string | null = null;
test.afterEach(() => {
  if (user) releaseSpotify(user);
  user = null;
});

const panel = (page: Page) => page.locator('.library-panel');
const segment = (page: Page, name: string) =>
  page
    .getByRole('group', { name: 'Library', exact: true })
    .getByRole('button', { name, exact: true });

async function both(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeSpotify(page);
  user = await signedInWithNavidrome(page, 'src');
  await connectSpotify(page);
  await page.goto('/');
}

test('the switch shows one library at a time', async ({ page }) => {
  await both(page);
  await expect(segment(page, 'Navidrome')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByText('Harbour Lights').first()).toBeVisible();
  await expect(panel(page).getByText('Northern Static')).toHaveCount(0);
  await segment(page, 'Spotify').click();
  await expect(panel(page).getByText('Northern Static').first()).toBeVisible();
  await expect(panel(page).getByText('Harbour Lights')).toHaveCount(0);
  await page.reload();
  await expect(segment(page, 'Spotify')).toHaveAttribute('aria-pressed', 'true');
});

test('a Spotify link in Navidrome mode opens it and switches', async ({ page }) => {
  await both(page);
  await segment(page, 'Navidrome').click();
  await page.goto(`/library/album/${encodeURIComponent(`spotify:${SP_ALBUM.id}`)}`);
  await expect(page.getByRole('heading', { name: 'Northern Static' })).toBeVisible();
  await expect(segment(page, 'Spotify')).toHaveAttribute('aria-pressed', 'true');
});

test('switching keeps the music playing', async ({ page }) => {
  await both(page);
  await segment(page, 'Navidrome').click();
  await page.goto('/library/album/al-1');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toHaveAttribute('data-status', 'playing');
  await segment(page, 'Spotify').click();
  await expect(page).toHaveURL(/\/$/); // the Navidrome album page gave way to Home
  await expect(dock).toHaveAttribute('data-status', 'playing');
});

test('Navidrome only: no switch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedInWithNavidrome(page, 'nsw');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Library', exact: true })).toHaveCount(0);
});

test('phone: the switch lives in the account menu', async ({ page }) => {
  await both(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.home').getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitemradio', { name: 'Spotify library' }).click();
  // The switch lands with its page change (a frame on); wait until it is saved before leaving.
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/me/settings')).json()).playback)
    .toMatchObject({ defaultProvider: 'spotify' });
  await page.goto('/library');
  await expect(page.locator('main').getByText('Northern Static').first()).toBeVisible();
  await page.goto('/');
  await page.locator('.home').getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Spotify library' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the player stays whole in either mode: its album link and the artist card', async ({
  page,
}) => {
  await both(page);
  await segment(page, 'Navidrome').click();
  await page.goto('/library/album/al-1');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  const panel = page.locator('.right-panel');
  await segment(page, 'Spotify').click();
  // A Navidrome song in Spotify mode: its artist card still comes from Navidrome.
  await expect(panel.getByText('make records in a small room by the sea')).toBeVisible();
  await page.goto(`/library/album/${encodeURIComponent(`spotify:${SP_ALBUM.id}`)}`);
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  // Spotify music over a Navidrome queue asks first (QUE-03).
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('region', { name: 'Player' })).toHaveAttribute(
    'data-status',
    'playing',
  );
  await segment(page, 'Navidrome').click();
  // A Spotify song in Navidrome mode: its album is one click away, and the switch follows.
  await panel.locator('.rp-title').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Northern Static', level: 1 })).toBeVisible();
  await expect(segment(page, 'Spotify')).toHaveAttribute('aria-pressed', 'true');
});

// Springy motion (docs/superpowers/specs/2026-11-02-spring-motion-design.md): switching is a page
// change: at once, then the new library and page rise in, not a hard swap.
test('switching is a page change', async ({ page }) => {
  await both(page);
  await segment(page, 'Spotify').click();
  // It has switched by the time the click is over: the new library is there, and rising in.
  await expect(segment(page, 'Spotify')).toHaveAttribute('aria-pressed', 'true');
  const rising = await panel(page).evaluate((p) =>
    [...p.children].some((c) => c.getAnimations().length > 0),
  );
  expect(rising).toBe(true);
  await expect(panel(page).getByText('Northern Static').first()).toBeVisible();
});
