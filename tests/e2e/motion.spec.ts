import { expect, type Page, test } from '@playwright/test';
import { signedIn, signedInWithNavidrome } from './helpers.ts';

// Springy motion (docs/superpowers/specs/2026-11-02-spring-motion-design.md): everything that
// appears, leaves, moves or changes animates; how much is <html data-motion>.

const motion = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion);

async function setMotion(page: Page, name: 'System' | 'Full' | 'Reduced' | 'Off') {
  await page.goto('/settings');
  await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name }).click();
}

test('Settings → Motion → Full wins over a reduce-motion device', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedIn(page, 'motion');
  await page.goto('/settings');
  await expect.poll(() => motion(page)).toBe('less');
  await setMotion(page, 'Full');
  await expect.poll(() => motion(page)).toBe('full');
  await setMotion(page, 'Off');
  await expect.poll(() => motion(page)).toBe('off');
});

// ---- Exits: menus, dialogs and sheets stay until their exit has played (on /__ui) ----

async function gallery(page: Page) {
  await page.goto('/__ui');
  await expect(page.getByRole('heading', { level: 1, name: 'Components' })).toBeVisible();
}
const overlays = (page: Page) =>
  page.getByRole('region', { name: 'Sheet, menu, dialog and toast', exact: true });
/** Until an element's own entrance has played (closing mid-entrance turns it back at once). */
const settled = (page: Page, selector: string) =>
  expect.poll(() => page.locator(selector).evaluate((el) => el.getAnimations().length)).toBe(0);
const undertow = (page: Page) => overlays(page).getByRole('button', { name: 'More for Undertow' });

test('a menu animates out before it unmounts', async ({ page }) => {
  await gallery(page);
  await undertow(page).click();
  await expect(page.locator('.menu')).toHaveCount(1);
  await settled(page, '.menu');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu[data-leaving]')).toHaveCount(1);
  await expect(page.locator('.menu')).toHaveCount(0);
  await expect(undertow(page)).toBeFocused();
});

test('reopening a closing menu keeps the same menu open', async ({ page }) => {
  await gallery(page);
  await undertow(page).click();
  await page.locator('.menu').evaluate((m) => {
    (m as HTMLElement).dataset.tag = 'first';
  });
  // Escape refocuses the trigger; Enter on it opens the menu again while it is still leaving.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await expect(page.locator('.menu[data-tag="first"]:not([data-leaving])')).toHaveCount(1);
});

test('a dialog closes with its exit, by Cancel and by Esc', async ({ page }) => {
  await gallery(page);
  const trigger = overlays(page).getByRole('button', { name: 'Disconnect', exact: true });
  for (const close of [
    () => page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click(),
    () => page.keyboard.press('Escape'),
  ]) {
    await trigger.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await settled(page, 'dialog.dialog[open]');
    await close();
    await expect(page.locator('dialog.dialog[open][data-leaving]')).toHaveCount(1);
    await expect(page.locator('dialog.dialog[open]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('a sheet closes with its exit, by its close button and the backdrop', async ({ page }) => {
  await gallery(page);
  const trigger = overlays(page).getByRole('button', { name: 'Open queue' });
  for (const close of [
    () => page.locator('dialog.sheet').getByRole('button', { name: 'Close' }).click(),
    () => page.mouse.click(10, 10), // the backdrop: the sheet sits at the trailing edge
  ]) {
    await trigger.click();
    await expect(page.locator('dialog.sheet[open]')).toBeVisible();
    await settled(page, 'dialog.sheet[open]');
    await close();
    // The sheet holds a now-playing row whose bars loop forever: the exit must not wait on them.
    await expect(page.locator('dialog.sheet[open][data-leaving]')).toHaveCount(1);
    await expect(page.locator('dialog.sheet[open]')).toHaveCount(0, { timeout: 1000 });
    await expect(trigger).toBeFocused();
  }
});

test('with Motion Off, a menu closes without an exit animation', async ({ page }) => {
  await gallery(page);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'off';
  });
  await undertow(page).click();
  await page.keyboard.press('Escape');
  const running = await page.evaluate(
    () => document.querySelector('.menu')?.getAnimations().length ?? 0,
  );
  expect(running).toBe(0);
  await expect(page.locator('.menu')).toHaveCount(0);
});

// ---- The right panel: it slides, and the page beside it follows (fixture library, 1600px) ----

test.describe('the right panel', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
  const queueButton = (page: Page) => dock(page).getByRole('button', { name: 'Queue' });
  /** The page's width every frame for 700 ms, from now. */
  const widths = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<number[]>((done) => {
          const out: number[] = [];
          const canvas = document.querySelector('.canvas') as HTMLElement;
          const t0 = performance.now();
          const tick = () => {
            out.push(Math.round(canvas.getBoundingClientRect().width));
            if (performance.now() - t0 < 700) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        }),
    );
  const between = (w: number[], a: number, b: number) =>
    new Set(w.filter((x) => x > Math.min(a, b) && x < Math.max(a, b))).size;

  /** Wide windows open Now playing by default: start from a closed panel. */
  async function closedPanel(page: Page) {
    await page.goto('/library');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const hide = page.locator('.right-panel').getByRole('button', { name: /^Hide / });
    if (await hide.count()) await hide.click();
    await expect(page.locator('.right-panel')).toHaveCount(0);
  }

  test('opens and closes with the middle area following', async ({ page }) => {
    await closedPanel(page);
    const sampling = widths(page);
    await queueButton(page).click();
    const opening = await sampling;
    const closed = opening[0] ?? 0;
    const open = opening.at(-1) ?? closed;
    expect(open).toBeLessThan(closed - 200);
    expect(between(opening, closed, open)).toBeGreaterThanOrEqual(3);

    const closing = widths(page);
    await queueButton(page).click();
    await expect(page.locator('.right-panel[data-leaving]')).toHaveCount(1);
    const back = await closing;
    expect(between(back, closed, open)).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.right-panel')).toHaveCount(0);
    expect(back.at(-1)).toBe(closed);
  });

  test('switching Queue to Now playing crossfades the pane', async ({ page }) => {
    await page.goto('/library');
    await queueButton(page).click();
    await expect(page.getByRole('complementary', { name: 'Queue' })).toBeVisible();
    await page.waitForTimeout(700);
    await dock(page).getByRole('button', { name: 'Now playing view' }).click();
    const running = await page
      .locator('.right-panel > *')
      .first()
      .evaluate((el) => el.getAnimations().length);
    expect(running).toBeGreaterThan(0);
  });

  test('reopening the panel while it closes keeps it', async ({ page }) => {
    await page.goto('/library');
    await queueButton(page).click();
    await page.waitForTimeout(700);
    await queueButton(page).click();
    await queueButton(page).click();
    await page.waitForTimeout(800);
    await expect(page.locator('.right-panel:not([data-leaving])')).toHaveCount(1);
  });
});

