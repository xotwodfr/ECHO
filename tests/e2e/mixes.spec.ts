import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signedInWithNavidrome } from './helpers.ts';

// Project 2 of the Spotify redesign (docs/superpowers/specs/2026-10-29-spotify-redesign-design.md):
// plays recorded in ECHO's history come back as Made For You, Jump back in and Wrapped. The plays
// are posted as the player posts them (shell/mixes.ts), so the test need not listen for minutes.

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });

/** Lowfield's first two songs, three times each, from two albums' pages. */
async function seedPlays(page: Page) {
  const status = await page.evaluate(async () => {
    const song = (album: string, title: string, n: number) => ({
      track: {
        provider: 'navidrome',
        id: `${album}-t${n}`,
        title: `${title} ${n}`,
        artists: [{ id: 'ar-1', name: 'Lowfield' }],
        album: { id: album, title },
        durationMs: 30_000,
        artwork: [{ url: `/api/v1/navidrome/cover/${album}?size=600` }],
      },
      context: { kind: 'album', id: album, title },
    });
    const plays = [
      song('al-1', 'Harbour Lights', 1),
      song('al-1', 'Harbour Lights', 2),
      song('al-2', 'Copper Rain', 1),
    ];
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('/api/v1/me/plays', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(plays[i % plays.length]),
      });
      out.push(r.status);
    }
    return out;
  });
  expect(status.every((s) => s === 200)).toBe(true);
}

test('Made For You: a Daily Mix from what was played, and its page plays it', async ({ page }) => {
  await signedInWithNavidrome(page, 'mix');
  await seedPlays(page);
  await page.goto('/');
  const made = page.getByRole('region', { name: 'Made For You' });
  const daily = made.locator('.tile', { hasText: 'Daily Mix 1' });
  await expect(daily).toBeVisible();
  await expect(daily.locator('.tile-artist')).toHaveText(/^Lowfield, .* and more$/);
  await expect(made.locator('.tile', { hasText: 'Discover Weekly' })).toBeVisible();
  await expect(made.getByRole('link', { name: /Wrapped$/ })).toBeVisible();
  // Jump back in: the two albums played from.
  const jump = page.getByRole('region', { name: 'Jump back in' });
  await expect(jump.getByRole('link', { name: 'Harbour Lights' })).toBeVisible();
  await expect(jump.getByRole('link', { name: 'Copper Rain' })).toBeVisible();

  await daily.getByRole('link', { name: 'Daily Mix 1' }).click();
  await expect(page).toHaveURL(/\/mix\/daily-1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Daily Mix 1' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Harbour Lights 1').first()).toBeVisible();
  await page.locator('.action-bar').getByRole('button', { name: 'Play Daily Mix 1' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(
    page.locator('.action-bar').getByRole('button', { name: 'Pause Daily Mix 1' }),
  ).toBeVisible();
});

test('a mix that is not there today says so', async ({ page }) => {
  await signedInWithNavidrome(page, 'nomix');
  await page.goto('/mix/daily-6');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This mix isn’t here today' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('Wrapped: the year in minutes, top artists and songs', async ({ page }) => {
  await signedInWithNavidrome(page, 'wrapped');
  const year = new Date().getUTCFullYear();
  await page.goto('/wrapped');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Nothing played in ${year} yet`);
  await seedPlays(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Your ${year} Wrapped`);
  await expect(page.locator('.wrapped-hero .wrapped-figure strong')).toHaveText('3');
  const artists = page.getByRole('region', { name: 'Your top artists' });
  await expect(artists.getByRole('listitem')).toHaveCount(1);
  await expect(artists).toContainText('Lowfield');
  await expect(artists).toContainText('6 plays');
  const songs = page.getByRole('region', { name: 'Your top songs' });
  await expect(songs.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: `Play Your Top Songs ${year}` }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
});

test('A11Y-03: axe finds nothing serious on Home with mixes, a mix and Wrapped', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for axe');
  await signedInWithNavidrome(page, 'mixax');
  await seedPlays(page);
  for (const s of ['/', '/mix/daily-1', '/wrapped']) {
    await page.goto(s);
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const found = r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      );
    expect(found, s).toEqual([]);
  }
});
