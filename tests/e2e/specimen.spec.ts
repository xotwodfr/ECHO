import { expect, type Page, test } from '@playwright/test';

const FACES = { geologica: 'Geologica', mona: 'Mona Sans' } as const;
type Face = keyof typeof FACES;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];

async function open(page: Page, face: Face, palette = 'sodium') {
  await page.goto(`/specimen.html?face=${face}&palette=${palette}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

test('the specimen opens on Mona Sans by default', async ({ page }) => {
  await page.goto('/specimen.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-face', 'mona');
  await expect(page.getByRole('button', { name: 'Mona Sans' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const font = await page.evaluate(
    () => getComputedStyle(document.querySelector('.field .line.active') as HTMLElement).fontFamily,
  );
  expect(font.replaceAll('"', '')).toMatch(/^Mona Sans/);
});

for (const [face, family] of Object.entries(FACES) as [Face, string][]) {
  // DS-03: the face really renders (document.fonts + computed style), both subsets.
  test(`${family} is loaded and used on the stage`, async ({ page }) => {
    await open(page, face);
    const result = await page.evaluate((fam) => {
      const faces = [...document.fonts].filter((f) => f.family.replaceAll('"', '') === fam);
      const active = document.querySelector('.field .line.active') as HTMLElement;
      return {
        loaded: faces.filter((f) => f.status === 'loaded').length,
        check: document.fonts.check(`600 56px "${fam}"`, 'Every Łódź'),
        computed: getComputedStyle(active).fontFamily,
      };
    }, family);
    expect(result.loaded).toBe(2); // latin + latin-ext
    expect(result.check).toBe(true);
    expect(result.computed.replaceAll('"', '')).toMatch(new RegExp(`^${family}`));
  });

  // DS-03 / Q-DS-1: tnum makes digits equal width (and pnum does not).
  test(`${family} tabular digits work`, async ({ page }) => {
    await open(page, face);
    await expect(page.locator(`#tnum-body tr[data-face="${face}"]`)).toHaveAttribute(
      'data-tnum',
      'pass',
    );
  });

  for (const vp of VIEWPORTS) {
    test(`${family} stage layout holds at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await open(page, face);
      const m = await page.evaluate(() => {
        const stage = document.getElementById('stage') as HTMLElement;
        const H = stage.clientHeight - 88;
        const box = (el: Element) => el.getBoundingClientRect();
        const active = document.querySelector('.field .line.active') as HTMLElement;
        const zone = [...document.querySelectorAll('.field .line[data-rank="zone"]')];
        const readable = [active, ...zone, ...document.querySelectorAll('.field .line.past')];
        const lh = Number.parseFloat(getComputedStyle(active).fontSize) * 1.12;
        return {
          W: stage.clientWidth,
          H,
          activeCentre: (box(active).top + box(active).bottom) / 2,
          activeRows: Math.round(active.offsetHeight / lh),
          zoneBottom: Math.max(...zone.map((el) => box(el).bottom)),
          zoneTops: zone.map((el) => box(el).top),
          activeBottom: box(active).bottom,
          overflowX: readable.some(
            (el) => box(el).left < -0.5 || box(el).right > stage.clientWidth + 0.5,
          ),
          pageScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(Math.abs(m.activeCentre - 0.4 * m.H)).toBeLessThanOrEqual(2); // LYR-02 anchor
      expect(m.activeRows).toBeLessThanOrEqual(3);
      expect(m.zoneBottom).toBeLessThanOrEqual(0.86 * m.H + 0.5); // §4.3 zone bottom
      for (const top of m.zoneTops) expect(top).toBeGreaterThanOrEqual(m.activeBottom - 0.5);
      expect(m.overflowX).toBe(false);
      expect(m.pageScrollX).toBe(false);
    });
  }
}

test('switching face and palette re-lays out without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'geologica');
  await page.keyboard.press('f');
  await expect(page.locator('body')).toHaveAttribute('data-face', 'mona');
  await page.getByRole('button', { name: 'Ember' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-palette', 'ember');
  await expect(page.getByRole('button', { name: 'Ember' })).toHaveAttribute('aria-pressed', 'true');
  expect(page.url()).toContain('face=mona');
  expect(errors).toEqual([]);
});

// Review screenshots: SHOTS=1 pnpm test:e2e --project=chromium specimen
test.describe('review screenshots', () => {
  test.skip(!process.env.SHOTS, 'set SHOTS=1 to write specimen-shots/');
  test('review sheet', async ({ page }, info) => {
    await page.setViewportSize(VIEWPORTS[0] as (typeof VIEWPORTS)[number]);
    await open(page, 'geologica');
    await page
      .locator('#sheet')
      .screenshot({ path: `specimen-shots/${info.project.name}/sheet.png` });
  });
  for (const vp of VIEWPORTS) {
    for (const face of Object.keys(FACES) as Face[]) {
      for (const palette of ['sodium', 'tide', 'ember']) {
        test(`${face} ${palette} ${vp.width}x${vp.height}`, async ({ page }, info) => {
          await page.setViewportSize(vp);
          await open(page, face, palette);
          await page.screenshot({
            animations: 'disabled', // settle the control-state transitions
            path: `specimen-shots/${info.project.name}/${vp.width}x${vp.height}-${face}-${palette}.png`,
          });
        });
      }
    }
  }
});
