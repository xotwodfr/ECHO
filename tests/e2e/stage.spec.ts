import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';

// M2 task 4: the Stage engine. VIS-07 (context loss, no WebGL 2), PERF-04 (hidden tab), VIS-09
// (dither), DPR cap and resize. Tests that need WebGL 2 skip where the browser has none: headless
// Firefox on this machine has no WebGL at all, so there the Stage runs its CSS room, and the
// "no WebGL 2" test below covers that path on both browsers.

const stage = (page: Page) => page.locator('.stage');

/** Counts executed requestAnimationFrame callbacks (window.__raf). */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__raf++;
        cb(t);
      });
  });
}
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __raf: number }).__raf);

/** Brightest channel value in a screenshot (a loop: spreading a large buffer overflows the stack). */
async function brightest(png: Buffer) {
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let max = 0;
  for (const v of data) max = Math.max(max, v);
  return max;
}

async function hasWebGL2(page: Page) {
  return page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
}

async function openStage(page: Page) {
  await page.goto('/');
  await expect(stage(page)).not.toHaveAttribute('data-renderer', 'pending', { timeout: 15_000 });
}

test('no WebGL 2: the CSS room, and Settings says visuals are limited', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error narrowing the overloads is not the point here
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : get.call(this, type as '2d', ...(rest as []));
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openStage(page);
  await expect(stage(page)).toHaveAttribute('data-renderer', 'css');
  await expect(stage(page)).toHaveAttribute('data-reason', 'no-webgl2');
  expect(await page.locator('.stage-room-css').evaluate((el) => getComputedStyle(el).display)).toBe(
    'block',
  );
  expect(
    await page.locator('.stage-room-css').evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toMatch(/radial-gradient.*radial-gradient/);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByText("WebGL 2 isn't available in this browser.")).toBeVisible();
  await expect(page.locator('.notice .pill')).toHaveText('Visuals limited');
  expect(errors).toEqual([]);
});

