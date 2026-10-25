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
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  // The Shell is on the M3 surface role (DESIGN_SYSTEM.md §0), whatever the album made it.
  const [bg, surface] = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--md-sys-color-surface)';
    document.body.append(probe);
    const out = [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(probe).backgroundColor,
    ];
    probe.remove();
    return out;
  });
  expect(bg).toBe(surface);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(errors).toEqual([]);
});

// DS-03 / DS-10: the Shell renders in Roboto Flex (Material 3, DESIGN_SYSTEM.md §0), the player in
// Mona Sans, and Geologica is never registered.
test('the Shell uses Roboto Flex, the player Mona Sans, and nothing else', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const families = [...document.fonts].map((f) => f.family.replaceAll('"', ''));
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--font').trim(),
      computed: getComputedStyle(document.querySelector('h1') as HTMLElement).fontFamily,
      dock: getComputedStyle(document.querySelector('.dock-meta') as HTMLElement).fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
      families: [...new Set(families)].sort(),
      check:
        document.fonts.check('500 14px "Roboto Flex"', 'ECHO') &&
        document.fonts.check('600 20px "Mona Sans"', 'ECHO'),
    };
  });
  expect(r.token.replaceAll('"', '')).toMatch(/^Mona Sans,/);
  expect(r.computed.replaceAll('"', '')).toMatch(/^Roboto Flex/);
  expect(r.dock.replaceAll('"', '')).toMatch(/^Mona Sans/);
  expect(r.families).toEqual(['Mona Sans', 'Roboto Flex']);
  expect(r.loaded.length).toBeGreaterThan(0);
  expect(r.check).toBe(true);
});
