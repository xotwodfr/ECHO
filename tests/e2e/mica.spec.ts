import { expect, type Page, test } from '@playwright/test';

// Mica (DESIGN_SYSTEM.md §6, §7.11): the album's glow is blurred once per album, never per frame.
// Counted at the canvas: every bake ends in one toBlob.

test.skip(({ browserName }) => browserName !== 'chromium', 'counted in Chromium');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __micaBakes: number };
    w.__micaBakes = 0;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      w.__micaBakes++;
      return toBlob.apply(this, args);
    };
  });
});

const bakes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __micaBakes: number }).__micaBakes);
const player = (page: Page) => page.getByRole('region', { name: 'Player' });
/** Plays an album from its page, reaching it in the app (a reload would reset the count). */
const playFrom = async (page: Page, album: string) => {
  const url = `/library/album/${album}`;
  if (new URL(page.url()).pathname.startsWith('/library')) {
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
    await expect(page).toHaveURL(new RegExp(`${url}$`));
  } else await page.goto(url);
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  await expect(player(page)).toHaveAttribute('data-status', 'playing');
};
const glowOn = (page: Page) => expect(page.locator('.mica-layer[data-on]')).toHaveCount(1);

test('one bake per album', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await playFrom(page, 'al-harbour');
  await glowOn(page);
  await expect.poll(() => bakes(page)).toBe(1);

  await player(page).getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('.canvas').evaluate((el) => el.scrollBy(0, 400));
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.waitForTimeout(500);
  expect(await bakes(page)).toBe(1);

  await playFrom(page, 'al-paper');
  await expect.poll(() => bakes(page)).toBe(2);
  await glowOn(page);
});

test('crossing a breakpoint re-bakes once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await playFrom(page, 'al-harbour');
  await expect.poll(() => bakes(page)).toBe(1);
  // 1440 → 1300 stays wide; 1270 crosses into medium; the rest stay medium.
  for (const width of [1400, 1350, 1300, 1270, 1200, 1100, 1000, 900, 800, 760])
    await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(500);
  expect(await bakes(page)).toBe(2);
});

test('Mica shows the album colour', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library/album/al-harbour');
  const gutter = async () =>
    (await page.screenshot({ clip: { x: 2, y: 450, width: 1, height: 1 } })).toString('base64');
  const before = await gutter();
  await playFrom(page, 'al-harbour');
  await glowOn(page);
  await page.waitForTimeout(1500); // the crossfade (--dur-palette)
  expect(await gutter()).not.toBe(before);
});
