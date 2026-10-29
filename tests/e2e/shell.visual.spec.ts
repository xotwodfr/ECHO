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
const shot = { animations: 'disabled', caret: 'hide', threshold: 0.05 } as const;

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

// The Listen stage's Ambient room from deterministic mode (VISUALIZER_SPEC.md §10): drawn once, in
// Still, with Ambient's time bases at 47 s, and the track cued paused there so the dock is fixed.
for (const vp of VIEWPORTS) {
  test(`Listen stage, Ambient frame, at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/?frame=47000&seed=1&track=al-harbour-2');
    await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl', {
      timeout: 15_000,
    });
    await expect(page.locator('.stage')).toHaveAttribute('data-cover', 'shown'); // drawn under the room
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`listen-frame-${vp.width}.png`, shot);
  });
}

// The Listen stage in Still mode (reduced motion): one fixed frame of the room on the fallback
// palette, rendered by SwiftShader (playwright.config.ts).
for (const vp of VIEWPORTS) {
  test(`Listen stage, Still, at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl', {
      timeout: 15_000,
    });
    await expect(page.locator('.stage')).toHaveAttribute('data-mode', 'still');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`listen-still-${vp.width}.png`, shot);
  });
}

// Task 5: Cover mode, and the chrome hidden after idle. Still mode (reduced motion) for a fixed
// room; the scrubber's time and fill depend on real elapsed time, so they are masked.
async function playOnStage(page: Page, vp: { width: number; height: number }) {
  await page.setViewportSize(vp);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/library');
  const tile = page.locator('.tile', { hasText: 'Harbour Lights' });
  await tile.hover();
  await tile.getByRole('button', { name: 'Play Harbour Lights' }).click();
  await page
    .getByRole('region', { name: 'Player' })
    .getByRole('button', { name: 'Lyrics', exact: true })
    .click();
  await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl', {
    timeout: 15_000,
  });
  await expect(page.locator('.stage')).toHaveAttribute('data-cover', 'shown');
  await page.evaluate(() => document.fonts.ready);
}
const timeMask = (page: Page) => [
  page.locator('.scrubber-time'),
  page.locator('.dock-scrub .slider'),
];

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Cover mode at ${vp.width}`, async ({ page }) => {
    await playOnStage(page, vp);
    await page.keyboard.press('c'); // Cover has no button (owner, 2026-10-28)
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Pause' })
      .click();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('.stage-cover-item')).toHaveCount(1);
    await expect(page).toHaveScreenshot(`cover-${vp.width}.png`, { ...shot, mask: timeMask(page) });
  });
}

test('chrome hidden after idle at 1440', async ({ page }) => {
  await playOnStage(page, { width: 1440, height: 900 });
  await page.mouse.move(700, 400);
  await expect(page.locator('.shell')).toHaveAttribute('data-chrome', 'hidden', { timeout: 6000 });
  await page.waitForTimeout(800); // the 640 ms fade
  await expect(page).toHaveScreenshot('chrome-hidden-1440.png', { ...shot, mask: timeMask(page) });
});
