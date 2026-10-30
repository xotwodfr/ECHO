import { expect, type Page, test } from '@playwright/test';

// Sticky surfaces stay opaque over Mica (DESIGN_SYSTEM.md §6): rows scrolled under the right
// panel's header or the page's sticky bar never show through it.

const alpha = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const c = getComputedStyle(el).backgroundColor;
      const n = c.match(/[\d.]+/g) ?? [];
      return c === 'transparent' ? 0 : Number(n[3] ?? 1);
    });

test('the right panel header is opaque', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library/album/al-harbour');
  await expect(page.locator('.rp-head')).toBeVisible();
  expect(await alpha(page, '.rp-head')).toBe(1);
});

test("Liked Songs' sticky bar is opaque", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/collection/tracks');
  expect(await alpha(page, '.sticky-bar')).toBe(1);
});
