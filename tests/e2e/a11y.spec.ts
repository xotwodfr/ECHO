import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { playAlbum, signedIn, signedInWithNavidrome } from './helpers.ts';

// M9 task 4: A11Y-01 (keyboard alone), A11Y-02 (visible focus, never under the dock), A11Y-03 (axe:
// 0 serious or critical), A11Y-06 (Motion = Off), A11Y-07 (targets ≥ 24 px, transport ≥ 40 px),
// A11Y-09 (200% zoom at 1440×900, emulated as a 720×450 viewport at device scale 2).

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });

async function serious(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
}

test('A11Y-03: axe finds nothing serious on the shell screens', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for axe');
  test.setTimeout(90_000);
  await signedInWithNavidrome(page, 'ax');
  const screens = [
    '/library',
    '/library/album/al-1',
    '/library/artists',
    '/library/artist/ar-1',
    '/library/playlists',
    '/search?q=harbour',
    '/settings',
    '/settings/account',
  ];
  for (const s of screens) {
    await page.goto(s);
    await page.waitForLoadState('networkidle');
    expect(await serious(page), s).toEqual([]);
  }
  // The Stage with lyrics, and the queue sheet over it.
  await playAlbum(page, 'al-1');
  await expect(page.getByRole('list', { name: 'Lyrics' })).toBeAttached();
  expect(await serious(page), 'listen').toEqual([]);
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
  expect(await serious(page), 'queue').toEqual([]);
});

test('A11Y-03: the Admin screen and the sign-in page', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for axe');
  await signedIn(page, 'axa', 'admin');
  await page.goto('/settings/admin');
  await expect(page.getByRole('heading', { name: 'Users & invites' })).toBeVisible();
  expect(await serious(page), 'admin').toEqual([]);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:18787' });
  const anon = await ctx.newPage();
  await anon.goto('/login');
  await expect(anon.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await serious(anon), 'login').toEqual([]);
  await ctx.close();
});

test('A11Y-01: every §7 function by keyboard alone; nothing fires while typing', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'kb');
  await playAlbum(page, 'al-1');
  const d = dock(page);
  await page.keyboard.press('Space');
  await expect(d).toHaveAttribute('data-status', 'paused');
  await page.keyboard.press('Space');
  await expect(d).toHaveAttribute('data-status', 'playing');
  await page.keyboard.press('Control+ArrowRight');
  await expect(d.locator('.dock-title')).toHaveText('Harbour Lights 2');
  await page.keyboard.press('m');
  await expect(d.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('m');
  await page.keyboard.press('s');
  await expect(d.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('r');
  await expect(d.getByRole('button', { name: 'Repeat all' })).toBeVisible();
  // Stage views.
  const view = page.getByRole('group', { name: 'Stage view' });
  await page.keyboard.press('c'); // Cover has no button (owner, 2026-10-28)
  await expect(page.locator('.stage-cover')).toBeVisible();
  await page.keyboard.press('v');
  await expect(view.getByRole('button', { name: 'Visual' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('l');
  await expect(view.getByRole('button', { name: 'Lyrics' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Queue sheet, opened and closed by keys.
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Queue' })).toBeHidden();
  // The shortcut list.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard' })).toBeVisible();
  await page.keyboard.press('Escape');
  // G-sequences.
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(d.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true'); // 's' did not toggle it
  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page).toHaveURL(/\/library$/);
  // `/` (and Ctrl+K) to search; typing there fires no shortcuts.
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox').first();
  await expect(search).toBeFocused();
  await page.keyboard.type('ms');
  await expect(d.getByRole('slider', { name: 'Volume' })).not.toHaveAttribute('aria-valuenow', '0');
  await expect(d.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true');
});

test('A11Y-02: visible focus on every control, never under the dock', async ({ page }) => {
  await signedInWithNavidrome(page, 'fo');
  await page.goto('/library');
  await expect(page.locator('.tile').first()).toBeVisible();
  const problems: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const dock = document.querySelector('.dock')?.getBoundingClientRect();
      const inDock = !!el.closest('.dock');
      return {
        name: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}`,
        ring: cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) >= 2,
        hidden: !inDock && !!dock && box.top >= dock.top - 1, // scrolled into view, it sits above the dock
      };
    });
    if (!r) continue;
    if (!r.ring) problems.push(`no ring: ${r.name}`);
    if (r.hidden) problems.push(`under the dock: ${r.name}`);
  }
  expect(problems).toEqual([]);
});

test('A11Y-07: targets at least 24 px, transport at least 40 px', async ({ page }) => {
  await signedInWithNavidrome(page, 'ts');
  const small: string[] = [];
  for (const path of ['/library', '/library/album/al-1', '/settings', '/settings/account']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    small.push(
      ...(await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'button, a[href], input, [role="slider"], [role="switch"], select',
        )) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
          // WCAG 2.5.8 exception: a link inside a sentence.
          if (el.tagName === 'A' && el.closest('p')) continue;
          // Visually hidden helpers and hidden inputs.
          if (b.width < 2 || (el as HTMLInputElement).type === 'hidden') continue;
          if (b.width < 24 || b.height < 24)
            out.push(
              `${location.pathname} ${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24)}" ${Math.round(b.width)}×${Math.round(b.height)}`,
            );
        }
        return out;
      })),
    );
  }
  expect(small).toEqual([]);
  for (const name of ['Previous', 'Next']) {
    const b = await dock(page).getByRole('button', { name, exact: true }).boundingBox();
    expect(Math.min(b?.width ?? 0, b?.height ?? 0), name).toBeGreaterThanOrEqual(40);
  }
  const play = await dock(page)
    .locator('.play-btn, [aria-label="Play"], [aria-label="Pause"]')
    .first()
    .boundingBox();
  expect(Math.min(play?.width ?? 0, play?.height ?? 0)).toBeGreaterThanOrEqual(40);
});

