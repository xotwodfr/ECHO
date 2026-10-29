import { expect, type Page, test } from '@playwright/test';

// M2 task 2: the DESIGN_SYSTEM.md §9 components on /__ui, behaviour and accessibility (Chromium
// and Firefox). Pixel snapshots are in ui.visual.spec.ts (Chromium only).

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
];

async function open(page: Page) {
  await page.goto('/__ui');
  await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
}

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const style = (page: Page, selector: string, prop: string, pseudo?: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, [p, ps]) => getComputedStyle(el, ps ?? null).getPropertyValue(p as string), [
      prop,
      pseudo,
    ] as const);

test('the gallery renders every component section without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page).toHaveTitle('Components · ECHO');
  for (const name of [
    'Buttons',
    'Icon buttons',
    'Transport',
    'Scrubber and volume',
    'Fields, toggles and pills',
    'Track rows',
    'Album tiles',
    'Sheet, menu, dialog and toast',
    'Connection status rows',
    'Sign in',
  ]) {
    await expect(section(page, name)).toBeVisible();
  }
  // The deliberately broken cover falls back to the title square (§8); that 404 is expected.
  expect(errors.filter((e) => !e.includes('404'))).toEqual([]);
});

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await open(page);
    const overflow = await page.evaluate(() => {
      const canvas = document.querySelector('.canvas') as HTMLElement;
      const out = [...canvas.querySelectorAll<HTMLElement>('.ui-section *')]
        .filter((el) => el.getBoundingClientRect().right > canvas.getBoundingClientRect().right + 1)
        .map((el) => el.className || el.tagName);
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canvas: canvas.scrollWidth - canvas.clientWidth,
        out: [...new Set(out)],
      };
    });
    expect(overflow).toEqual({ doc: 0, canvas: 0, out: [] });
  });
}

