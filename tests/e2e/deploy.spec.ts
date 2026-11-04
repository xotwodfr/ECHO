import { expect, test } from '@playwright/test';

// After a deploy: the page itself is always asked for again, the hashed assets never are, and a
// tab opened before the deploy, which asks for a chunk of the old build, reloads into the new one.

test('hashed assets are cached for good; the page itself is revalidated', async ({ request }) => {
  const root = await request.get('/');
  expect(root.headers()['cache-control']).toBe('no-cache');
  const asset = /\/assets\/[\w.-]+\.js/.exec(await root.text())?.[0] as string;
  expect(asset).toBeTruthy();
  expect((await request.get(asset)).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
  // A deep link is the same page.
  expect((await request.get('/library')).headers()['cache-control']).toBe('no-cache');
});

test('a Stage chunk gone after a deploy reloads the page once, then gives up', async ({ page }) => {
  let loads = 0;
  page.on('load', () => page.url().startsWith('http') && loads++); // Firefox also loads about:blank
  await page.route(/\/assets\/engine-[\w-]+\.js$/, (r) => r.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/listen');
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2);
  // The new build's chunk is missing too: a real fault, not a deploy. No reload loop.
  await page.waitForTimeout(3000);
  expect(loads).toBe(2);
});
