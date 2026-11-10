import { expect, type Page, test } from '@playwright/test';

// Visual baselines for the frame with the fixture library: Home, Your Library and an album with the
// player paused at 0:42, the queue (the right panel, or a sheet on phones), and the lyrics view.
// Chromium only (TECHNICAL_ARCHITECTURE.md §8). Update in the CI image:
// scripts/e2e-container.sh --project=chromium shell.visual -u

test.skip(({ browserName }) => browserName !== 'chromium', 'pixel baselines are Chromium only');

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];
// Antialiasing in the software renderer varies by a few dozen pixels between runs: allowed, a
// real change moves thousands.
const shot = {
  animations: 'disabled',
  caret: 'hide',
  threshold: 0.05,
  maxDiffPixels: 100,
  timeout: 15_000, // 2560 wide in the CI image's software renderer: slow to come out stable
} as const;

/** Plays Harbour Lights track 1 and pauses it at 0:42, with fonts and covers loaded. */
async function pausedAt42(page: Page, url: string) {
  // A fixed afternoon: the greeting follows the hour and its mask is as wide as its text, so with
  // the real time "Good evening" changed ~935 pixels against an afternoon baseline.
  await page.clock.install({ time: new Date('2026-11-10T15:00:00') });
  await page.goto('/library/album/al-harbour');
  await page.locator('.action-bar').getByRole('button', { name: 'Play Harbour Lights' }).click();
  await page.clock.runFor(150 + 42_000);
  await page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Pause' }).click();
  if (url !== '/library/album/al-harbour') {
    await page.evaluate((u) => {
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, url);
    // The page change runs as a View Transition: past it (the fake clock holds it otherwise).
    await expect
      .poll(
        async () => {
          await page.clock.runFor(250);
          return page.evaluate(() => document.documentElement.classList.contains('vt'));
        },
        { timeout: 20_000 },
      )
      .toBe(false);
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
  test(`Home with the player paused at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await pausedAt42(page, '/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good /);
    // The greeting is masked: its words are not what this baseline checks.
    await expect(page).toHaveScreenshot(`home-${vp.width}.png`, {
      ...shot,
      mask: [page.locator('.home-greeting')],
    });
  });

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
    // Q: the right panel on wide screens, a sheet on phones (whose mini player has no queue button).
    await page.keyboard.press('q');
    await expect(
      page
        .getByRole('complementary', { name: 'Queue' })
        .or(page.getByRole('dialog', { name: 'Queue' })),
    ).toBeVisible();
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
    await page.goto('/listen');
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
  await page.goto('/library/album/al-harbour');
  await page.locator('.action-bar').getByRole('button', { name: 'Play Harbour Lights' }).click();
  // In-app navigation to the lyrics view (phones reach it by tapping the mini player).
  await page.evaluate(() => {
    history.pushState(null, '', '/listen');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.stage')).toHaveAttribute('data-renderer', 'webgl', {
    timeout: 15_000,
  });
  await expect(page.locator('.stage')).toHaveAttribute('data-cover', 'shown');
  await page.evaluate(() => document.fonts.ready);
}
const timeMask = (page: Page) => [
  page.locator('.scrubber-time'),
  page.locator('.dock-scrub .slider'),
  page.locator('.np-progress'),
];

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Cover mode at ${vp.width}`, async ({ page }) => {
    await playOnStage(page, vp);
    await page.keyboard.press('c'); // the cover and title alone, centred
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Pause' })
      .click();
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('.np-view')).toHaveAttribute('data-mode', 'cover');
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