// ---- Page changes: a card's cover flies into the page's header, and back into its card ----

test('Back flies the header cover into its card', async ({ page }) => {
  // What is named "cover" in the new page, each time a page change runs.
  await page.addInitScript(() => {
    const w = window as unknown as { covers: string[][] };
    w.covers = [];
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((update: () => unknown) =>
      start(async () => {
        await update();
        w.covers.push(
          [...document.querySelectorAll<HTMLElement>('.art')]
            .filter(
              (e) =>
                e.style.viewTransitionName === 'cover' ||
                getComputedStyle(e).viewTransitionName === 'cover',
            )
            .map((e) =>
              e.closest('.tile') ? 'card' : e.closest('.page-head') ? 'header' : 'other',
            ),
        );
      })) as typeof document.startViewTransition;
  });
  await page.goto('/library');
  test.skip(!(await page.evaluate(() => 'startViewTransition' in document)), 'no View Transitions');
  await page.locator('.tile', { hasText: 'Harbour Lights' }).locator('.tile-link').click();
  await expect(page.locator('.page-head')).toContainText('Harbour Lights');
  await page.waitForTimeout(800);
  await page.goBack();
  await expect(page.locator('.tile', { hasText: 'Harbour Lights' })).toBeVisible();
  const covers = await page.evaluate(() => (window as unknown as { covers: string[][] }).covers);
  expect(covers[0]).toEqual(['header']);
  expect(covers.at(-1)).toEqual(['card']);
});

// ---- Queue changes: rows slide to their new places, arrive and leave (fixture library) ----

