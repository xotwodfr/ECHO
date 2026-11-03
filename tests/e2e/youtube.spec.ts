import { expect, type Page, test } from '@playwright/test';
import { signedIn } from './helpers.ts';

// YouTube Music mode (docs/superpowers/specs/2026-11-03-youtube-music-design.md) against the
// server's fake catalogue (ECHO_DEV_FIXTURES=1): its songs play from the mock Subsonic's
// /videoplayback, which behaves like googlevideo. No test talks to YouTube.

const ytNav = (page: Page) => page.getByRole('navigation', { name: 'YouTube Music' });

async function ytSignIn(page: Page, cookie = 'SID=e2e; SAPISID=e2e/abc') {
  await page.goto('/settings/account');
  await page.getByLabel('Cookie header').fill(cookie);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in as Fixture Listener')).toBeVisible();
}

test('the switch opens YouTube Music and remembers it', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/');
  await page.getByRole('button', { name: 'YouTube Music' }).click();
  await expect(page).toHaveURL(/\/yt$/);
  await expect(page.getByRole('heading', { name: 'Quick picks' })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/yt$/); // this device stays in YouTube Music
  await page.getByRole('button', { name: 'Navidrome' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('search shows suggestions and songs', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt');
  const box = page.getByRole('combobox', { name: 'Search YouTube Music' });
  await box.fill('fake song');
  await expect(page.getByRole('option', { name: 'fake song 1', exact: true })).toBeVisible();
  await box.press('Enter');
  await expect(page).toHaveURL(/\/yt\/search\?q=fake\+song$/);
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible();
  await page.getByRole('link', { name: 'Albums', exact: true }).click();
  await expect(page).toHaveURL(/tab=albums/);
});

test('album page lists its songs', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake1');
  await expect(page.getByRole('heading', { name: 'Low Sun', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Play Fake Song 1\b/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('library asks to sign in when signed out', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/library');
  await expect(page.getByText('Sign in to YouTube Music to see this.')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in in Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
});

test('signed in, the library shows; a stale cookie asks to sign in again', async ({ page }) => {
  await signedIn(page, 'yt');
  await ytSignIn(page);
  await page.goto('/yt/library');
  await expect(page.getByRole('heading', { name: 'Playlists' })).toBeVisible();
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Sign out of YouTube Music' }).click();
  await ytSignIn(page, 'SID=e2e; SAPISID=stale');
  await page.goto('/yt/library');
  await expect(page.getByText('Sign in to YouTube Music again.')).toBeVisible();
});

test('phone layout has bottom tabs and the switch in the account menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, 'yt');
  await page.goto('/yt');
  const tabs = ytNav(page);
  for (const name of ['Home', 'Explore', 'Library'])
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  await tabs.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/yt\/explore$/);
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitem', { name: 'Navidrome' }).click();
  await expect(page).toHaveURL(/\/$/);
});
