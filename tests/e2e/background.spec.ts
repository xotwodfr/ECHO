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
const chroma = (c: string) => Number(/^oklch\(\S+ (\S+)/.exec(c)?.[1] ?? 0);
/**
 * The album's own colour, once its palette's 1200 ms crossfade has ended: coloured (the neutral
 * fallback is grey) and the same on two reads 300 ms apart. Waiting only for "not the colour before
 * Play" passed on the crossfade's first frame, the same grey under another hue (Firefox, main).
 */
const arrivedColour = async (page: Page) => {
  await expect
    .poll(async () => chroma(await playingColour(page)), { timeout: 5000 })
    .toBeGreaterThan(0.01);
  let last = '';
  await expect
    .poll(
      async () => {
        const c = await playingColour(page);
        const same = c === last;
        last = c;
        return same;
      },
      { intervals: [300], timeout: 5000 },
    )
    .toBe(true);
  return last;
};
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
  // Before anything plays the header is the neutral fallback; wait for the album's own colour to
  // arrive (its palette is fetched after Play), or "settled" can pass on the fallback still.
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  const playing = await arrivedColour(page);
  await settled(page);
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