test.describe('queue changes', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Queue' });
  const rest = (page: Page) => panel(page).getByRole('list', { name: 'Then, from Harbour Lights' });
  const running = (el: Element) => el.getAnimations().length;
  async function playHarbour(page: Page) {
    await page.goto('/library/album/al-harbour');
    await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Queue' })
      .click();
    await expect(rest(page).locator('li')).toHaveCount(5);
    await page.waitForTimeout(700); // the panel has settled
  }
  async function playNext(page: Page, title: string) {
    await page
      .locator('.canvas .track-row', { hasText: title })
      .getByRole('button', { name: `More for ${title}` })
      .click();
    await page.getByRole('menuitem', { name: 'Play next' }).click();
  }

  test('rows arrive, leave and slide', async ({ page }) => {
    await playHarbour(page);
    await playNext(page, 'Moorings');
    const fresh = panel(page).locator('.track-row.fresh');
    await expect(fresh).toHaveCount(1);
    expect(await fresh.evaluate(running)).toBeGreaterThan(0);

    await rest(page).getByRole('button', { name: 'More for Salt on the Window' }).click();
    await page.getByRole('menuitem', { name: 'Remove Salt on the Window' }).click();
    await expect(panel(page).locator('.flip-ghost')).toHaveCount(1);
    await expect(panel(page).locator('.flip-ghost')).toHaveCount(0, { timeout: 1000 });

    await rest(page).getByRole('button', { name: 'Play Low Tide Radio' }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    // The move lands a moment later (the queue's own update); the row then glides.
    const moved = rest(page).locator('.track-row', { hasText: 'Low Tide Radio' });
    await expect.poll(() => moved.evaluate(running), { intervals: [20] }).toBeGreaterThan(0);
    await expect(rest(page).getByRole('button', { name: 'Play Low Tide Radio' })).toBeFocused();
  });

  test('two Play next in a row end in order, with no ghosts left', async ({ page }) => {
    await playHarbour(page);
    await playNext(page, 'Moorings');
    await playNext(page, 'Lighthouse Keeper');
    const next = panel(page).getByRole('list', { name: 'Next up' });
    await expect
      .poll(() => next.locator('.track-title').allInnerTexts())
      .toEqual(['Lighthouse Keeper', 'Moorings']);
    await page.waitForTimeout(1000);
    await expect(panel(page).locator('.flip-ghost')).toHaveCount(0);
  });
});

// ---- Presses, play/pause and the heart ----

test('presses spring', async ({ page }) => {
  await gallery(page);
  for (const selector of ['.btn', '.icon-btn', '.play-btn']) {
    const transition = await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).transition);
    expect(transition, selector).toMatch(/scale [\d.]+s linear\(/);
  }
});

test('the heart pops when liked, and not when the page loads', async ({ page }) => {
  await signedInWithNavidrome(page, 'pop');
  await page.goto('/library/album/al-3');
  const row = page.locator('.track-row', { hasText: 'Glass Weather 4' });
  const like = row.getByRole('button', { name: 'Add Glass Weather 4 to Liked Songs' });
  const liked = row.getByRole('button', { name: 'Remove Glass Weather 4 from Liked Songs' });
  try {
    await row.hover();
    await like.click();
    await expect(liked).toHaveAttribute('data-pop', 'in');
    expect(
      await liked.evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBeGreaterThan(0);
    await expect(liked).not.toHaveAttribute('data-pop'); // gone once the pop has played

    await page.reload();
    await expect(liked).toBeAttached();
    expect(await liked.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  } finally {
    // The mock's Liked Songs is shared: leave it as it was.
    if (await liked.count()) await liked.click();
  }
});

test('play and pause morph; with less motion they only fade', async ({ page }) => {
  await page.goto('/library/album/al-harbour');
  await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
  const play = page.getByRole('region', { name: 'Player' }).locator('.play-btn');
  await expect(play).toHaveAttribute('data-playing', 'true');
  await page.waitForTimeout(700);
  const moving = () =>
    play.evaluate((b) =>
      b.getAnimations({ subtree: true }).map((a) => (a as CSSTransition).transitionProperty),
    );
  await play.click();
  expect(await moving()).toEqual(expect.arrayContaining(['scale', 'rotate'])); // the fade may be done
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'less';
  });
  await expect.poll(async () => (await moving()).length).toBe(0); // the last change has settled
  await play.click();
  expect(new Set(await moving())).toEqual(new Set(['opacity']));
});

// ---- Loaded content arrives in a wave; a page brought back as it was does not ----

