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

// Spring motion (DESIGN_SYSTEM.md §11.2): the right panel's column animates the page's width, so
// it must stay smooth over a big library page.
test('MOT-PERF: the right panel opens and closes at ≥ 50 fps over 5,000 albums', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await signedInWithNavidrome(page, 'perf');
  await faults('bigLibrary=5000');
  await page.goto('/library');
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.tile').length), { timeout: 20_000 })
    .toBeGreaterThan(10);
  const queue = page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Queue' });
  const deltas: number[] = [];
  for (let i = 0; i < 10; i++) {
    const sampling = page.evaluate(
      () =>
        new Promise<number[]>((done) => {
          const out: number[] = [];
          let last = performance.now();
          const end = last + 650;
          const frame = (now: number) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(frame);
            else done(out.slice(1));
          };
          requestAnimationFrame(frame);
        }),
    );
    await queue.click();
    deltas.push(...(await sampling));
  }
  const sorted = deltas.sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(20);
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

test('PERF-03, LYR-26: Stage main-thread work and the lyric update per frame at T0', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'perf');
  // T0, fixed: Settings → Visuals → Quality = High on this device.
  await page.evaluate(() => localStorage.setItem('echo.visuals.quality', '"high"'));
  await playAlbum(page, 'al-1'); // its first track has word-synced lyrics (mock Navidrome)
  await expect(page.getByRole('list', { name: 'Lyrics' })).toBeAttached();
  type Perf = { frameMs: number[]; lyricsMs: number[]; tiers: string[]; tier: string };
  // The setting holds: the Stage draws at T0.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __echoPerf?: Perf }).__echoPerf?.tier))
    .toBe('T0');
  await page.waitForTimeout(8000);
  // A manual tier still gives way below 20 fps for 3 s (VISUALIZER_SPEC.md §8.2), and SwiftShader
  // draws T0 at 12-15 fps: the governor steps down to T1 about 7 s in (60 frames for the refresh
  // rate, then 3 s), before or after the 8 s are up as the machine's speed falls. The costs are the
  // frames drawn at T0.
  const p = await page.evaluate(() => {
    const perf = (window as unknown as { __echoPerf: Perf }).__echoPerf;
    const at = (xs: number[]) => xs.filter((_, i) => perf.tiers[i] === 'T0');
    const q = (xs: number[], f: number) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length * f)] as number;
    const frameMs = at(perf.frameMs);
    const lyricsMs = at(perf.lyricsMs);
    return {
      tier: perf.tier,
      frames: perf.frameMs.length,
      framesAtT0: frameMs.length,
      frameMedian: q(frameMs, 0.5),
      frameP95: q(frameMs, 0.95),
      lyricsMedian: q(lyricsMs, 0.5),
      lyricsP95: q(lyricsMs, 0.95),
    };
  });
  console.log(`stage perf on this machine: ${JSON.stringify(p)}`);
  // SwiftShader draws T0 in software, so frames are few here; the main-thread costs per frame are
  // what this measures. The reference clients' GPU numbers (PERF-01) are the owner's runs.
  expect(p.framesAtT0).toBeGreaterThan(30);
  expect(p.lyricsMedian).toBeLessThanOrEqual(2.5); // LYR-26
  expect(p.frameMedian).toBeLessThanOrEqual(4); // PERF-03
});
