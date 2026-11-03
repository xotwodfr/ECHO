import { expect, type Page, test } from '@playwright/test';
import { clearLyricsCache, signedIn } from './helpers.ts';

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
  await page.goto('/yt');
  await expect(page.getByText('Sign in to YouTube Music again.')).toBeVisible();
});

test('phone layout has bottom tabs and the switch in the account menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, 'yt');
  await page.goto('/yt');
  const tabs = ytNav(page);
  for (const name of ['Today', 'Explore', 'Your shelf'])
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  await tabs.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/yt\/explore$/);
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitem', { name: 'Navidrome' }).click();
  await expect(page).toHaveURL(/\/$/);
});

// ---- Liner notes (docs/superpowers/specs/2026-11-03-youtube-liner-notes-design.md) ----

test('the masthead names the edition', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt');
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
  await expect(page.getByText('ECHO', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`YouTube Music · ${day} edition`)).toBeVisible();
  const tabs = ytNav(page);
  for (const name of ['Today', 'Explore', 'Your shelf'])
    await expect(tabs.getByRole('link', { name })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
});

test('phone: no sideways scroll, tabs at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, 'yt');
  await page.goto('/yt');
  await expect(page.getByRole('heading', { name: 'Quick picks' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = await ytNav(page).boundingBox();
  expect(box?.y ?? 0).toBeGreaterThan(700);
});

test('keys: space pauses, but not while typing', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const bar = page.getByRole('region', { name: 'Player' });
  await expect(bar).toHaveAttribute('data-status', 'playing', { timeout: 10_000 });
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Space');
  await expect(bar).toHaveAttribute('data-status', 'paused');
  const box = page.getByRole('combobox', { name: 'Search YouTube Music' });
  await box.click();
  await page.keyboard.type('a b');
  await expect(box).toHaveValue('a b');
  await expect(bar).toHaveAttribute('data-status', 'paused');
});

test('Today: now spinning and a numbered tracklist', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt');
  const spinning = page.getByRole('region', { name: 'Now spinning' });
  await expect(spinning).toContainText('Fake Song 1'); // nothing plays: the first Quick pick
  await expect(spinning.getByRole('button', { name: 'Start the radio' })).toBeVisible();
  const picks = page.getByRole('list', { name: 'Quick picks' });
  await expect(picks.getByRole('listitem')).toHaveCount(8);
  await expect(picks.getByRole('listitem').first()).toHaveText(/^01/);
});

test('a spread for an album', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake1');
  await expect(page.getByRole('heading', { name: 'Low Sun', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: 'Low Sun' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  for (const [i, n] of ['01', '02', '03', '04'].entries())
    await expect(list.getByRole('listitem').nth(i)).toHaveText(new RegExp(`^${n}`));
});

// ---- playback ----

const bar = (page: Page) => page.getByRole('region', { name: 'Player' });

test('plays a song from search', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/search?q=Fake+Song+2&tab=songs');
  await page.getByRole('button', { name: /^Play Fake Song 2\b/ }).click();
  await expect(bar(page)).toContainText('Fake Song 2');
  await expect(bar(page).getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 10_000 });
});

test('tapping a single song starts its radio', async ({ page }) => {
  clearLyricsCache(); // an earlier run may have cached "none" for the fake songs
  await signedIn(page, 'yt');
  await page.goto('/yt');
  await page.getByRole('button', { name: /^Play Fake Song 3\b/ }).click();
  await expect(bar(page)).toContainText('Fake Song 3');
  await bar(page).getByRole('button', { name: 'Up next' }).click();
  const np = page.getByRole('dialog', { name: 'Now playing' });
  await expect(np.getByRole('tab', { name: 'Up next', selected: true })).toBeVisible();
  await expect(np.getByRole('button', { name: /^Play Fake Song 4\b/ })).toBeVisible();
  // The lyrics are ECHO's own (the owner, 2026-11-03): its lyric field, with its transcript.
  await np.getByRole('tab', { name: 'Lyrics' }).click();
  await expect(np.locator('.stage .ly-field')).toBeAttached();
  await expect(np.getByRole('list', { name: 'Lyrics' }).getByRole('listitem').first()).toHaveText(
    'Glass in the morning, Fake Song 3',
  );
  await page.keyboard.press('Escape');
  await expect(np).toBeHidden();
});

test('skips a song that will not play', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/playlist/VLfakebroken1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByText('This track could not be played. Skipped to the next.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(bar(page)).toContainText('Fake Song 1');
});

