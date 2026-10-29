import { expect, type Page, test } from '@playwright/test';

// viewStore (history sync, deep links) and the frame after Spotify's (DESIGN_SYSTEM.md §2): the top
// bar, Your Library, the page, the right panel and the floating player; on phones the page, the
// mini player and the tab bar.

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
  { url: '/library', heading: 'Your Library', title: 'Your Library', tab: 'Albums' },
  { url: '/library/starred', heading: 'Your Library', title: 'Your Library', tab: 'Liked Songs' },
  { url: '/library/album/al-42', heading: 'Album', title: 'Album' },
  { url: '/collection/tracks', heading: 'Liked Songs', title: 'Liked Songs' },
  // A query nothing in the fixture library matches ("static" became a guide track in M3).
  {
    url: '/search?q=xylophone',
    heading: 'Search',
    title: 'Search',
    text: 'No results for “xylophone”.',
  },
  { url: '/settings', heading: 'Settings', title: 'Settings', tab: 'Preferences' },
  { url: '/settings/account', heading: 'Settings', title: 'Settings', tab: 'Account' },
];

for (const link of DEEP_LINKS) {
  test(`deep link ${link.url} opens its view directly and survives reload`, async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(link.url);
    expect(res?.status()).toBe(200);
    for (let i = 0; i < 2; i++) {
      await expect(h1(page)).toHaveText(link.heading);
      await expect(page).toHaveTitle(`${link.title} · ECHO`);
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(link.url);
      if (link.tab) await expect(page.locator('.tabs [aria-current="page"]')).toHaveText(link.tab);
      if (link.text) await expect(page.getByText(link.text)).toBeVisible();
      await page.reload();
    }
    expect(errors).toEqual([]);
  });
}

