import { expect, type Page, test } from '@playwright/test';
import { signedIn, ytSignIn } from './helpers.ts';

// YouTube Music mode's night edition and its springs (the owner's ask, 2026-11-03): ECHO's motion
// tokens and helpers (ui/motion.ts), in the Liner notes look.

const bar = (page: Page) => page.getByRole('region', { name: 'Player' });
const ground = (page: Page) =>
  page.locator('.yt').evaluate((el) => getComputedStyle(el).backgroundColor);
const pseudoRunning = (page: Page, pseudo: string) =>
  page.evaluate(
    (p) =>
      document
        .getAnimations()
        .some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement === p),
    pseudo,
  );

async function play(page: Page) {
  await page.goto('/yt/album/MPREb_fake1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(bar(page)).toHaveAttribute('data-status', 'playing', { timeout: 10_000 });
}

// ---- the night edition ----

test('the night switch turns the paper dark, and the choice stays', async ({ page }) => {
  await signedIn(page, 'night');
  await page.goto('/yt');
  const night = page.getByRole('button', { name: 'Night edition' });
  await expect(night).toHaveAttribute('aria-pressed', 'false');
  expect(await ground(page)).toBe('rgb(243, 238, 230)');
  await night.click();
  await expect(night).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ground(page)).toBe('rgb(23, 21, 18)');
  await expect(page.locator('.yt-masthead')).toContainText(/night edition/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Night edition' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await ground(page)).toBe('rgb(23, 21, 18)');
});

test('a dark device gets the night edition until the switch says otherwise', async ({ page }) => {
  await signedIn(page, 'night-device');
  await page.goto('/yt');
  // Set after loading: Firefox drops an emulated scheme when the page first navigates.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => ground(page)).toBe('rgb(23, 21, 18)');
  await page.getByRole('button', { name: 'Night edition' }).click();
  await expect.poll(() => ground(page)).toBe('rgb(243, 238, 230)');
  await page.reload();
  expect(await ground(page)).toBe('rgb(243, 238, 230)');
});

test('the night spreads from the switch on the spring', async ({ page }) => {
  await signedIn(page, 'night-spread');
  await page.goto('/yt');
  test.skip(
    !(await page.evaluate(() => 'startViewTransition' in document)),
    'no View Transitions in this browser',
  );
  await page.getByRole('button', { name: 'Night edition' }).click();
  await expect
    .poll(() => pseudoRunning(page, '::view-transition-new(root)'), { intervals: [10] })
    .toBe(true);
});

// ---- springs ----

test('a YouTube page rises in on the spring', async ({ page }) => {
  await signedIn(page, 'yt-rise');
  await page.goto('/yt');
  test.skip(
    !(await page.evaluate(() => 'startViewTransition' in document)),
    'no View Transitions in this browser',
  );
  await expect(page.getByRole('heading', { name: 'Quick picks' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore' }).click();
  await expect
    .poll(() => pseudoRunning(page, '::view-transition-new(page)'), { intervals: [10] })
    .toBe(true);
});

test('the paper player rises in and sinks out', async ({ page }) => {
  await signedIn(page, 'yt-np-motion');
  await play(page);
  await bar(page).getByRole('button', { name: 'Up next', exact: true }).click();
  const np = page.locator('.yt-np');
  await expect.poll(() => np.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close the player' }).click();
  await expect(page.locator('.yt-np[data-leaving]')).toHaveCount(1);
  await expect(np).toHaveCount(0);
});

test('with Motion Off the paper player closes at once', async ({ page }) => {
  await signedIn(page, 'yt-np-off');
  await page.goto('/settings');
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Off' }).click();
  await play(page);
  await bar(page).getByRole('button', { name: 'Up next', exact: true }).click();
  await page.getByRole('button', { name: 'Close the player' }).click();
  await expect(page.locator('.yt-np')).toHaveCount(0, { timeout: 100 });
});

test('the underline slides to the chosen tab', async ({ page }) => {
  await signedIn(page, 'yt-slide');
  await play(page);
  await bar(page).getByRole('button', { name: 'Up next', exact: true }).click();
  const np = page.getByRole('dialog', { name: 'Now playing' });
  await page.waitForTimeout(700);
  await np.getByRole('tab', { name: 'Related' }).click();
  const sliding = await np
    .getByRole('tab', { name: 'Related' })
    .evaluate(
      (t) =>
        t
          .getAnimations({ subtree: true })
          .filter((a) => (a.effect as KeyframeEffect).pseudoElement === '::after').length,
    );
  expect(sliding).toBeGreaterThan(0);
  // The new tab's page springs in under it.
  const panel = np.getByRole('tabpanel').locator(':scope > *').first();
  expect(
    await panel.evaluate((el) =>
      el.getAnimations().some((a) => (a as CSSTransition).transitionProperty === 'translate'),
    ),
  ).toBe(true);
});

test('YouTube lists arrive in a wave after loading', async ({ page }) => {
  await signedIn(page, 'yt-wave');
  await page.route('**/api/v1/youtube/explore*', async (route) => {
    await new Promise((done) => setTimeout(done, 800));
    await route.continue();
  });
  await page.goto('/yt/explore');
  await expect(page.locator('.yt-loading')).toBeVisible();
  await expect(page.locator('.yt-shelf [data-arrive]').first()).toBeAttached();
  await expect(page.locator('[data-arrive]')).toHaveCount(0, { timeout: 2000 });
});

test('YouTube presses spring', async ({ page }) => {
  await signedIn(page, 'yt-press');
  await play(page);
  for (const selector of ['.yt-word', '.yt-row-play', '.yt-nav-link', '.yt-button']) {
    const transition = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).transition);
    expect(transition, selector).toMatch(/scale [\d.]+s linear\(/);
  }
});

test('Like pops when clicked, not when the page shows it', async ({ page }) => {
  await signedIn(page, 'yt-pop');
  await ytSignIn(page);
  await play(page);
  await bar(page).getByRole('button', { name: 'Up next', exact: true }).click();
  const np = page.getByRole('dialog', { name: 'Now playing' });
  const like = np.getByRole('button', { name: /^Like/ });
  const was = await like.getAttribute('aria-pressed');
  await like.click();
  await expect(like).toHaveAttribute('data-pop', /in|out/);
  await expect(like).not.toHaveAttribute('data-pop'); // gone once the pop has played
  if (was === 'false') await like.click(); // leave the shared likes as they were
});

test("the strip's cover springs in on a new song", async ({ page }) => {
  await signedIn(page, 'yt-cover');
  await play(page);
  await page.waitForTimeout(700);
  await bar(page).getByRole('button', { name: 'Next', exact: true }).click();
  await expect
    .poll(
      () =>
        bar(page)
          .locator('.yt-thumb')
          .first()
          .evaluate((a) => a.getAnimations().length),
      {
        intervals: [20],
      },
    )
    .toBeGreaterThan(0);
});
