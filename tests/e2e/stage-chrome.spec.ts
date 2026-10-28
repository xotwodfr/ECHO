import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';

// M2 task 5: chrome auto-hide on the Stage (PRODUCT_SPEC.md §6.1) and the view modes. Real time:
// the idle timeout is 3 s, and fast-forwarding a fake clock would render every Stage frame.

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
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Listen' })
    .click();
  await expect(page.locator('.stage')).not.toHaveAttribute('data-renderer', 'pending', {
    timeout: 15_000,
  });
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await page.mouse.move(600, 300);
}

test.describe('chrome auto-hide', () => {
  test('hides after 3 s idle while playing; progress stays at 40%; input restores it', async ({
    page,
  }) => {
    await playOnStage(page);
    await page.waitForTimeout(2500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome', 'hidden');
    await expect(shell(page)).toHaveAttribute('data-chrome', 'hidden', { timeout: 2000 });
    await expect.poll(() => opacity(page, '.stage-chrome')).toBe(0);
    await expect.poll(() => opacity(page, '.dock-transport')).toBe(0);
    await expect.poll(() => opacity(page, '.dock-meta')).toBe(0);
    await expect.poll(() => opacity(page, '.dock-scrub')).toBeCloseTo(0.4, 2);
    expect(await page.locator('.stage').evaluate((el) => getComputedStyle(el).cursor)).toBe('none');
    // Hidden controls take no pointer input.
    expect(
      await page.locator('.dock-transport').evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('none');
    await page.mouse.move(610, 320);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
    // Restores over 160 ms (asserted as the transition itself: wall-clock timing under parallel
    // SwiftShader rendering is not a measure of the CSS).
    expect(
      await page
        .locator('.dock-transport')
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0.16s');
    await expect.poll(() => opacity(page, '.dock-transport')).toBe(1);
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
    await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
    await page.waitForTimeout(3500);
    await expect(shell(page)).not.toHaveAttribute('data-chrome');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Library', exact: true }).first().click();
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

test.describe('view modes', () => {
  test('Lyrics (placeholder), Cover and Visual from the switch', async ({ page }) => {
    await playOnStage(page);
    const sw = page.getByRole('group', { name: 'Stage view' });
    await expect(sw.getByRole('button', { name: 'Lyrics' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.stage-lyrics')).toHaveText('Lyrics will appear here.');
    const box = await page.locator('.stage-lyrics').boundingBox();
    const vp = page.viewportSize() as { width: number; height: number };
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - 0.4 * vp.height)).toBeLessThan(2); // 40% H

    await sw.getByRole('button', { name: 'Cover' }).click();
    await expect(sw.getByRole('button', { name: 'Cover' })).toHaveAttribute('aria-pressed', 'true');
    const art = page.locator('.stage-cover .art');
    // Small SVG covers are inlined as data: URIs; their <title> names them.
    await expect(art.locator('img')).toHaveAttribute('src', /Harbour%20Lights/);
    const a = await art.boundingBox();
    expect(a?.width).toBeCloseTo(Math.min(0.6 * vp.height, 640), 0); // min(60vh, 640px)
    expect(await art.locator('img').evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      'contain',
    );
    expect(await art.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('8px');
    await expect(page.locator('.stage-lyrics')).toHaveCount(0);

    await sw.getByRole('button', { name: 'Visual' }).click();
    await expect(page.locator('.stage-cover, .stage-lyrics')).toHaveCount(0);
  });

  test('keys: V cycles, C toggles Cover, L toggles Lyrics/Visual; only on the Stage', async ({
    page,
  }) => {
    await playOnStage(page);
    const pressed = page
      .getByRole('group', { name: 'Stage view' })
      .locator('[aria-pressed="true"]');
    await page.locator('h1').first().focus();
    await page.keyboard.press('v');
    await expect(pressed).toHaveAccessibleName('Cover');
    await page.keyboard.press('v');
    await expect(pressed).toHaveAccessibleName('Visual');
    await page.keyboard.press('v');
    await expect(pressed).toHaveAccessibleName('Lyrics');
    await page.keyboard.press('c');
    await expect(pressed).toHaveAccessibleName('Cover');
    await page.keyboard.press('c');
    await expect(pressed).toHaveAccessibleName('Lyrics');
    await page.keyboard.press('l');
    await expect(pressed).toHaveAccessibleName('Visual');
    await page.keyboard.press('l');
    await expect(pressed).toHaveAccessibleName('Lyrics');
    await page.getByRole('link', { name: 'Library', exact: true }).first().click();
    await page.keyboard.press('v');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Listen' })
      .click();
    await expect(pressed).toHaveAccessibleName('Lyrics'); // V did nothing in the Library
  });

  test('Cover crossfades on a cover change, by opacity only', async ({ page }) => {
    // Signal / Noise playing, Glass Weather queued next: Next changes the cover on the Stage.
    await playOnStage(page, 'Signal / Noise');
    // In-app navigation (a page load would reset playback).
    await page.getByRole('link', { name: 'Library', exact: true }).first().click();
    await page.locator('.tile', { hasText: 'Glass Weather' }).getByRole('link').click();
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Listen' })
      .click();
    await page
      .getByRole('group', { name: 'Stage view' })
      .getByRole('button', { name: 'Cover' })
      .click();
    const items = page.locator('.stage-cover-item');
    await expect(items).toHaveCount(1);
    // The first cover shown appears without an entrance.
    expect(await items.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    // Record the crossfade from inside the page as it starts: 420 ms is short next to a busy
    // test machine's round trips.
    await page.evaluate(() => {
      const w = window as unknown as { __fade: Promise<string[][]> };
      w.__fade = new Promise((resolve) => {
        const root = document.querySelector('.stage-cover') as HTMLElement;
        new MutationObserver((_, obs) => {
          const els = [...root.querySelectorAll<HTMLElement>('.stage-cover-item')];
          if (els.length < 2) return;
          obs.disconnect();
          resolve(
            els.map((el) => {
              const cs = getComputedStyle(el);
              const title =
                decodeURIComponent(el.querySelector('img')?.src ?? '').match(
                  /<title>([^<(]+)/,
                )?.[1] ?? '';
              const role =
                el.dataset.leaving !== undefined
                  ? 'leaving'
                  : el.dataset.enter !== undefined
                    ? 'entering'
                    : 'shown';
              return [
                role,
                title.trim(),
                cs.animationName,
                cs.animationDuration,
                cs.animationDelay,
                cs.transform,
              ];
            }),
          );
        }).observe(root, { childList: true, subtree: true, attributes: true });
      });
    });
    await dock(page).getByRole('button', { name: 'Next' }).click();
    await expect(dock(page).locator('.dock-title')).toHaveText('Prism');
    const fade = await page.evaluate(
      () => (window as unknown as { __fade: Promise<string[][]> }).__fade,
    );
    expect(fade).toEqual([
      ['leaving', 'Signal / Noise', 'cover-out', '0.42s', '0s', 'none'],
      ['entering', 'Glass Weather', 'cover-in', '0.64s', '0.22s', 'none'],
    ]);
    await expect(items).toHaveCount(1); // the old one is gone once faded
    await expect(items.locator('img')).toHaveAttribute('src', /Glass%20Weather/);

    // The next track is from the same album: same cover, no crossfade.
    await dock(page).getByRole('button', { name: 'Next' }).click();
    await expect(dock(page).locator('.dock-title')).toHaveText('Heat Haze');
    await expect(page.locator('.stage-cover-item[data-leaving]')).toHaveCount(0);
  });
});
