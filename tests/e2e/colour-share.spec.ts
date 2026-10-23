import { expect, type Page, test } from '@playwright/test';
import { linearSrgbToOklab, srgbToLinear } from '../../src/shared/oklab.ts';

// DS-02's screenshot script (ACCEPTANCE_CRITERIA.md §7, DESIGN_SYSTEM.md §6): on shell screens,
// coloured pixels (anything not on the neutral ramp) are at most 3%, excluding cover art.
// "Coloured" is OKLCH chroma ≥ 0.02, the boundary §6 uses for near-achromatic artwork; the neutral
// tokens sit at C ≤ 0.01. Every `.art` box is left out. Measured with a track paused at 0:42, the
// worst case: the accent is then on the dock's fill and play state and on the now-playing row.
// Chromium only, like the other pixel checks.

test.skip(({ browserName }) => browserName !== 'chromium', 'pixel checks are Chromium only');

const MAX_SHARE = 0.03;
const MIN_CHROMA = 0.02;

const SCREENS = [
  { name: 'library albums', url: '/library' },
  { name: 'library artists', url: '/library/artists' },
  { name: 'library playlists', url: '/library/playlists' },
  { name: 'library starred', url: '/library/starred' },
  { name: 'album detail', url: '/library/album/al-harbour' },
  { name: 'search results', url: '/search?q=low' },
  { name: 'settings preferences', url: '/settings' },
  { name: 'settings account', url: '/settings/account' },
  { name: 'not found', url: '/nowhere' },
  { name: 'queue sheet', url: '/library/album/al-harbour', queue: true },
];

async function pausedAt42(page: Page) {
  await page.clock.install();
  await page.goto('/library');
  const tile = page.locator('.tile', { hasText: 'Harbour Lights' });
  await tile.hover();
  await tile.getByRole('button', { name: 'Play Harbour Lights' }).click();
  await page.clock.runFor(150 + 42_000);
  await page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Pause' }).click();
}

async function go(page: Page, url: string) {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await page.mouse.move(0, 0);
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

/** Share of non-art pixels with chroma ≥ MIN_CHROMA in a screenshot of the viewport. */
async function colourShare(page: Page) {
  const png = (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64');
  // Decode in the page (canvas), blanking the artwork boxes; the colour maths runs here in Node.
  const rgba = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    /** Blanks the visible part of each art box (a tile under the canvas edge is clipped there). */
    const blank = (arts: Element[]) => {
      for (const el of arts) {
        let { left, top, right, bottom } = el.getBoundingClientRect();
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (getComputedStyle(p).overflow === 'visible') continue;
          const q = p.getBoundingClientRect();
          [left, top, right, bottom] = [
            Math.max(left, q.left),
            Math.max(top, q.top),
            Math.min(right, q.right),
            Math.min(bottom, q.bottom),
          ];
        }
        if (right > left && bottom > top)
          g.clearRect(left * k, top * k, (right - left) * k, (bottom - top) * k);
      }
    };
    // An open modal (a sheet) is opaque and on top: blank the page's art, repaint the modal's box
    // from the screenshot, then blank the art inside it.
    const modal = document.querySelector(':modal');
    const arts = [...document.querySelectorAll('.art')];
    blank(arts.filter((el) => !modal?.contains(el)));
    if (modal) {
      const m = modal.getBoundingClientRect();
      const [x, y, w, h] = [m.left * k, m.top * k, m.width * k, m.height * k];
      g.clearRect(x, y, w, h);
      g.drawImage(img, x, y, w, h, x, y, w, h);
      blank(arts.filter((el) => modal.contains(el)));
    }
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000)
      bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(bin);
  }, png);
  const px = Buffer.from(rgba, 'base64');
  let counted = 0;
  let coloured = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 255) continue; // artwork, cleared above
    counted++;
    const [, a, b] = linearSrgbToOklab([
      srgbToLinear((px[i] as number) / 255),
      srgbToLinear((px[i + 1] as number) / 255),
      srgbToLinear((px[i + 2] as number) / 255),
    ]);
    if (Math.hypot(a, b) >= MIN_CHROMA) coloured++;
  }
  return coloured / counted;
}

// The measurement must see colour where there is some: a Sodium block over 5% of the viewport
// (outside the artwork) has to read as ≈ 5% more.
test('DS-02 script control: a known coloured area is measured', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings');
  await page.evaluate(() => document.fonts.ready);
  const before = await colourShare(page);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText =
      'position:fixed;left:400px;top:300px;width:288px;height:225px;z-index:9;background:#e3b26b';
    document.body.append(d);
  });
  expect((await colourShare(page)) - before).toBeCloseTo(0.05, 3);
});

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`DS-02: coloured pixels ≤ 3% on every shell screen at ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await pausedAt42(page);
    const shares: string[] = [];
    for (const s of SCREENS) {
      await go(page, s.url);
      if (s.queue) {
        await page
          .getByRole('region', { name: 'Player' })
          .getByRole('button', { name: 'Queue' })
          .click();
        await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
      }
      const share = await colourShare(page);
      shares.push(`${s.name} ${(share * 100).toFixed(2)}%`);
      expect.soft(share, `${s.name} at ${vp.width}`).toBeLessThanOrEqual(MAX_SHARE);
      if (s.queue) await page.keyboard.press('Escape');
    }
    test.info().annotations.push({ type: 'colour share', description: shares.join('; ') });
    console.log(`colour share @${vp.width}: ${shares.join('; ')}`);
  });
}
