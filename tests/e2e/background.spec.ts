import { expect, type Page, test } from '@playwright/test';

// Page backgrounds follow the playing song (owner, 2026-11-02): every page header takes the playing
// album's tone, whatever the page shows, and fades out under the header so the same song's Mica
// glow shows below. No page paints its own cover's or category's colour under its list.

const headColour = (page: Page) =>
  page.locator('.page-head').evaluate((el) => getComputedStyle(el).backgroundColor);
/** The playing song's header colour, as the page's root resolves it right now. */
const playingColour = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--head-colour)';
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
/** Settled: the header shows the playing colour (after the palette's crossfade). */
const settled = async (page: Page) =>
  expect
    .poll(async () => (await headColour(page)) === (await playingColour(page)), {
      timeout: 5000,
    })
    .toBe(true);

test('every page header takes the playing song’s colour, and fades out under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library/album/al-harbour');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  await settled(page);
  const playing = await playingColour(page);
  // Another album's page, while Harbour Lights plays: the same colour, not its own cover's.
  await page.evaluate(() => {
    history.pushState(null, '', '/library/album/al-paper');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paper Satellites');
  await settled(page);
  expect(await playingColour(page)).toBe(playing); // still Harbour Lights' colour
  // The body fades to transparent: Mica, not a colour block, under the list.
  const body = await page
    .locator('.page-body')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(body).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  expect(
    await page.locator('.page-body').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
});
