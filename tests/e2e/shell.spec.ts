import { expect, type Page, test } from '@playwright/test';

// M2 task 1: viewStore (history sync, deep links) and the shell frame (DESIGN_SYSTEM.md §5).

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const DEEP_LINKS = [
  { url: '/library', heading: 'Library', nav: 'Library', tab: 'Albums' },
  { url: '/library/starred', heading: 'Library', nav: 'Library', tab: 'Starred' },
  { url: '/library/album/al-42', heading: 'Album', nav: 'Library' },
  // A query nothing in the fixture library matches ("static" became a guide track in M3).
  { url: '/search?q=xylophone', heading: 'Search', text: 'No results for “xylophone”.' },
  { url: '/settings', heading: 'Settings', nav: 'Settings', tab: 'Preferences' },
  { url: '/settings/account', heading: 'Settings', nav: 'Settings', tab: 'Account' },
];

for (const link of DEEP_LINKS) {
  test(`deep link ${link.url} opens its view directly and survives reload`, async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(link.url);
    expect(res?.status()).toBe(200);
    for (let i = 0; i < 2; i++) {
      await expect(h1(page)).toHaveText(link.heading);
      await expect(page).toHaveTitle(`${link.heading} · ECHO`);
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(link.url);
      if (link.nav) {
        await expect(mainNav(page).locator('[aria-current="page"]')).toHaveText(link.nav);
      }
      if (link.tab) {
        await expect(page.locator('.tabs [aria-current="page"]')).toHaveText(link.tab);
      }
      if (link.text) await expect(page.getByText(link.text)).toBeVisible();
      await page.reload();
    }
    expect(errors).toEqual([]);
  });
}

test('the root is the Stage: full-bleed, no sidebar, a way back to the Library', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Listen · ECHO');
  await expect(mainNav(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Player' })).toBeVisible();
  const vp = page.viewportSize();
  const stage = await page.locator('.stage').boundingBox();
  expect(stage).toEqual({ x: 0, y: 0, width: vp?.width, height: vp?.height });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(h1(page)).toHaveText('Library');
});

test('a non-canonical deep link is rewritten in place', async ({ page }) => {
  await page.goto('/library/albums');
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator('.tabs [aria-current="page"]')).toHaveText('Albums');
});

test('an unknown address shows "Page not found" and keeps the address', async ({ page }) => {
  await page.goto('/no/such/view?x=1');
  await expect(h1(page)).toHaveText('Page not found');
  await expect(page).toHaveURL(/\/no\/such\/view\?x=1$/);
  await page.getByRole('main').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(h1(page)).toHaveText('Library');
});

test('missing files and API paths are not answered with the client', async ({ request }) => {
  expect((await request.get('/assets/missing.js')).status()).toBe(404);
  const api = await request.get('/api/v1/library');
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: 'not_found' });
});

test('back and forward move through views without reloading', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { marker: number }).marker = 1;
  });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('link', { name: 'Artists' }).click();
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);

  const expectAt = async (path: RegExp, heading: string) => {
    await expect(page).toHaveURL(path);
    await expect(h1(page)).toHaveText(heading);
  };
  await page.goBack();
  await expectAt(/\/settings$/, 'Settings');
  await page.goBack();
  await expectAt(/\/library\/artists$/, 'Library');
  await expect(page.locator('.tabs [aria-current="page"]')).toHaveText('Artists');
  await page.goBack();
  await expectAt(/\/library$/, 'Library');
  await page.goBack();
  await expect(page).toHaveTitle('Listen · ECHO');
  await expect(mainNav(page)).toHaveCount(0);
  await page.goForward();
  await page.goForward();
  await expectAt(/\/library\/artists$/, 'Library');
  // Same document throughout: navigation is client-side.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
});

