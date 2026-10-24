import { expect, test } from '@playwright/test';
import { faults, playAlbum, signedInWithNavidrome } from './helpers.ts';

// Performance checks that a browser on this machine can make (the reference clients are the
// owner's, IMPLEMENTATION_PLAN.md M9 task 1): LIB-02 (5,000 albums, windowed, smooth scroll),
// PERF-05 (cold start on LAN), PERF-06 (no heap growth over 20 track changes). Runs in the
// isolated project: it gives the shared mock Navidrome a huge library.

test.describe.configure({ mode: 'serial' });
test.afterEach(() => faults());

test('LIB-02: 5,000 albums scroll at ≥ 55 fps with ≤ 150 tiles in the DOM', async ({ page }) => {
  await signedInWithNavidrome(page, 'perf');
  await faults('bigLibrary=5000');
  await page.goto('/library');
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.tile').length), { timeout: 20_000 })
    .toBeGreaterThan(10);
  const result = await page.evaluate(async () => {
    const scroller = document.querySelector('.canvas') as HTMLElement;
    const deltas: number[] = [];
    let maxTiles = 0;
    let last = performance.now();
    const end = last + 4000;
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        deltas.push(now - last);
        last = now;
        scroller.scrollTop += 120; // a brisk, steady scroll
        maxTiles = Math.max(maxTiles, document.querySelectorAll('.tile').length);
        if (now < end) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    const sorted = deltas.slice(1).sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length / 2)] as number,
      maxTiles,
      scrolled: scroller.scrollTop,
      height: scroller.scrollHeight,
    };
  });
  expect(result.maxTiles).toBeLessThanOrEqual(150);
  expect(result.scrolled).toBeGreaterThan(10_000); // it really travelled through the list
  expect(result.height).toBeGreaterThan(100_000); // the whole list keeps its height
  expect(1000 / result.median).toBeGreaterThanOrEqual(55);
});

test('PERF-05: cold start to an interactive shell within 1.5 s on the LAN', async ({ page }) => {
  await signedInWithNavidrome(page, 'perf');
  // A fresh navigation with an empty cache.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await page.goto('about:blank');
  const start = Date.now();
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const ms = Date.now() - start;
  expect(ms).toBeLessThanOrEqual(1500);
});

test('PERF-06: no heap growth over 20 MB across 20 track changes', async ({ page }) => {
  await signedInWithNavidrome(page, 'perf');
  await playAlbum(page, 'al-3');
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return page.evaluate(
      () =>
        (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
    );
  };
  const before = await heap();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Control+ArrowLeft' : 'Control+ArrowRight');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);
  const growth = (await heap()) - before;
  expect(growth).toBeLessThan(20 * 1024 * 1024);
});