test('A11Y-06: Motion = Off — a static lyric sheet and a frozen room while the music plays', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'mo');
  const res = await page.request.put('/api/v1/me/settings', {
    data: { visuals: { motion: 'off' } },
    headers: { origin: 'http://localhost:18787' },
  });
  expect(res.ok()).toBe(true);
  await playAlbum(page, 'al-1');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  const sheet = page.locator('.ly-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[aria-current="true"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.stage')).toHaveAttribute('data-mode', 'still');
  await expect(page.locator('.ly-field .ly-line')).toHaveCount(0); // no moving field
});

test('A11Y-09: at 200% zoom (1440×900) nothing is lost', async ({ browser }) => {
  const ctx = await browser.newContext({
    baseURL: 'http://localhost:18787',
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await signedInWithNavidrome(page, 'zm');
  for (const path of ['/library', '/library/album/al-1', '/settings', '/settings/account']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow, `${path} scrolls sideways`).toBe(false);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  // The functions stay reachable: navigation, the transport, the queue.
  await page.goto('/library/album/al-1');
  await page.locator('.detail-actions').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(dock(page).getByRole('button', { name: 'Queue' })).toBeVisible();
  await ctx.close();
});

// QA 2026-10-28 (WCAG 1.4.11): in forced colours (Windows High Contrast) every state drawn as a fill
// was repainted away: the chosen option, a switch's state, the current tab, the seek track.
test('forced colours: chosen options, switches, the current tab and the seek track stay visible', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'forced-colours emulation is Chromium’s');
  await page.emulateMedia({ forcedColors: 'active' });
  await signedInWithNavidrome(page, 'fc');
  await playAlbum(page, 'al-1');
  await page.goto('/settings/preferences');
  const bg = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const fill = (sel: string, pseudo: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el, p) => getComputedStyle(el, p).backgroundColor, pseudo);
  // A button group: the chosen option differs from the others.
  expect(await bg('.view-switch button[aria-pressed="true"]')).not.toBe(
    await bg('.view-switch button[aria-pressed="false"]'),
  );
  // Switches: on differs from off, and the handle is drawn in both.
  expect(await bg('.toggle[aria-checked="true"]')).not.toBe(
    await bg('.toggle[aria-checked="false"]'),
  );
  expect(await fill('.toggle[aria-checked="false"]', '::after')).not.toBe(
    await bg('.toggle[aria-checked="false"]'),
  );
  // The current tab's indicator, and the dock's seek fill.
  expect(await fill('.tabs a[aria-current="page"]', '::after')).not.toBe('rgba(0, 0, 0, 0)');
  expect(await bg('.dock .slider-fill')).not.toBe(await bg('.dock'));
});