test('the root is Home: the top bar, Your Library, the page and the player', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Home · ECHO');
  await expect(h1(page)).toHaveText(/^Good (morning|afternoon|evening)$/);
  await expect(mainNav(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('navigation', { name: 'Your Library' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Player' })).toBeVisible();
});

test('the lyrics view fills the window and its chevron closes it', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('region', { name: 'Player' })
    .getByRole('button', { name: 'Lyrics', exact: true })
    .click();
  await expect(page).toHaveURL(/\/listen$/);
  await expect(page).toHaveTitle('Now playing · ECHO');
  await expect(mainNav(page)).toHaveCount(0);
  const vp = page.viewportSize();
  const stage = await page.locator('.stage').boundingBox();
  expect(stage).toEqual({ x: 0, y: 0, width: vp?.width, height: vp?.height });
  await page.getByRole('button', { name: 'Close Now playing' }).click();
  await expect(page).toHaveURL(/\/$/);
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
  await page.getByRole('main').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
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
  const library = page.getByRole('navigation', { name: 'Your Library' });
  await library.getByRole('link', { name: /^Harbour Lights/ }).click();
  await expect(page).toHaveURL(/\/library\/album\/al-harbour$/);
  await library.getByRole('link', { name: /^Liked Songs/ }).click();
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);

  const expectAt = async (path: RegExp, heading: string | RegExp) => {
    await expect(page).toHaveURL(path);
    await expect(h1(page)).toHaveText(heading);
  };
  await page.goBack();
  await expectAt(/\/settings$/, 'Settings');
  await page.goBack();
  await expectAt(/\/collection\/tracks$/, 'Liked Songs');
  await page.goBack();
  await expectAt(/\/library\/album\/al-harbour$/, 'Harbour Lights');
  await page.goBack();
  await expect(page).toHaveTitle('Home · ECHO');
  await page.goForward();
  await page.goForward();
  await expectAt(/\/collection\/tracks$/, 'Liked Songs');
  // Same document throughout: navigation is client-side.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
});

test('re-selecting the current view adds no history entry', async ({ page }) => {
  await page.goto('/');
  await expect(h1(page)).toBeVisible();
  const before = await page.evaluate(() => history.length);
  await mainNav(page).getByRole('link', { name: 'Home' }).click();
  await mainNav(page).getByRole('link', { name: 'Home' }).click();
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test('links are real hrefs and focus moves to the new heading', async ({ page }) => {
  await page.goto('/library');
  await expect(mainNav(page).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await page.locator('.tabs').getByRole('link', { name: 'Playlists' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/library\/playlists$/);
  await expect(h1(page)).toBeFocused();
});

test('`/` focuses the search pill, which opens Search; typing is one history entry', async ({
  page,
}) => {
  await page.goto('/library');
  await expect(h1(page)).toHaveText('Your Library'); // the shortcut exists once the frame has rendered
  await page.locator('body').press('/');
  const field = mainNav(page).getByRole('searchbox', { name: 'Search' });
  await expect(field).toBeFocused();
  await expect(page).toHaveURL(/\/search$/);
  await field.pressSequentially('night');
  await expect(page).toHaveURL(/\/search\?q=night$/);
  await expect(field).toBeFocused();
  await expect(page.getByText('No results for “night”.')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect(field).toHaveValue('');
});

// DESIGN_SYSTEM.md §5: cards at least --tile-min (180px) fill the row; their covers line up with
// the page's gutters (24px), the cards' own 12px padding hanging into them.
for (const width of [1024, 1440, 2560]) {
  test(`album grid arithmetic at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/library');
    await expect(h1(page)).toHaveText('Your Library'); // React renders after load; wait for it
    const r = await page.evaluate(() => {
      const grid = document.querySelector('.album-grid') as HTMLElement;
      const canvas = document.querySelector('.canvas') as HTMLElement;
      const tiles = [...grid.children].map((li) => li.getBoundingClientRect());
      const top = tiles[0]?.top;
      const row = tiles.filter((t) => t.top === top);
      const box = canvas.getBoundingClientRect();
      return {
        canvasLeft: box.left,
        canvasRight: box.left + canvas.clientWidth,
        columns: row.length,
        gridWidth: grid.getBoundingClientRect().width,
        first: row[0]?.left ?? 0,
        last: row.at(-1)?.right ?? 0,
        tile: row[0]?.width ?? 0,
        count: tiles.length,
      };
    });
    expect(r.tile).toBeGreaterThanOrEqual(180);
    expect(r.columns).toBe(Math.min(r.count, Math.floor(r.gridWidth / 180)));
    expect(r.first - r.canvasLeft).toBeCloseTo(12, 0);
    if (r.count > r.columns) expect(r.canvasRight - r.last).toBeCloseTo(12, 0);
  });
}

for (const vp of VIEWPORTS) {
  test(`frame holds at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    for (const url of ['/', '/library', '/settings/account', '/search?q=x']) {
      await page.goto(url);
      await expect(h1(page)).toBeAttached();
      const m = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector<HTMLElement>(sel);
          // Fixed boxes (the tab bar, the phone's mini player) have no offsetParent: ask display.
          return el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null;
        };
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dock: box('.dock'),
          canvas: box('.canvas'),
          topbar: box('.topbar'),
          library: box('.library-panel'),
          tabbar: box('.tabbar'),
          tabs: document.querySelectorAll('.tabbar a').length,
        };
      });
      expect(m.overflowX, url).toBe(0);
      if (vp.width < 720) {
        // Phones: no top bar or panels; the glass tab bar of 3 at the bottom, no mini player
        // while nothing has played.
        expect(m.topbar, url).toBeNull();
        expect(m.library, url).toBeNull();
        expect(m.tabs, url).toBe(3);
        expect(m.tabbar?.bottom, url).toBe(vp.height - 8);
        expect(m.dock, url).toBeNull();
      } else {
        expect(m.topbar?.height, url).toBe(64);
        expect(m.library?.left, url).toBe(8);
        expect(m.tabbar, url).toBeNull();
        // The pill floats over the bottom of the page, centred on it.
        expect(m.dock?.height, url).toBe(72);
        expect(m.canvas && m.dock && m.canvas.bottom - m.dock.bottom, url).toBe(16);
        const centre = (b: DOMRect | null) => (b ? b.left + b.width / 2 : 0);
        expect(Math.abs(centre(m.dock) - centre(m.canvas)), url).toBeLessThan(1);
      }
    }
  });
}

test('compact search has its own field in the page', async ({ page }) => {
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
      ['home', '/'],
      ['library', '/library'],
      ['settings', '/settings/account'],
    ]) {
      await page.goto(url as string);
      await expect(h1(page)).toBeAttached();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `shell-shots/${info.project.name}/${vp.width}x${vp.height}-${name}.png`,
      });
    }
  }
});
