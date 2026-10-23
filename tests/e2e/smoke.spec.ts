import { expect, test } from '@playwright/test';

test('health endpoint answers ok', async ({ request }) => {
  const res = await request.get('/api/v1/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('the empty client loads with tokens and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ECHO' })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(10, 11, 13)'); // --ground #0A0B0D
  expect(errors).toEqual([]);
});

// DS-03 / DS-10: the application renders in Mona Sans and never registers Geologica.
test('the application uses Mona Sans and only Mona Sans', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ECHO' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const families = [...document.fonts].map((f) => f.family.replaceAll('"', ''));
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--font').trim(),
      computed: getComputedStyle(document.querySelector('h1') as HTMLElement).fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
      families: [...new Set(families)],
      check: document.fonts.check('600 20px "Mona Sans"', 'ECHO'),
    };
  });
  expect(r.token.replaceAll('"', '')).toMatch(/^Mona Sans,/);
  expect(r.computed.replaceAll('"', '')).toMatch(/^Mona Sans/);
  expect(r.families).toEqual(['Mona Sans']);
  expect(r.loaded.length).toBeGreaterThan(0);
  expect(r.check).toBe(true);
});
