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
  // Spotify's frame (DESIGN_SYSTEM.md §3.1): the page black, the panels #121212 as glass (84%
  // of it, the album-tinted frame behind showing through at the edges, §7.11).
  const [body, panel] = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--panel)';
    document.body.append(probe);
    const solid = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(document.body).backgroundColor, solid];
  });
  expect(body).toBe('rgb(0, 0, 0)');
  expect(panel).toBe('rgb(18, 18, 18)');
  await expect(page.locator('.canvas')).toHaveClass(/\bglass\b/);
  expect(
    await page.locator('.canvas').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toMatch(/ \/ 0\.84\)$/);
  expect(errors).toEqual([]);
});

// DS-03 / DS-10: the whole app, lyrics included, is set in Figtree (DESIGN_SYSTEM.md §4.1).
test('everything uses Figtree, and nothing else', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const families = [...document.fonts].map((f) => f.family.replaceAll('"', ''));
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--font').trim(),
      computed: getComputedStyle(document.querySelector('h1') as HTMLElement).fontFamily,
      dock: getComputedStyle(document.querySelector('.dock-meta') as HTMLElement).fontFamily,
      families: [...new Set(families)].sort(),
      check: document.fonts.check('700 16px "Figtree"', 'ECHO'),
    };
  });
  expect(r.token.replaceAll('"', '')).toMatch(/^Figtree,/);
  expect(r.computed.replaceAll('"', '')).toMatch(/^Figtree/);
  expect(r.dock.replaceAll('"', '')).toMatch(/^Figtree/);
  expect(r.families).toEqual(['Figtree']);
  expect(r.check).toBe(true);
});