test('re-selecting the current view adds no history entry', async ({ page }) => {
  await page.goto('/library');
  const before = await page.evaluate(() => history.length);
  await mainNav(page).getByRole('link', { name: 'Library', exact: true }).click();
  await mainNav(page).getByRole('link', { name: 'Library', exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test('links are real hrefs and focus moves to the new heading', async ({ page }) => {
  await page.goto('/library');
  await expect(mainNav(page).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/settings',
  );
  await page.getByRole('link', { name: 'Playlists' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/library\/playlists$/);
  await expect(h1(page)).toBeFocused();
});

test('typing in the sidebar search is one history entry; `/` focuses it', async ({ page }) => {
  await page.goto('/library');
  await expect(h1(page)).toHaveText('Library'); // the shortcut exists once the shell has rendered
  await page.locator('body').press('/');
  const field = mainNav(page).getByRole('searchbox', { name: 'Search' });
  await expect(field).toBeFocused();
  await field.pressSequentially('night');
  await expect(page).toHaveURL(/\/search\?q=night$/);
  await expect(field).toBeFocused();
  await expect(page.getByText('No results for “night”.')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect(field).toHaveValue('');
});

// DESIGN_SYSTEM.md §5: columns = floor((W + 16) / (168 + 16)); edges land on both gutters.
for (const width of [1024, 1440, 2560]) {
  test(`album grid arithmetic at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/library');
    await expect(h1(page)).toHaveText('Library'); // React renders after load; wait for it
    const r = await page.evaluate(() => {
      const grid = document.querySelector('.album-grid') as HTMLElement;
      // Library data arrives with the fixture provider (M2 task 3); stand-in tiles test the CSS.
      for (let i = 0; i < 24; i++) grid.append(document.createElement('li'));
      const canvas = (document.querySelector('.canvas') as HTMLElement).getBoundingClientRect();
      const tiles = [...grid.children].map((li) => li.getBoundingClientRect());
      const top = tiles[0]?.top;
      const row = tiles.filter((t) => t.top === top);
      return {
        gridWidth: grid.getBoundingClientRect().width,
        canvasLeft: canvas.left,
        canvasRight: canvas.left + (document.querySelector('.canvas') as HTMLElement).clientWidth,
        columns: row.length,
        first: row[0]?.left ?? 0,
        last: row.at(-1)?.right ?? 0,
        tile: row[0]?.width ?? 0,
      };
    });
    const W = width - 224 - 2 * 32;
    expect(r.gridWidth).toBeCloseTo(W, 0);
    expect(r.columns).toBe(Math.floor((W + 16) / (168 + 16)));
    expect(r.tile).toBeGreaterThanOrEqual(168);
    expect(r.first - r.canvasLeft).toBeCloseTo(32, 0);
    expect(r.canvasRight - r.last).toBeCloseTo(32, 0);
  });
}

for (const vp of VIEWPORTS) {
  test(`shell frame holds at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    for (const url of ['/', '/library', '/settings/account', '/search?q=x']) {
      await page.goto(url);
      await expect(page.locator('.dock')).toBeVisible();
      const m = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dock: box('.dock'),
          nav: box('.sidebar'),
          visibleNavLinks: [...document.querySelectorAll<HTMLElement>('.sidebar a')].filter(
            (a) => a.offsetParent !== null,
          ).length,
        };
      });
      expect(m.overflowX, url).toBe(0);
      expect(m.dock?.height, url).toBe(88);
      expect(m.dock?.width, url).toBe(vp.width);
      if (url === '/') {
        expect(m.dock?.bottom).toBe(vp.height);
        expect(m.nav).toBeNull();
      } else if (vp.width < 720) {
        // compact: the sidebar is a bottom bar of 4 destinations under the dock
        expect(m.nav?.bottom, url).toBe(vp.height);
        expect(m.nav?.width, url).toBe(vp.width);
        expect(m.visibleNavLinks, url).toBe(4);
        expect(m.dock?.bottom, url).toBe(m.nav?.top);
      } else {
        expect(m.nav?.width, url).toBe(224);
        expect(m.nav?.left, url).toBe(0);
        expect(m.visibleNavLinks, url).toBe(3); // Search is the field here
        expect(m.dock?.bottom, url).toBe(vp.height);
        const field = await mainNav(page).getByRole('searchbox', { name: 'Search' }).boundingBox();
        expect(field?.height, url).toBe(32);
        // inside the sidebar's padding, clear of its 1px rule
        expect((field?.x ?? 0) + (field?.width ?? 0), url).toBeLessThanOrEqual(224 - 16);
      }
    }
  });
}

test('compact search has its own field, since the sidebar one is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/library');
  await mainNav(page).getByRole('link', { name: 'Search' }).click();
  await expect(h1(page)).toHaveText('Search');
  const field = page.getByRole('main').getByRole('searchbox', { name: 'Search' });
  await expect(field).toBeVisible();
  await field.fill('dark');
  await expect(page).toHaveURL(/\/search\?q=dark$/);
});

// Review screenshots: SHOTS=1 pnpm test:e2e --project=chromium shell
test('shell screenshots', async ({ page }, info) => {
  test.skip(!process.env.SHOTS, 'set SHOTS=1 to write shell-shots/');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    for (const [name, url] of [
      ['listen', '/'],
      ['library', '/library'],
      ['settings', '/settings/account'],
    ]) {
      await page.goto(url as string);
      await expect(page.locator('.dock')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `shell-shots/${info.project.name}/${vp.width}x${vp.height}-${name}.png`,
      });
    }
  }
});
