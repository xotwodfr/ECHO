import { expect, test } from '@playwright/test';

test('health endpoint answers ok', async ({ request }) => {
  const res = await request.get('/api/v1/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('the client loads with tokens and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  // Fluent surfaces (DESIGN_SYSTEM.md §3.1, §6): the frame is transparent over Mica, the page is
  // Fluent's translucent layer, so the album's glow shows through without a backdrop filter.
  const [frame, panel, canvas] = await page.evaluate(() => {
    const role = (v: string) => {
      const probe = document.createElement('div');
      probe.style.background = `var(${v})`;
      document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    };
    const canvas = document.querySelector('.canvas') as HTMLElement;
    return [role('--frame'), role('--fl-layer'), getComputedStyle(canvas).backgroundColor];
  });
  expect(await page.locator('.shell').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    frame,
  );
  expect(canvas).toBe(panel);
  expect(frame).toBe('rgba(0, 0, 0, 0)');
  expect(panel).toMatch(/^rgba\(\d+, \d+, \d+, 0\.55\)$/); // translucent, no filter
  expect(errors).toEqual([]);
});

// DS-03 / DS-10: the whole app, lyrics included, is set in Segoe UI where it is installed and in
// Selawik, Microsoft's open Segoe fallback, everywhere else (DESIGN_SYSTEM.md §4.1).
test('the type is Segoe UI, falling back to Selawik', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const families = [...document.fonts].map((f) => f.family.replaceAll('"', ''));
    const loaded = [...document.fonts]
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replaceAll('"', ''));
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--font').trim(),
      computed: getComputedStyle(document.querySelector('h1') as HTMLElement).fontFamily,
      dock: getComputedStyle(document.querySelector('.dock-meta') as HTMLElement).fontFamily,
      families: [...new Set(families)].sort(),
      loaded: [...new Set(loaded)].sort(),
      check: document.fonts.check('600 16px "Selawik"', 'ECHO'),
    };
  });
  const stack = r.token.replaceAll('"', '');
  expect(stack).toMatch(/^Segoe UI Variable Text, Segoe UI, Selawik,/);
  expect(r.computed.replaceAll('"', '')).toBe(stack);
  expect(r.dock.replaceAll('"', '')).toBe(stack);
  // Roboto is declared for YouTube Music mode (youtube/yt.css) and never loaded here; the test box
  // has no Segoe UI.
  expect(r.families).toEqual(['Roboto', 'Selawik']);
  expect(r.loaded).toEqual(['Selawik']);
  expect(r.check).toBe(true);
});
