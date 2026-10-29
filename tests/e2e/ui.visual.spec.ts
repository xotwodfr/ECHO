import { expect, type Page, test } from '@playwright/test';

// DS-06 visual snapshots: every /__ui section (all component states) at the four reference widths,
// plus the open overlays. Chromium only (TECHNICAL_ARCHITECTURE.md §8: Firefox gets functional
// E2E, not pixel baselines). Update with: pnpm test:e2e --project=chromium ui.visual -u
//
// The viewport is tall so that sections taller than the reference heights are not clipped by the
// scrolling canvas; for the shell canvas only the width changes layout. `animations: 'disabled'`
// freezes loops at their start and runs finite animations to their end, so the decay trace (a
// fade over the song) is captured faded out; ui.spec.ts checks it live.

test.skip(({ browserName }) => browserName !== 'chromium', 'pixel baselines are Chromium only');

const WIDTHS = [1440, 2560, 1024, 390];
const SECTIONS = [
  'buttons',
  'icon-buttons',
  'transport',
  'sliders',
  'fields',
  'tracks',
  'tiles',
  'overlays',
  'connections',
  'signin',
];

async function open(page: Page, width: number, height = 2400) {
  await page.setViewportSize({ width, height });
  await page.goto('/__ui');
  await expect(page.locator('[data-section="signin"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Wait for the fixture covers (and the deliberate broken one to fall back).
  await page.locator('[data-section="tiles"]').scrollIntoViewIfNeeded();
  await expect(page.locator('.tile', { hasText: 'Missing File' }).locator('img')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images]
          .filter((i) => i.checkVisibility()) // lazy covers in the closed sheet never load
          .every((i) => i.complete && i.naturalWidth > 0),
      ),
    )
    .toBe(true);
}

for (const width of WIDTHS) {
  test(`component states at ${width}`, async ({ page }) => {
    await open(page, width);
    for (const id of SECTIONS) {
      await expect(page.locator(`[data-section="${id}"]`)).toHaveScreenshot(`${id}-${width}.png`, {
        animations: 'disabled',
        caret: 'hide',
      });
    }
  });
}

for (const width of [1440, 390]) {
  test(`open overlays at ${width}`, async ({ page }) => {
    await open(page, width, width === 390 ? 844 : 900);
    const shot = { animations: 'disabled', caret: 'hide', maxDiffPixels: 100 } as const; // antialiasing varies a little

    await page.getByRole('button', { name: 'Open queue' }).click();
    await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
    await expect(page).toHaveScreenshot(`sheet-${width}.png`, shot);
    await page.keyboard.press('Escape');

    await page
      .locator('[data-section="overlays"]')
      .getByRole('button', { name: 'Disconnect' })
      .click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page).toHaveScreenshot(`dialog-${width}.png`, shot);
    await page.keyboard.press('Escape');

    const trigger = page
      .locator('[data-section="overlays"]')
      .getByRole('button', { name: 'More for Undertow' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    // The page, not the row: an element screenshot would crop the popup that overflows it.
    await expect(page).toHaveScreenshot(`menu-${width}.png`, shot);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Show toast' }).click();
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page).toHaveScreenshot(`toast-${width}.png`, shot);
  });
}
