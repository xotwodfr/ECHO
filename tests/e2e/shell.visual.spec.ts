import { expect, type Page, test } from '@playwright/test';

// Visual baselines for the shell with the fixture library (M2 task 3): the dock while a track is
// paused at 0:42, the library grid, the album detail and the queue sheet. Chromium only
// (TECHNICAL_ARCHITECTURE.md §8). Update with: pnpm test:e2e --project=chromium shell.visual -u

test.skip(({ browserName }) => browserName !== 'chromium', 'pixel baselines are Chromium only');

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];
const shot = { animations: 'disabled', caret: 'hide' } as const;

/** Plays Harbour Lights track 1 and pauses it at 0:42, with fonts and covers loaded. */
async function pausedAt42(page: Page, url: string) {
  await page.clock.install();
  await page.goto('/library');
  const tile = page.locator('.tile', { hasText: 'Harbour Lights' });
  await tile.hover();
  await tile.getByRole('button', { name: 'Play Harbour Lights' }).click();
  await page.clock.runFor(150 + 42_000);
  await page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Pause' }).click();
  if (url !== '/library') {
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
  }
  await page.mouse.move(0, 0);
  // No focus ring or hover left over from the clicks above.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images].filter((i) => i.checkVisibility()).every((i) => i.complete),
      ),
    )
    .toBe(true);
}

for (const vp of VIEWPORTS) {
  test(`library with the dock paused at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await pausedAt42(page, '/library');
    await expect(page).toHaveScreenshot(`library-dock-${vp.width}.png`, shot);
  });
}

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`album detail and queue at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await pausedAt42(page, '/library/album/al-harbour');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour Lights');
    await expect(page).toHaveScreenshot(`album-${vp.width}.png`, shot);
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Queue' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
    await expect(page).toHaveScreenshot(`queue-${vp.width}.png`, shot);
  });
}