test('flipping to Navidrome keeps playing', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bar(page).getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Navidrome' }).click();
  await expect(page).toHaveURL(/\/$/);
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toContainText('Fake Song 2');
  await expect(dock).toHaveAttribute('data-status', 'playing');
  // Spec call 17: no Navidrome heart or links for a YouTube song, in the dock or the side panel.
  await expect(dock.getByRole('button', { name: /^Add .* to Liked Songs$/ })).toHaveCount(0);
  await expect(dock.getByRole('link', { name: 'Fake Song 2' })).toHaveCount(0);
  const panel = page.locator('.right-panel');
  await page.waitForTimeout(500); // the panel, if open, has mounted
  if ((await panel.count()) === 0)
    await dock.getByRole('button', { name: 'Now playing view' }).click();
  await expect(panel).toContainText('Fake Song 2');
  await expect(panel.getByRole('link', { name: 'Fake Song 2' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Ada Varga' })).toHaveCount(0);
  await expect(panel.locator('.rp-song button[aria-pressed]')).toHaveCount(0);
});

test('like toggles, and Liked music lists the song', async ({ page }) => {
  await signedIn(page, 'yt');
  await ytSignIn(page);
  await page.goto('/yt/album/MPREb_fake3');
  await page.getByRole('button', { name: /^Play Fake Song 3\b/ }).click();
  const like = bar(page).getByRole('button', { name: 'Like' });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  // After a reload the button shows YouTube's own state, not a guess.
  await page.goto('/yt/album/MPREb_fake3');
  await page.getByRole('button', { name: /^Play Fake Song 3\b/ }).click();
  await expect(bar(page).getByRole('button', { name: 'Like' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/yt/playlist/VLLM');
  await expect(page.getByRole('button', { name: /^Play Fake Song 3\b/ })).toBeVisible();
});

// ---- the ink strip and the paper player (Liner notes, board F) ----

test('the strip: play, title, hairline, words', async ({ page }) => {
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const strip = bar(page);
  await expect(strip.getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 10_000 });
  for (const name of ['Pause', 'Previous', 'Next', 'Up next', 'Lyrics', 'Shuffle'])
    await expect(strip.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(strip.getByRole('button', { name: /^Repeat/ })).toBeVisible();
  await expect(strip.getByRole('slider', { name: 'Seek' })).toBeVisible();
  await expect(strip.getByRole('slider', { name: 'Volume' })).toBeVisible();
  await expect(strip.locator('.yt-thumb')).toBeVisible(); // the cover stays on wide screens
});

test("Lyrics opens the paper player on its tab, and ECHO's lyrics view keeps its room", async ({
  page,
}) => {
  clearLyricsCache();
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bar(page).getByText(/^0:0[1-9]$/)).toBeVisible({ timeout: 10_000 });
  await bar(page).getByRole('button', { name: 'Lyrics', exact: true }).click();
  const np = page.getByRole('dialog', { name: 'Now playing' });
  await expect(np.getByRole('tab', { name: 'Lyrics', selected: true })).toBeVisible();
  await expect(np.locator('.ly-field')).toBeAttached();
  await expect(np.locator('.stage')).toHaveAttribute('data-renderer', 'none'); // no room on paper
  await expect(np.getByRole('list', { name: 'Lyrics' }).getByRole('listitem').first()).toHaveText(
    'Glass in the morning, Fake Song 1',
  );
  expect(await np.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(243, 238, 230)',
  );
  // Far lines stay crisp on paper: no depth blur on any line.
  await page.waitForTimeout(1500);
  expect(
    await np
      .locator('.ly-line')
      .evaluateAll((els) => els.some((e) => !!(e as HTMLElement).style.filter)),
  ).toBe(false);
  // Navidrome mode's lyrics view still draws its room.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Navidrome' }).click();
  await page.goto('/listen');
  await expect(page.locator('.stage')).not.toHaveAttribute('data-renderer', 'none');
  await expect(page.locator('.stage')).not.toHaveAttribute('data-renderer', 'pending');
});

test('phone: the paper player scrolls down to the whole lyrics stage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, 'yt');
  await page.goto('/yt/album/MPREb_fake1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await bar(page)
    .getByRole('button', { name: /Fake Song 1/ })
    .click();
  const np = page.getByRole('dialog', { name: 'Now playing' });
  await np.getByRole('tab', { name: 'Lyrics' }).click();
  await np.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const stage = await np.locator('.yt-np-stage').boundingBox();
  const strip = await bar(page).boundingBox();
  expect(stage && strip && stage.y + stage.height <= strip.y + 1).toBe(true);
});
