import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';

// The lyrics view's chrome (PRODUCT_SPEC.md §6.1): the close chevron and the floating pill hide
// after idle; the song on the left, the lyrics on the right, or the cover alone. Real time: the idle
// timeout is 3 s, and fast-forwarding a fake clock would render every Stage frame.

// Reduced motion: the Stage draws one Still frame instead of a continuous SwiftShader loop, which
// keeps parallel runs fast. Chrome fades and the Cover crossfade are opacity, so they still run;
// the scrims re-render on each chrome change (the Ambient ramp is unit-tested: chromeStep).
test.use({ reducedMotion: 'reduce' });

const shell = (page: Page) => page.locator('.shell');
const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const opacity = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((el) => Number(getComputedStyle(el).opacity));

async function playOnStage(page: Page, album = 'Harbour Lights') {
  await page.goto('/library');
  const tile = page.locator('.tile', { hasText: album });
  await tile.hover();
  await tile.getByRole('button', { name: `Play ${album}` }).click();
  await page
    .getByRole('region', { name: 'Player' })
    .getByRole('button', { name: 'Lyrics', exact: true })
    .click();
  await expect(page.locator('.stage')).not.toHaveAttribute('data-renderer', 'pending', {
    timeout: 15_000,
  });
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await page.mouse.move(600, 300);
}

test.describe('chrome auto-hide', () => {
  test('hides after 3 s idle while playing; input restores it', async ({ page }) => {
    await playOnStage(page);
    await page.waitForTimeout(2500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome', 'hidden');
    await expect(shell(page)).toHaveAttribute('data-chrome', 'hidden', { timeout: 2000 });
    // The top chrome fades per control, and the pill as a whole.
    await expect.poll(() => opacity(page, '.stage-chrome .stage-btn')).toBe(0);
    await expect.poll(() => opacity(page, '.dock')).toBe(0);
    expect(await page.locator('.stage').evaluate((el) => getComputedStyle(el).cursor)).toBe('none');
    // Hidden controls take no pointer input.
    expect(await page.locator('.dock').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
      'none',
    );
    await page.mouse.move(610, 320);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
    // Restores over 160 ms (asserted as the transition itself: wall-clock timing under parallel
    // SwiftShader rendering is not a measure of the CSS).
    expect(
      await page.locator('.dock').evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0.16s');
    await expect.poll(() => opacity(page, '.dock')).toBe(1);
  });

  test('a key press restores it too', async ({ page }) => {
    await playOnStage(page);
    await expect(shell(page)).toHaveAttribute('data-chrome', 'hidden', { timeout: 5000 });
    await page.keyboard.press('Shift');
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
  });

  test('never hides while paused, off the Stage, or with the queue open', async ({ page }) => {
    await playOnStage(page);
    await page.locator('h1').first().focus(); // not a control
    await page.keyboard.press('Space'); // pause
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');
    await page.waitForTimeout(3500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
    await page.keyboard.press('Space'); // play
    await page.keyboard.press('q');
    const queue = page.getByRole('dialog', { name: 'Queue' });
    await expect(queue).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close Now playing' }).click();
    await page.waitForTimeout(3500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
  });

  // A11Y-02: focus is never hidden.
  test('never hides while keyboard focus is in the chrome', async ({ page }) => {
    await playOnStage(page);
    await dock(page).getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Shift+Tab'); // keyboard focus → :focus-visible
    await page.keyboard.press('Tab');
    await expect(dock(page).getByRole('button', { name: 'Next' })).toBeFocused();
    await page.waitForTimeout(3500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
  });

  test('the scrims fade with the chrome (the bottom of the room gets lighter)', async ({
    page,
  }) => {
    await page.goto('/library');
    test.skip(
      !(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))),
      'scrims are drawn by WebGL; this browser has none here',
    );
    await playOnStage(page);
    await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl');
    const band = async () => {
      const png = await page.locator('.stage-canvas').screenshot();
      const vp = page.viewportSize() as { width: number; height: number };
      const { data } = await sharp(png)
        .extract({ left: 0, top: vp.height - 200, width: vp.width, height: 90 }) // scrim, above the dock
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data.reduce((a, v) => a + v, 0) / data.length;
    };
    const shown = await band();
    await expect(shell(page)).toHaveAttribute('data-chrome', 'hidden', { timeout: 5000 });
    await page.waitForTimeout(1000); // the 640 ms fade
    expect(await band()).toBeGreaterThan(shown + 1);
  });
});

test.describe('background', () => {
  test('the room is drawn on the blurred cover', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebGL here is Chromium’s (playwright.config.ts)');
    await playOnStage(page);
    await expect(page.locator('.stage')).toHaveAttribute('data-cover', 'shown', {
      timeout: 10_000,
    });
  });
});

test.describe('the song and the lyrics', () => {
  test('the song on the left, the lyrics on the right; C shows the cover alone, centred', async ({
    page,
  }) => {
    await playOnStage(page);
    const view = page.locator('.np-view');
    await expect(view).toHaveAttribute('data-mode', 'lyrics');
    const side = page.locator('.np-side');
    await expect(side.locator('.np-title')).toHaveText('Ferry at Six');
    await expect(side.locator('.np-artist')).toHaveText('Lowfield');
    // Small SVG covers are inlined as data: URIs; their <title> names them.
    await expect(side.locator('.art img')).toHaveAttribute('src', /Harbour%20Lights/);
    expect(await side.locator('.art img').evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      'cover',
    );
    const vp = page.viewportSize() as { width: number; height: number };
    const lyrics = await page.locator('.ly-area').boundingBox();
    const art = await side.locator('.art').boundingBox();
    expect((art?.x ?? 0) + (art?.width ?? 0)).toBeLessThan(lyrics?.x ?? 0); // left of the lyrics
    expect(lyrics?.x ?? 0).toBeGreaterThan(0.4 * vp.width);

    await page.locator('h1').first().focus();
    await page.keyboard.press('c');
    await expect(view).toHaveAttribute('data-mode', 'cover');
    await expect(page.locator('.ly-area')).toHaveCount(0);
    await expect
      .poll(async () => {
        const b = await side.locator('.art').boundingBox();
        return Math.abs((b?.x ?? 0) + (b?.width ?? 0) / 2 - vp.width / 2);
      })
      .toBeLessThan(2);
  });

  test('keys: V cycles, C toggles the cover, L the lyrics; only on the lyrics view', async ({
    page,
  }) => {
    await playOnStage(page);
    const view = page.locator('.np-view');
    await page.locator('h1').first().focus();
    await page.keyboard.press('v');
    await expect(view).toHaveAttribute('data-mode', 'cover');
    await page.keyboard.press('v'); // the old Visual mode: the cover alone too
    await expect(view).toHaveAttribute('data-mode', 'cover');
    await page.keyboard.press('v');
    await expect(view).toHaveAttribute('data-mode', 'lyrics');
    await page.keyboard.press('c');
    await expect(view).toHaveAttribute('data-mode', 'cover');
    await page.keyboard.press('c');
    await expect(view).toHaveAttribute('data-mode', 'lyrics');
    await page.getByRole('button', { name: 'Close Now playing' }).click();
    await page.keyboard.press('v');
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Lyrics', exact: true })
      .click();
    await expect(view).toHaveAttribute('data-mode', 'lyrics'); // V did nothing off the lyrics view
  });
});
