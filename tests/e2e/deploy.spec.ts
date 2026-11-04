import { expect, type Page, test } from '@playwright/test';

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

const ENGINE = /\/assets\/engine-[\w-]+\.js$/;

/** Page loads of the app (Firefox also loads about:blank first), and the chunk failures. */
function count(page: Page) {
  const n = { loads: 0, errors: 0 };
  page.on('load', () => page.url().startsWith('http') && n.loads++);
  page.on('pageerror', () => n.errors++);
  return n;
}

test('after a deploy, the missing Stage chunk reloads the open tab into the new build, once', async ({
  page,
}) => {
  const n = count(page);
  await page.route(ENGINE, (r) => r.fulfill({ status: 404, body: 'gone' }));
  // The server's page names another build, once: the deploy. Reloaded, the tab is that build.
  await page.route(
    (u) => u.pathname === '/',
    async (r) => {
      const res = await r.fetch();
      const body = (await res.text()).replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-x.js');
      await r.fulfill({ response: res, body });
    },
    { times: 1 },
  );
  await page.goto('/listen');
  // The new build's chunk fails too: not a deploy, so the error stands. No loop.
  await expect.poll(() => n.errors, { timeout: 15_000 }).toBe(2);
  await page.waitForTimeout(2000);
  expect(n.loads).toBe(2);
});

// Offline, or a navigation cutting the request off (Firefox aborts the old page's imports): a
// reload would only get in the way, as it did of the Settings → Navidrome hand-over.
test('a chunk that fails while the build is unchanged does not reload the page', async ({
  page,
}) => {
  const n = count(page);
  await page.route(ENGINE, (r) => r.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/listen');
  await expect.poll(() => n.errors, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(2000);
  expect(n.loads).toBe(1);
});