test('tiles arrive in a wave after loading, and Back shows the page as it was', async ({
  page,
}) => {
  await signedInWithNavidrome(page, 'wave');
  await page.route('**/navidrome/rest/getAlbumList2*', async (route) => {
    await new Promise((done) => setTimeout(done, 800));
    await route.continue();
  });
  await page.goto('/library');
  await expect(page.locator('.tile--loading').first()).toBeVisible();
  const grid = page.locator('.album-grid[data-arrive]');
  await expect(grid).toHaveCount(1);
  const delays = await grid
    .locator(':scope > .tile')
    .evaluateAll((tiles) => tiles.slice(0, 3).map((t) => getComputedStyle(t).animationDelay));
  expect(Number.parseFloat(delays[0] ?? '')).toBe(0);
  expect(Number.parseFloat(delays[2] ?? '')).toBeGreaterThan(0);
  await expect(page.locator('.album-grid[data-arrive]')).toHaveCount(0, { timeout: 2000 });

  await page.locator('.album-grid .tile .tile-link').first().click();
  await expect(page.locator('.page-head')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.album-grid .tile').first()).toBeVisible();
  await expect(page.locator('[data-arrive]')).toHaveCount(0);
});

// ---- The lyrics view grows out of the player's cover and shrinks back into it ----

test.describe('the lyrics view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const player = (page: Page) => page.getByRole('region', { name: 'Player' });
  const ghosts = (page: Page) => page.locator('.motion-ghost');
  async function playing(page: Page) {
    await page.goto('/library/album/al-harbour');
    await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
    await expect(player(page)).toHaveAttribute('data-status', 'playing');
  }
  /** What started animating since `record`: each element's class and its animated properties. */
  const record = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { moved: string[] };
      w.moved = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        const props = Object.keys((Array.isArray(frames) ? frames[0] : frames) ?? {});
        w.moved.push(`${this.className} ${props.join(',')}`);
        return animate.call(this, frames, options);
      };
    });
  const moved = (page: Page) =>
    page.evaluate(() => (window as unknown as { moved: string[] }).moved);
  /** Nothing of a ghost takes a click: the page under it is live at once. */
  const hitsGhost = (page: Page) =>
    page.evaluate(
      () => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.motion-ghost'),
    );

  test('grows out of the player and shrinks back into it', async ({ page }) => {
    await playing(page);
    await record(page);
    await player(page).getByRole('button', { name: 'Lyrics', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close Now playing' })).toBeVisible();
    // The view's clip grows from the cover, a cover flies, the page behind sinks back.
    expect(await moved(page)).toEqual(
      expect.arrayContaining(['canvas clipPath', 'motion-fly transform']),
    );
    await expect(ghosts(page)).toHaveCount(0, { timeout: 3000 });

    await page.mouse.move(600, 300); // the chrome hides while playing: bring it back
    await page.getByRole('button', { name: 'Close Now playing' }).click();
    await expect(ghosts(page)).not.toHaveCount(0);
    expect(await hitsGhost(page)).toBe(false);
    await expect(ghosts(page)).toHaveCount(0, { timeout: 3000 });
  });

  test('with less motion it simply changes', async ({ page }) => {
    await playing(page);
    await page.evaluate(() => {
      document.documentElement.dataset.motion = 'less';
    });
    await player(page).getByRole('button', { name: 'Lyrics', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close Now playing' })).toBeVisible();
    expect(await ghosts(page).count()).toBe(0);
  });
});

// ---- Toasts, switches and the player's cover ----

test('a toast springs up', async ({ page }) => {
  await gallery(page);
  await overlays(page).getByRole('button', { name: 'Show toast' }).click();
  const moving = await page
    .locator('.toast')
    .evaluate((t) => t.getAnimations().map((a) => (a as CSSTransition).transitionProperty));
  expect(moving).toEqual(expect.arrayContaining(['translate']));
});

test('a switch’s selection slides to the new choice', async ({ page }) => {
  await signedIn(page, 'slide');
  await page.goto('/settings');
  const intensity = page.getByRole('group', { name: 'Reverb intensity' });
  await page.waitForTimeout(700);
  await intensity.getByRole('button', { name: 'Subtle' }).click();
  const sliding = await intensity
    .getByRole('button', { name: 'Subtle' })
    .evaluate(
      (b) =>
        b.getAnimations({ subtree: true }).filter((a) => (a.effect as KeyframeEffect).pseudoElement)
          .length,
    );
  expect(sliding).toBeGreaterThan(0);
});

test('the player’s cover springs in on a new song', async ({ page }) => {
  await page.goto('/library/album/al-harbour');
  await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
  const player = page.getByRole('region', { name: 'Player' });
  await expect(player).toHaveAttribute('data-status', 'playing');
  await page.waitForTimeout(700);
  await player.getByRole('button', { name: 'Next', exact: true }).click();
  await expect
    .poll(
      () =>
        player
          .locator('.art')
          .first()
          .evaluate((a) => a.getAnimations().length),
      {
        intervals: [20],
      },
    )
    .toBeGreaterThan(0);
});

test('block states and notices spring in', async ({ page }) => {
  await gallery(page);
  for (const name of ['block-error', 'block-empty', 'notice', 'home-reconnect']) {
    const transition = await page.evaluate((n) => {
      const el = document.createElement('div');
      el.className = n;
      document.querySelector('.canvas')?.append(el);
      const t = getComputedStyle(el).transition;
      el.remove();
      return t;
    }, name);
    expect(transition, name).toMatch(/translate [\d.]+s linear\(/);
  }
});

// Review: Esc on a confirmation inside a sheet closes the confirmation, not the sheet with it.
test('Esc on a confirmation inside the queue sheet keeps the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); // below 1400px the queue is a sheet
  await page.goto('/library/album/al-harbour');
  await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
  await page.getByRole('region', { name: 'Player' }).getByRole('button', { name: 'Queue' }).click();
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  await expect(sheet).toBeVisible();
  await settled(page, 'dialog.sheet[open]');
  await sheet.getByRole('button', { name: 'Clear queue' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Clear the queue?' })).toBeVisible();
  await settled(page, 'dialog.dialog[open]');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.dialog[open]')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator('dialog.sheet[open]')).toHaveCount(1);
});