test.describe('buttons', () => {
  test('disabled buttons say why and cannot be focused or clicked', async ({ page }) => {
    await open(page);
    // `:disabled` (native): the busy button is aria-disabled, which Playwright also counts.
    const btn = section(page, 'Buttons').locator('button:disabled', { hasText: 'Shuffle' });
    await expect(btn).toHaveAccessibleDescription('Connect a server first');
    await expect(btn).toBeDisabled();
    // Disabled is never opacity on the whole (§9.1): the label in --control (M3 outline).
    expect(await btn.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const control = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--control)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(await btn.evaluate((el) => getComputedStyle(el).color)).toBe(control);
  });

  test('loading keeps the name and focus, and ignores activation', async ({ page }) => {
    await open(page);
    const busy = section(page, 'Connection status rows').locator('button[aria-busy="true"]');
    await expect(busy).toHaveAccessibleName('Test');
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await busy.focus();
    await expect(busy).toBeFocused();
    const width = (await busy.boundingBox())?.width;
    expect(width).toBeGreaterThan(40); // the hidden label still sizes it
  });

  test('pinned states match the real ones', async ({ page }) => {
    await open(page);
    const s = section(page, 'Buttons');
    const hover = s.locator('.btn--primary[data-force="hover"]');
    const pinned = await hover.evaluate((el) => getComputedStyle(el).backgroundColor);
    const real = s.locator('.btn--primary:not([data-force]):not(:disabled):not([aria-busy])');
    const rest = await real.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(pinned).not.toBe(rest); // Spotify's brighter green on hover
    await real.hover();
    await expect
      .poll(() => real.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(pinned);
    // Pressed shrinks the pill a little (Spotify's), it never changes shape.
    await expect
      .poll(() =>
        s
          .locator('.btn--primary[data-force="pressed"]')
          .evaluate((el) => getComputedStyle(el).scale),
      )
      .toBe('0.97');
    const focus = s.locator('.btn--primary[data-force="focus"]');
    expect(await focus.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('2px');
  });
});

test.describe('transport', () => {
  test('play/pause switches its name; shuffle and repeat are toggle buttons', async ({ page }) => {
    await open(page);
    const t = section(page, 'Transport').locator('.ui-transport');
    await t.getByRole('button', { name: 'Play' }).click();
    await expect(t.getByRole('button', { name: 'Pause' })).toBeVisible();
    await t.getByRole('button', { name: 'Pause' }).press('Space');
    await expect(t.getByRole('button', { name: 'Play' })).toBeVisible();

    const shuffle = t.getByRole('button', { name: 'Shuffle' });
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    // Not colour alone: a dot appears beneath (§9.2).
    expect(await shuffle.evaluate((el) => getComputedStyle(el, '::after').content)).not.toBe(
      'none',
    );

    await t.getByRole('button', { name: 'Repeat off' }).click();
    await t.getByRole('button', { name: 'Repeat all' }).click();
    await expect(t.getByRole('button', { name: 'Repeat one' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

// A11Y-10: the scrubber is role="slider" with spoken aria-valuetext; arrows, Shift, Home, End.
test.describe('scrubber', () => {
  const scrubber = (page: Page) =>
    section(page, 'Scrubber and volume').getByRole('slider', { name: 'Seek' }).first();

  test('keyboard', async ({ page }) => {
    await open(page);
    const s = scrubber(page);
    await expect(s).toHaveAttribute('aria-valuetext', '1 minute 42 seconds of 4 minutes 5 seconds');
    await s.focus();
    await page.keyboard.press('ArrowRight');
    await expect(s).toHaveAttribute('aria-valuetext', '1 minute 47 seconds of 4 minutes 5 seconds');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(s).toHaveAttribute('aria-valuenow', '122000');
    await page.keyboard.press('ArrowLeft');
    await expect(s).toHaveAttribute('aria-valuenow', '117000');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(s).toHaveAttribute('aria-valuenow', '102000');
    await page.keyboard.press('End');
    await expect(s).toHaveAttribute('aria-valuetext', '4 minutes 5 seconds of 4 minutes 5 seconds');
    await page.keyboard.press('Home');
    await expect(s).toHaveAttribute('aria-valuetext', '0 seconds of 4 minutes 5 seconds');
    await expect(s).toHaveAttribute('aria-valuemin', '0');
    await expect(s).toHaveAttribute('aria-valuemax', '245000');
    await expect(section(page, 'Scrubber and volume').locator('.scrubber-time').first()).toHaveText(
      '0:00',
    );
  });

  test('pointer: down jumps, drag shows the time bubble, release seeks', async ({ page }) => {
    await open(page);
    const s = scrubber(page);
    await s.scrollIntoViewIfNeeded();
    const box = await s.boundingBox();
    if (!box) throw new Error('no scrubber');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    await expect(s.locator('.slider-bubble')).toBeVisible();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 4 });
    await expect(s.locator('.slider-bubble')).toHaveText('2:02');
    await page.mouse.up();
    await expect(s.locator('.slider-bubble')).toHaveCount(0);
    await expect(s).toBeFocused();
    const now = Number(await s.getAttribute('aria-valuenow'));
    expect(Math.abs(now - 122_500)).toBeLessThan(1000);
  });

  test('disabled: not focusable, explains why, ignores keys', async ({ page }) => {
    await open(page);
    const s = section(page, 'Scrubber and volume')
      .getByRole('figure', { name: 'Scrubber · Disabled' })
      .locator('.slider[aria-disabled="true"]');
    await expect(s).toHaveAttribute('tabindex', '-1');
    await expect(s).toHaveAccessibleDescription("This server can't seek in converted audio.");
    await s.focus();
    await page.keyboard.press('ArrowRight');
    await expect(s).toHaveAttribute('aria-valuenow', '102000');
  });

  test('no track: dashes instead of 0:00, says so, not focusable', async ({ page }) => {
    await open(page);
    const cell = section(page, 'Scrubber and volume').getByRole('figure', {
      name: 'Scrubber · No track',
    });
    const s = cell.getByRole('slider', { name: 'Seek' });
    await expect(s).toHaveAttribute('aria-valuetext', 'No track');
    await expect(s).toHaveAttribute('tabindex', '-1');
    await expect(s).toHaveAccessibleDescription('Nothing playing');
    await expect(cell.locator('.scrubber-time')).toHaveText(['—', '—']);
  });
});

test.describe('volume', () => {
  test('keys, wheel, and mute back to the previous value', async ({ page }) => {
    await open(page);
    const cell = section(page, 'Scrubber and volume').locator('.ui-cell', {
      hasText: 'Volume · Interactive',
    });
    const v = cell.getByRole('slider', { name: 'Volume' });
    await expect(v).toHaveAttribute('aria-valuetext', '60%');
    await v.focus();
    await page.keyboard.press('ArrowUp');
    await expect(v).toHaveAttribute('aria-valuetext', '65%');
    await v.hover();
    await page.mouse.wheel(0, -100);
    await expect(v).toHaveAttribute('aria-valuetext', '70%');
    const mute = cell.getByRole('button', { name: 'Mute' });
    await mute.click();
    await expect(v).toHaveAttribute('aria-valuetext', '0%');
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    // Mute is not a shuffle-style accent toggle: the accent is reserved for what is playing.
    expect(await mute.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(227, 178, 107)');
    await mute.click();
    await expect(v).toHaveAttribute('aria-valuetext', '70%');
  });
});

test.describe('fields and toggles', () => {
  test('labels, errors and hints are associated', async ({ page }) => {
    await open(page);
    const s = section(page, 'Fields, toggles and pills');
    const err = s.locator('.field[data-invalid] input');
    await expect(err).toHaveAttribute('aria-invalid', 'true');
    await expect(err).toHaveAccessibleName('Server URL');
    await expect(err).toHaveAccessibleDescription('Use an https:// address.');
    await expect(s.getByLabel('Server URL').nth(1)).toHaveAccessibleDescription(
      "The address ECHO's server uses.",
    );
    await expect(s.getByLabel('Username').last()).toBeDisabled();
  });

  test('a secret field is masked and can be revealed', async ({ page }) => {
    await open(page);
    const s = section(page, 'Fields, toggles and pills');
    const pw = s.getByLabel('Password', { exact: true });
    await expect(pw).toHaveAttribute('type', 'password');
    await s.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await s.getByRole('button', { name: 'Hide password' }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('toggle is a switch: click, label click and Space', async ({ page }) => {
    await open(page);
    const s = section(page, 'Fields, toggles and pills');
    const sw = s.getByRole('switch', { name: 'Film grain' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await s.getByText('Film grain').click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    const off = s.getByRole('switch', { name: 'Crossfade' });
    await expect(off).toBeDisabled();
    await expect(off).toHaveAccessibleDescription('Navidrome only');
  });
});

test.describe('menu', () => {
  test('keyboard: open on Enter, arrows skip disabled items, Esc returns focus', async ({
    page,
  }) => {
    await open(page);
    const trigger = section(page, 'Icon buttons').getByRole('button', {
      name: 'More for Night Turns Over',
    });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'More for Night Turns Over' });
    await expect(menu.getByRole('menuitem', { name: 'Play next' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Add to queue' })).toBeFocused();
    await page.keyboard.press('ArrowDown'); // skips the disabled "Go to album"
    await expect(menu.getByRole('menuitem', { name: 'Remove from queue' })).toBeFocused();
    await page.keyboard.press('ArrowDown'); // wraps
    await expect(menu.getByRole('menuitem', { name: 'Play next' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Remove from queue' })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'Go to album' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('choosing an item closes the menu and acts; outside clicks close it', async ({ page }) => {
    await open(page);
    const trigger = section(page, 'Icon buttons').getByRole('button', {
      name: 'More for Night Turns Over',
    });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Add to queue' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('Added to queue');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('heading', { name: 'Components' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test('menu: opens upward when the canvas has no room below, and stays inside it', async ({
  page,
}) => {
  await open(page);
  const trigger = section(page, 'Sheet, menu, dialog and toast').getByRole('button', {
    name: 'More for Undertow',
  });
  // Put the trigger on the bottom edge of the canvas, just above the dock.
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toHaveAttribute('data-placement', 'top');
  const box = await menu.boundingBox();
  const canvas = await page.locator('.canvas').boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
    (canvas?.y ?? 0) + (canvas?.height ?? 0),
  );
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(canvas?.y ?? 0);
  // With room below it opens downward. (A dispatched click: over the canvas Playwright's Firefox
  // scrolls the trigger back down before a real one, though it is visible and hit-testable there.)
  await page.keyboard.press('Escape');
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await trigger.dispatchEvent('click');
  await expect(menu).toHaveAttribute('data-placement', 'bottom');
});

test.describe('sheet and dialog', () => {
  test('sheet: focus moves in, Esc closes and returns focus', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: 'Open queue' });
    await opener.click();
    const sheet = page.getByRole('dialog', { name: 'Queue' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('sheet: the background is inert and a backdrop click closes', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Open queue' }).click();
    const sheet = page.getByRole('dialog', { name: 'Queue' });
    await expect(sheet).toBeVisible();
    // Focus never reaches page content behind a modal sheet. (Chromium may hand Tab to the
    // browser's own UI after the last control; the document then reports <body>.)
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const where = await sheet.evaluate((el) =>
        el.contains(document.activeElement) ? 'sheet' : document.activeElement?.tagName,
      );
      expect(['sheet', 'BODY']).toContain(where);
    }
    await page.mouse.click(40, 300);
    await expect(sheet).toBeHidden();
  });

  test('dialog: names the object, starts on Cancel, Esc cancels', async ({ page }) => {
    await open(page);
    const opener = section(page, 'Sheet, menu, dialog and toast').getByRole('button', {
      name: 'Disconnect',
    });
    await opener.click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Disconnect Navidrome (music.home.lan)?',
    });
    await expect(dialog).toHaveAccessibleDescription(/forgets your Navidrome password/);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByRole('status')).toHaveText('');
  });

  test('dialog: confirming acts once and reports with a toast', async ({ page }) => {
    await open(page);
    await section(page, 'Sheet, menu, dialog and toast')
      .getByRole('button', { name: 'Disconnect' })
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(page.getByRole('status')).toHaveText('Navidrome disconnected');
  });
});

test('toast: one at a time, gone after 4 s', async ({ page }) => {
  await page.clock.install();
  await open(page);
  const show = page.getByRole('button', { name: 'Show toast' });
  await show.click();
  const status = page.getByRole('status');
  await expect(status).toHaveText('Lyrics −100 ms');
  await page.getByRole('button', { name: 'Open queue' }).click();
  await page.keyboard.press('Escape');
  await show.click();
  await expect(status.locator('.toast')).toHaveCount(1);
  await page.clock.runFor(3900);
  await expect(status).toHaveText('Lyrics −100 ms');
  await page.clock.runFor(500);
  await expect(status).toHaveText('');
});

test.describe('track rows and tiles', () => {
  test('rows are play targets with names; now playing is marked beyond colour', async ({
    page,
  }) => {
    await open(page);
    const s = section(page, 'Track rows');
    await expect(s.getByRole('button', { name: 'Play Into the Dark' })).toBeVisible();
    const np = s.locator('li[aria-current="true"]');
    await expect(np).toContainText('Night Turns Over');
    await expect(np).toContainText('Now playing');
    // Now playing takes the M3 primary (DESIGN_SYSTEM.md §0), which the album's colour seeds.
    const [title, primary] = await np.locator('.track-title').evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--md-sys-color-primary)';
      el.append(probe);
      const out = [getComputedStyle(el).color, getComputedStyle(probe).color];
      probe.remove();
      return out;
    });
    expect(title).toBe(primary);
    await expect(np.locator('.np-bars')).toBeVisible();
    // The decay trace is visible mid-song (60 s into 301 s).
    const trace = s.locator('.decay-trace');
    await expect(trace).toHaveCount(1);
    expect(Number(await trace.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
  });

  test('keyboard focus on a row outlines the whole row', async ({ page }) => {
    await open(page);
    const row = section(page, 'Track rows').locator('li', { hasText: 'Into the Dark' });
    await row.getByRole('button', { name: 'Play Into the Dark' }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  });

  test('reduced motion stops the now-playing bars', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    expect(await style(page, '.np-bars span', 'animation-name')).toBe('none');
  });

  test('album tile: link to the album, play button on focus, art never cropped', async ({
    page,
  }) => {
    await open(page);
    const s = section(page, 'Album tiles');
    const tile = s.locator('li.tile', { hasText: 'Tide Lines' });
    await expect(tile.getByRole('link')).toHaveAttribute('href', '/library/album/al-1');
    const play = tile.getByRole('button', { name: 'Play Tide Lines' });
    expect(await play.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await play.focus();
    await expect(play).toBeFocused();
    await expect.poll(() => play.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    // Spotify's green play button rises onto the cover's corner (DESIGN_SYSTEM.md §8).
    const art = await tile.locator('.art').boundingBox();
    await expect
      .poll(async () => {
        const btn = await play.boundingBox();
        return (
          (btn?.y ?? 0) + (btn?.height ?? 0) <= (art?.y ?? 0) + (art?.height ?? 0) &&
          (btn?.x ?? 0) + (btn?.width ?? 0) <= (art?.x ?? 0) + (art?.width ?? 0)
        );
      })
      .toBe(true);
    expect(await style(page, '.tile .art img', 'object-fit')).toBe('cover');
    expect(await style(page, '.tile .art', 'border-radius')).toBe('8px'); // a card's cover (M3 small)
    expect(await style(page, '.track-row .art', 'border-radius')).toBe('4px'); // a row's
    await play.click();
    await expect(page.getByRole('status')).toHaveText('Playing Tide Lines');
  });

  test('missing and broken covers fall back to the title square', async ({ page }) => {
    await open(page);
    const s = section(page, 'Album tiles');
    // Covers load lazily: the broken one only errors once it is scrolled into view.
    await s.scrollIntoViewIfNeeded();
    await expect(s.locator('li', { hasText: 'No Cover' }).locator('.art-fallback')).toHaveAttribute(
      'data-title',
      'Field Recordings, Volume Two',
    );
    await expect(
      s.locator('li', { hasText: 'Missing File' }).locator('.art-fallback'),
    ).toBeVisible();
    await expect(s.locator('li', { hasText: 'Missing File' }).locator('img')).toHaveCount(0);
  });
});

test.describe('connection rows and sign-in', () => {
  test('connection rows are labelled regions with text statuses', async ({ page }) => {
    await open(page);
    const s = section(page, 'Connection status rows');
    const nav = s.getByRole('region', { name: 'Navidrome' }).first();
    await expect(nav.locator('.pill')).toHaveText('Connected');
    await expect(nav.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await expect(s.getByRole('region', { name: 'Spotify' }).first().locator('.pill')).toHaveText(
      'Sign-in expired',
    );
  });

  test('sign-in: busy, then a generic error announced as an alert', async ({ page }) => {
    await open(page);
    const form = section(page, 'Sign in').getByRole('form').first();
    await expect(form).toHaveAccessibleName('Sign in');
    await form.getByLabel('Username').fill('someone');
    await form.getByLabel('Password', { exact: true }).fill('not the password');
    await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await form.getByRole('button', { name: 'Sign in' }).click();
    await expect(form.getByRole('button', { name: 'Sign in' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(form.getByRole('alert')).toHaveText('Username or password is incorrect.');
    await expect(form.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy');
  });

  test('sign-in: the TOTP step asks for a one-time code', async ({ page }) => {
    await open(page);
    const code = section(page, 'Sign in').getByLabel('Code', { exact: true });
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAccessibleDescription('The 6-digit code from your authenticator app.');
  });
});