test.describe('with WebGL 2', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/library');
    test.skip(
      !(await hasWebGL2(page)),
      'this browser has no WebGL 2 here (the CSS room is tested above)',
    );
    // Most tests here navigate again. A `goto` while the first page's font is still downloading
    // aborts it, and Firefox logs that as a console error, which tests counting errors would see.
    // `fonts.ready` is not enough: it resolves at once if the load has not started yet.
    await page.evaluate(() => document.fonts.load('16px "Mona Sans"').then(() => undefined));
  });

  test('renders the room in Ambient mode, without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await countFrames(page);
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    await expect(stage(page)).toHaveAttribute('data-mode', 'ambient');
    const a = await frames(page);
    await expect.poll(() => frames(page)).toBeGreaterThan(a + 2); // the loop runs
    expect(errors).toEqual([]);
  });

  // PERF-04: a hidden tab gets 0 animation frames; playback continues.
  test('hidden tab: no frames; visible again: frames resume; playback goes on', async ({
    page,
  }) => {
    await countFrames(page);
    await page.goto('/library');
    const tile = page.locator('.tile').first();
    await tile.hover();
    await tile.getByRole('button', { name: /^Play / }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Listen' })
      .click();
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => (h ? 'hidden' : 'visible'),
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    const seek = page.getByRole('region', { name: 'Player' }).getByRole('slider', { name: 'Seek' });
    await setHidden(true);
    await page.waitForTimeout(100); // let an in-flight frame land
    const hiddenAt = await frames(page);
    const posBefore = Number(await seek.getAttribute('aria-valuenow'));
    await page.waitForTimeout(1500);
    expect(await frames(page)).toBe(hiddenAt);
    expect(Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThan(posBefore);
    await setHidden(false);
    await expect.poll(() => frames(page)).toBeGreaterThan(hiddenAt + 2);
  });

  // VIS-07: context loss shows the CSS room and fully recovers on restore.
  test('context loss: CSS room, then recovery on restore', async ({ page }) => {
    await countFrames(page);
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    await page.evaluate(() => {
      const gl = (document.querySelector('.stage-canvas') as HTMLCanvasElement).getContext(
        'webgl2',
      );
      (window as unknown as { __lose: WEBGL_lose_context }).__lose = gl?.getExtension(
        'WEBGL_lose_context',
      ) as WEBGL_lose_context;
      (window as unknown as { __lose: WEBGL_lose_context }).__lose.loseContext();
    });
    await expect(stage(page)).toHaveAttribute('data-renderer', 'css');
    await expect(stage(page)).toHaveAttribute('data-reason', 'context-lost');
    expect(
      await page.locator('.stage-room-css').evaluate((el) => getComputedStyle(el).display),
    ).toBe('block');
    await page.waitForTimeout(100);
    const lostAt = await frames(page);
    await page.waitForTimeout(500);
    expect(await frames(page)).toBe(lostAt); // the loop is stopped while lost
    await page.evaluate(() =>
      (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext(),
    );
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    await expect.poll(() => frames(page)).toBeGreaterThan(lostAt + 2);
    expect(await brightest(await page.locator('.stage-canvas').screenshot())).toBeGreaterThan(10); // drawing again
  });

  test('backing store is capped by the tier (T1: 1.25) and follows resize', async ({ browser }) => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1024, height: 640 },
    });
    const page = await ctx.newPage();
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    const size = () =>
      page.locator('.stage-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    expect(await size()).toEqual([1280, 800]); // 1024×640 × min(2, 1.25)
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(size).toEqual([1800, 1125]);
    await ctx.close();
  });

  test('reduced motion: Still mode, one frame, no loop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await countFrames(page);
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    await expect(stage(page)).toHaveAttribute('data-mode', 'still');
    await page.waitForTimeout(300);
    const a = await frames(page);
    await page.waitForTimeout(700);
    expect(await frames(page)).toBe(a);
    expect(await brightest(await page.locator('.stage-canvas').screenshot())).toBeGreaterThan(10); // drawn
  });

  test('leaving the Stage stops the loop and releases it', async ({ page }) => {
    await countFrames(page);
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(stage(page)).toHaveCount(0);
    await page.waitForTimeout(100);
    const a = await frames(page);
    await page.waitForTimeout(500);
    expect(await frames(page)).toBe(a);
  });

  // VIS-09 (automated part): the blue-noise dither breaks up the 8-bit steps of dark gradients.
  // Along a row of a dark gradient (the top-left corner: vignette and top scrim), an undithered
  // image keeps one value for 20+ px before stepping by 1; ±1 LSB of blue noise makes neighbours
  // differ often, by a level or two. Checked to fail with the dither removed.
  test('dither: dark gradients are broken up by ±1 LSB noise', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // one fixed frame
    await openStage(page);
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl');
    const png = await page.locator('.stage-canvas').screenshot();
    const { data, info } = await sharp(png)
      .extract({ left: 0, top: 60, width: 400, height: 40 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let differ = 0;
    let big = 0;
    let pairs = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 1; x < info.width; x++) {
        const d = Math.abs(
          (data[y * info.width + x] as number) - (data[y * info.width + x - 1] as number),
        );
        pairs++;
        if (d > 0) differ++;
        if (d > 3) big++;
      }
    expect(differ / pairs).toBeGreaterThan(0.25); // noise, not bands
    expect(big / pairs).toBeLessThan(0.01); // and subtle
  });

  // Task 6: deterministic mode (VISUALIZER_SPEC.md §10), one frame at a song time and seed.
  test('?frame&seed: one frame, no loop, the same pixels on every load', async ({ page }) => {
    await countFrames(page);
    const shot = async (url: string) => {
      await page.goto(url);
      await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
      return page.locator('.stage-canvas').screenshot();
    };
    const a = await shot('/?frame=30000&seed=3');
    expect(page.url()).toMatch(/\/\?frame=30000&seed=3$/); // the URL keeps the params
    await expect(stage(page)).toHaveAttribute('data-mode', 'still');
    await page.waitForTimeout(300);
    const n = await frames(page);
    await page.waitForTimeout(700);
    expect(await frames(page)).toBe(n); // no loop
    expect((await shot('/?frame=30000&seed=3')).equals(a)).toBe(true);
    expect((await shot('/?frame=60000&seed=3')).equals(a)).toBe(false); // time moves the room
    expect((await shot('/?frame=30000&seed=4')).equals(a)).toBe(false); // the seed changes the noise
  });

  test('?track cues that track paused at the frame time; ?tier sets the tier', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1024, height: 640 },
    });
    const page = await ctx.newPage();
    await page.goto('/?frame=72000&track=al-harbour-2&tier=T0');
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
    const player = page.getByRole('region', { name: 'Player' });
    await expect(player.getByText('Low Tide Radio')).toBeVisible();
    await expect(player.getByRole('button', { name: 'Play' })).toBeVisible(); // paused
    await expect(player.getByRole('slider', { name: 'Seek' })).toHaveAttribute(
      'aria-valuenow',
      '72000',
    );
    // T0 caps the backing store at 1.5× (T1 would give 1280×800).
    expect(
      await page.locator('.stage-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]),
    ).toEqual([1536, 960]);
    await ctx.close();
  });

  // `fixture` names recorded Features (§10), never a track. The M2 room does not read features, so
  // the pixels are the same either way; this checks loading, reporting and the URL.
  test('?fixture loads recorded Features: no errors, kept in the URL', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/?frame=1000&fixture=pulse&debug=1');
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
    expect(page.url()).toMatch(/\/\?frame=1000&fixture=pulse&debug=1$/);
    expect(errors).toEqual([]);
  });

  test('?fixture with an unknown name is reported, cues nothing, still renders', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/?frame=1000&fixture=al-harbour-2');
    await expect(stage(page)).toHaveAttribute('data-renderer', 'webgl', { timeout: 15_000 });
    expect(errors).toEqual(['Deterministic mode: no Features fixture "al-harbour-2"']);
    await expect(
      page.getByRole('region', { name: 'Player' }).getByText('Low Tide Radio'),
    ).toHaveCount(0);
  });
});
