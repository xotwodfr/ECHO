import { expect, type Page, test } from '@playwright/test';

// M2 task 3: the dock driven by the FakeProvider on a virtual clock, over the fixture library
// (Chromium and Firefox). page.clock drives the provider's time, so positions are exact.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];
const LOAD_MS = 150; // FakeProvider's simulated load time

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const seek = (page: Page) => dock(page).getByRole('slider', { name: 'Seek' });
const title = (page: Page) => dock(page).locator('.dock-title');

async function start(page: Page, url = '/library') {
  await page.clock.install();
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function playAlbum(page: Page, album: string) {
  const tile = page.locator('.tile', { hasText: album });
  await tile.hover();
  await tile.getByRole('button', { name: `Play ${album}` }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(dock(page).getByRole('button', { name: 'Pause' })).toBeVisible();
}

test('idle: nothing playing, transport disabled and saying why', async ({ page }) => {
  await start(page);
  await expect(title(page)).toHaveText('Nothing playing');
  for (const name of ['Previous', 'Play', 'Next', 'Shuffle', 'Repeat off']) {
    const b = dock(page).getByRole('button', { name, exact: true });
    await expect(b).toBeDisabled();
    await expect(b).toHaveAccessibleDescription('Nothing playing');
  }
  await expect(seek(page)).toHaveAttribute('aria-disabled', 'true');
  // No track is not a zero-length track: dashes, not 0:00, and no "0 seconds of 0 seconds".
  await expect(seek(page)).toHaveAttribute('aria-valuetext', 'No track');
  await expect(dock(page).locator('.scrubber-time')).toHaveText(['—', '—']);
  await expect(dock(page).locator('.scrubber-time').first()).toHaveAttribute('aria-hidden', 'true');
  await dock(page).getByRole('button', { name: 'Queue' }).click();
  await expect(page.getByRole('dialog', { name: 'Queue' })).toContainText('Nothing queued.');
});

test('the library shows the fixture albums', async ({ page }) => {
  await start(page);
  await expect(page.locator('.album-grid .tile')).toHaveCount(7); // with M3's Guide Tones
  await expect(
    page.locator('.tile', { hasText: 'Copper Rain' }).locator('.art-fallback'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Artists' }).click();
  await expect(page.locator('.artist-list li')).toHaveText([
    /Ada Varga\s*1 album/,
    /ECHO Fixtures\s*1 album/,
    /Field Ensemble\s*1 album/,
    /Lowfield\s*2 albums/,
    /Mira Sole\s*1 album/,
    /The Quiet Hours\s*1 album/,
  ]);
  await page.getByRole('link', { name: 'Playlists' }).click();
  await expect(page.getByText('No playlists on this server yet.')).toBeVisible();
});

test('play an album: loading, then time moves on the clock; pause freezes it', async ({ page }) => {
  await start(page);
  const tile = page.locator('.tile', { hasText: 'Harbour Lights' });
  await tile.hover();
  await tile.getByRole('button', { name: 'Play Harbour Lights' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'loading');
  await page.clock.runFor(LOAD_MS);
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(title(page)).toHaveText('Ferry at Six');
  await expect(dock(page).locator('.dock-sub')).toHaveText('Lowfield — Harbour Lights');
  await expect(dock(page).locator('.provider-mark')).toHaveText('Fixtures');
  await page.clock.runFor(10_000);
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '10 seconds of 3 minutes 41 seconds');
  await expect(dock(page).locator('.scrubber-time')).toHaveText(['0:10', '3:41']);
  await expect(dock(page).locator('.scrubber-time').first()).not.toHaveAttribute('aria-hidden');
  await dock(page).getByRole('button', { name: 'Pause' }).click();
  await page.clock.runFor(10_000);
  await expect(seek(page)).toHaveAttribute('aria-valuetext', /^10 seconds of/);
  await expect(dock(page).getByRole('button', { name: 'Play' })).toBeVisible();
});

// A11Y-10, re-checked in the dock (it uses the task 2 scrubber).
test('dock scrubber: keyboard seeking with spoken values', async ({ page }) => {
  await start(page);
  await playAlbum(page, 'Harbour Lights');
  await dock(page).getByRole('button', { name: 'Pause' }).click();
  await seek(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '5 seconds of 3 minutes 41 seconds');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '20 seconds of 3 minutes 41 seconds');
  await page.keyboard.press('ArrowLeft');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '15 seconds of 3 minutes 41 seconds');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '0 seconds of 3 minutes 41 seconds');
  await page.keyboard.press('End');
  await expect(seek(page)).toHaveAttribute(
    'aria-valuetext',
    '3 minutes 41 seconds of 3 minutes 41 seconds',
  );
  await page.keyboard.press('Home');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', '0 seconds of 3 minutes 41 seconds');
});

test('a track that reaches its end gives way to the next one', async ({ page }) => {
  await start(page);
  await playAlbum(page, 'Harbour Lights');
  await seek(page).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft'); // 15 s before the end
  await page.clock.runFor(15_000 + LOAD_MS);
  await expect(title(page)).toHaveText('Low Tide Radio');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
});

test('next, previous (restart after 3 s, otherwise back)', async ({ page }) => {
  await start(page);
  await playAlbum(page, 'Harbour Lights');
  await dock(page).getByRole('button', { name: 'Next' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Low Tide Radio');
  await page.clock.runFor(5000);
  await dock(page).getByRole('button', { name: 'Previous' }).click();
  await expect(title(page)).toHaveText('Low Tide Radio');
  await expect(seek(page)).toHaveAttribute('aria-valuetext', /^0 seconds of/);
  await dock(page).getByRole('button', { name: 'Previous' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Ferry at Six');
});

test('repeat one replays at the end; Next still advances', async ({ page }) => {
  await start(page);
  await playAlbum(page, 'Signal / Noise');
  await dock(page).getByRole('button', { name: 'Next' }).click(); // the 8 s Interlude
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Interlude');
  await dock(page).getByRole('button', { name: 'Repeat off' }).click();
  await dock(page).getByRole('button', { name: 'Repeat all' }).click();
  const repeat = dock(page).getByRole('button', { name: 'Repeat one' });
  await expect(repeat).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(8000 + 100);
  await expect(title(page)).toHaveText('Interlude');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await dock(page).getByRole('button', { name: 'Next' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Feedback Loop');
});

test('end of the queue stops on the last track and clears the playing marks', async ({ page }) => {
  await start(page, '/library/album/al-signal');
  await page.getByRole('button', { name: 'Play Clean Signal' }).click();
  await page.clock.runFor(LOAD_MS);
  const row = page.locator('.track-row', { hasText: 'Clean Signal' });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await seek(page).focus();
  await page.keyboard.press('End');
  await page.clock.runFor(100);
  await expect(dock(page)).toHaveAttribute('data-status', 'ended');
  await expect(title(page)).toHaveText('Clean Signal');
  await expect(dock(page).getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(row).not.toHaveAttribute('aria-current');
});

test('album detail: header, row play, shuffle, and queue commands', async ({ page }) => {
  await start(page, '/library/album/al-harbour');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour Lights');
  await expect(page.locator('.detail-facts')).toHaveText('2019 · 6 tracks · 26:01');
  await page.getByRole('button', { name: 'Play Salt on the Window' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Salt on the Window');
  const row = page.locator('.track-row', { hasText: 'Salt on the Window' });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row.locator('.decay-trace')).toHaveCount(1);

  const moorings = page.locator('.track-row', { hasText: 'Moorings' });
  await moorings.getByRole('button', { name: 'More for Moorings' }).click();
  await page.getByRole('menuitem', { name: 'Play next' }).click();
  await expect(page.getByRole('status')).toHaveText('Playing “Moorings” next');

  await dock(page).getByRole('button', { name: 'Queue' }).click();
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  await expect(sheet.getByRole('list', { name: 'Next up' })).toContainText('Moorings');
  await expect(
    sheet.getByRole('list', { name: 'Then, from Harbour Lights' }).locator('li'),
  ).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Play The Long Way Home' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('The Long Way Home');
  await expect(sheet.getByRole('list', { name: 'Next up' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Shuffle', exact: true }).first().click();
  await page.clock.runFor(LOAD_MS);
  await expect(dock(page).getByRole('button', { name: 'Shuffle' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Add to queue' }).click();
  await expect(page.getByRole('status')).toHaveText('Added “Harbour Lights” to the queue');
});

test('search finds fixture tracks and albums and plays a result', async ({ page }) => {
  await start(page, '/search?q=lowfield');
  await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tracks' }).locator('li')).toHaveCount(6);
  await expect(page.locator('.results .tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Play Low Tide Radio' }).click();
  await page.clock.runFor(LOAD_MS);
  await expect(title(page)).toHaveText('Low Tide Radio');
});

test('playback continues across views, onto the Stage', async ({ page }) => {
  await start(page);
  await playAlbum(page, 'Glass Weather');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.clock.runFor(3000);
  await expect(title(page)).toHaveText('Prism');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Listen' })
    .click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await expect(dock(page).locator('.play-btn')).toHaveClass(/play-btn--stage/);
  await dock(page).locator('.dock-sub').getByRole('link', { name: 'Glass Weather' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Glass Weather');
});

test('volume: keys and mute in the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  const v = dock(page).getByRole('slider', { name: 'Volume' });
  await expect(v).toHaveAttribute('aria-valuetext', '100%');
  await v.focus();
  await page.keyboard.press('ArrowDown');
  await expect(v).toHaveAttribute('aria-valuetext', '95%');
  await dock(page).getByRole('button', { name: 'Mute' }).click();
  await expect(v).toHaveAttribute('aria-valuetext', '0%');
  await dock(page).getByRole('button', { name: 'Mute' }).click();
  await expect(v).toHaveAttribute('aria-valuetext', '95%');
});

for (const vp of VIEWPORTS) {
  test(`dock layout while playing at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await start(page);
    await playAlbum(page, 'Copper Rain, Slow Mornings and Other Small Hours of the Year');
    const m = await page.evaluate(() => {
      const d = (document.querySelector('.dock') as HTMLElement).getBoundingClientRect();
      // checkVisibility, not offsetParent: SVG icons have no offsetParent.
      const outside = [...document.querySelectorAll<Element>('.dock *')]
        .filter((el) => el.checkVisibility())
        .filter((el) => {
          // What is painted: the box clipped by overflow-hidden ancestors (truncated text).
          let { left, right, top, bottom } = el.getBoundingClientRect();
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).overflow === 'visible') continue;
            const c = p.getBoundingClientRect();
            left = Math.max(left, c.left);
            right = Math.min(right, c.right);
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
          }
          return (
            left < d.left - 1 || right > d.right + 1 || top < d.top - 1 || bottom > d.bottom + 1
          );
        })
        .map((el) => el.getAttribute('class') ?? el.tagName);
      const visible = (sel: string) =>
        [...document.querySelectorAll<HTMLElement>(sel)].some((el) => el.checkVisibility());
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        height: d.height,
        outside,
        shuffle: visible('.dock .dock-secondary'),
        volumeSlider: visible('.dock .slider--volume'),
        scrubber: visible('.dock .slider--scrubber'),
      };
    });
    expect(m.overflowX).toBe(0);
    expect(m.height).toBe(88);
    expect(m.outside).toEqual([]);
    expect(m.scrubber).toBe(true);
    expect(m.shuffle).toBe(vp.width >= 720);
    expect(m.volumeSlider).toBe(vp.width >= 1280);
    await expect(dock(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Queue' })).toBeVisible();
  });
}

test.describe('task 3 polish', () => {
  test('keyboard transport (PRODUCT_SPEC §7)', async ({ page }) => {
    await start(page);
    await playAlbum(page, 'Harbour Lights');
    // Away from any control, so Space and the arrows are free for shortcuts.
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('Space');
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');
    await page.keyboard.press('ArrowRight');
    await expect(seek(page)).toHaveAttribute('aria-valuetext', /^5 seconds of/);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(seek(page)).toHaveAttribute('aria-valuetext', /^20 seconds of/);
    await page.keyboard.press('ArrowLeft');
    await expect(seek(page)).toHaveAttribute('aria-valuetext', /^15 seconds of/);
    await page.keyboard.press('Space');
    await expect(dock(page)).toHaveAttribute('data-status', 'playing');
    await page.keyboard.press('Control+ArrowRight');
    await page.clock.runFor(LOAD_MS);
    await expect(title(page)).toHaveText('Low Tide Radio');
    await page.keyboard.press('Control+ArrowLeft'); // under 3 s: back a track
    await page.clock.runFor(LOAD_MS);
    await expect(title(page)).toHaveText('Ferry at Six');
    await page.keyboard.press('s');
    await expect(dock(page).getByRole('button', { name: 'Shuffle' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('r');
    await expect(dock(page).getByRole('button', { name: 'Repeat all' })).toBeVisible();
    await page.keyboard.press('m');
    await expect(dock(page).getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '0%',
    );
    await page.keyboard.press('m');
    await expect(dock(page).getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '100%',
    );
    await page.keyboard.press('q');
    await expect(page.getByRole('dialog', { name: 'Queue' })).toBeVisible();
    await page.keyboard.press('q');
    await expect(page.getByRole('dialog', { name: 'Queue' })).toBeHidden();
  });

  test('shortcuts never fire while typing, and ↑/↓ volume only on the Stage', async ({ page }) => {
    await start(page);
    await playAlbum(page, 'Harbour Lights');
    const search = page.getByRole('navigation', { name: 'Main' }).getByRole('searchbox');
    await search.fill('');
    await search.pressSequentially('rs m');
    await expect(page).toHaveURL(/\/search\?q=rs\+m$/);
    await expect(dock(page)).toHaveAttribute('data-status', 'playing');
    await expect(dock(page).getByRole('button', { name: 'Shuffle' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('ArrowDown');
    await expect(dock(page).getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '100%',
    );
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Listen' })
      .click();
    await page.locator('.stage').click({ position: { x: 400, y: 300 } });
    await page.keyboard.press('ArrowDown');
    await expect(dock(page).getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '95%',
    );
  });

  test('queueing with nothing playing cues the first track, ready to play', async ({ page }) => {
    await start(page, '/library/album/al-paper');
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await page.clock.runFor(LOAD_MS);
    await expect(title(page)).toHaveText('Orbit');
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');
    await dock(page).getByRole('button', { name: 'Play' }).click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  });

  test('Next is disabled at the end of the queue and says why', async ({ page }) => {
    await start(page, '/library/album/al-paper');
    await page.getByRole('button', { name: 'Play Re-entry' }).click();
    await page.clock.runFor(LOAD_MS);
    const next = dock(page).getByRole('button', { name: 'Next' });
    await expect(next).toBeDisabled();
    await expect(next).toHaveAccessibleDescription('End of the queue');
    await dock(page).getByRole('button', { name: 'Repeat off' }).click(); // → all: can wrap
    await expect(next).toBeEnabled();
  });

  test("the album's Play button controls the album while it plays", async ({ page }) => {
    await start(page, '/library/album/al-paper');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Play', exact: true }).click();
    await page.clock.runFor(LOAD_MS + 4000);
    await main.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');
    await main.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing');
    await expect(seek(page)).toHaveAttribute('aria-valuetext', /^4 seconds of/); // resumed, not restarted
  });

  test('clicking the Now playing row in the queue never pauses', async ({ page }) => {
    await start(page);
    await playAlbum(page, 'Harbour Lights');
    await dock(page).getByRole('button', { name: 'Queue' }).click();
    const sheet = page.getByRole('dialog', { name: 'Queue' });
    await sheet.getByRole('list', { name: 'Now playing' }).getByRole('button').click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  });
});

test('the queue reorders with Alt+arrows and its menu, removes and clears (QUE-01)', async ({
  page,
}) => {
  await start(page, '/library/album/al-harbour');
  await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
  await page.clock.runFor(LOAD_MS);
  await dock(page).getByRole('button', { name: 'Queue' }).click();
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  const rest = sheet.getByRole('list', { name: 'Then, from Harbour Lights' });
  const order = () => rest.locator('.track-title').allInnerTexts();
  await expect
    .poll(order)
    .toEqual([
      'Low Tide Radio',
      'Salt on the Window',
      'Lighthouse Keeper',
      'Moorings',
      'The Long Way Home',
    ]);

  // Alt+↓ on the focused row moves it down; focus stays with it.
  await rest.getByRole('button', { name: 'Play Low Tide Radio' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect
    .poll(order)
    .toEqual([
      'Salt on the Window',
      'Low Tide Radio',
      'Lighthouse Keeper',
      'Moorings',
      'The Long Way Home',
    ]);
  await expect(rest.getByRole('button', { name: 'Play Low Tide Radio' })).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect
    .poll(order)
    .toEqual([
      'Low Tide Radio',
      'Salt on the Window',
      'Lighthouse Keeper',
      'Moorings',
      'The Long Way Home',
    ]);

  // The ⋯ menu: move down, remove.
  await rest.getByRole('button', { name: 'More for Moorings' }).click();
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect
    .poll(order)
    .toEqual([
      'Low Tide Radio',
      'Salt on the Window',
      'Lighthouse Keeper',
      'The Long Way Home',
      'Moorings',
    ]);
  await rest.getByRole('button', { name: 'More for Salt on the Window' }).click();
  await page.getByRole('menuitem', { name: 'Remove Salt on the Window' }).click();
  await expect
    .poll(order)
    .toEqual(['Low Tide Radio', 'Lighthouse Keeper', 'The Long Way Home', 'Moorings']);

  await sheet.getByRole('button', { name: 'Clear queue' }).click();
  await expect(rest).toHaveCount(0);
  await expect(title(page)).toHaveText('Ferry at Six'); // what plays keeps playing
});
