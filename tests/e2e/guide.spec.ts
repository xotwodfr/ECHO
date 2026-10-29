import { expect, type Page, test } from '@playwright/test';

// M3 task 3: guide tracks play through a real <audio> element and the Web Audio graph
// (VISUALIZER_SPEC.md §3.1), in real time (no page.clock: the media clock is the browser's).
// An init script records the element and the graph so the tests see the real path being used.

declare global {
  interface Window {
    __media: HTMLMediaElement | null;
    __graph: { contexts: number; sources: number };
  }
}

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const title = (page: Page) => dock(page).locator('.dock-title');
const mediaTime = (page: Page) => page.evaluate(() => window.__media?.currentTime ?? -1);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__media = null;
    window.__graph = { contexts: 0, sources: 0 };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      window.__media = this;
      return play.call(this);
    };
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(o?: AudioContextOptions) {
        super(o);
        window.__graph.contexts++;
      }
      override createMediaElementSource(el: HTMLMediaElement) {
        window.__graph.sources++;
        return super.createMediaElementSource(el);
      }
    };
  });
});

// Where the browser has no WebGL (headless Firefox without a display), three.js reports it before
// the Stage falls back to the CSS room (VIS-07): expected, so not a failure here.
const NO_WEBGL =
  /^THREE\.WebGLRenderer: .*(WebGL context could not be created|Error creating WebGL context)/;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && !NO_WEBGL.test(m.text()) && errors.push(m.text()),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('a guide track plays real audio through one Web Audio graph; pause and seek reach it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/library/album/al-guide');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guide Tones');
  await page.getByRole('button', { name: 'Play ballad-word' }).click();
  await expect(title(page)).toHaveText('ballad-word');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');

  expect(await page.evaluate(() => window.__media?.src.startsWith('blob:'))).toBe(true);
  await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__graph)).toEqual({ contexts: 1, sources: 1 });
  await expect(dock(page).locator('.scrubber-time').first()).not.toHaveText('0:00');

  // Pause: the element stops, and its time with it.
  await dock(page).getByRole('button', { name: 'Pause' }).click();
  await expect(dock(page)).toHaveAttribute('data-status', 'paused');
  const paused = await mediaTime(page);
  await page.waitForTimeout(400);
  expect(await mediaTime(page)).toBe(paused);

  // Seek forward from the keyboard: the element jumps.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(paused + 4);

  // Resume, then the next guide track reuses the same element and graph.
  await page.keyboard.press(' ');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  await dock(page).getByRole('button', { name: 'Next' }).click();
  await expect(title(page)).toHaveText('rap-word');
  await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThan(0.5);
  expect(await page.evaluate(() => window.__graph)).toEqual({ contexts: 1, sources: 1 });
  expect(errors).toEqual([]);
});

test('switching to a fixture album without audio stops the guide tone', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/library/album/al-guide');
  await page.getByRole('button', { name: 'Play pop-line' }).click();
  await expect.poll(() => mediaTime(page), { timeout: 5000 }).toBeGreaterThan(0.3);
  // In-app navigation: a page load would lose the element under test.
  await page
    .getByRole('navigation', { name: 'Your Library' })
    .getByRole('link', { name: /^Harbour Lights/ })
    .click();
  await page.getByRole('button', { name: 'Play Ferry at Six' }).click();
  await expect(title(page)).toHaveText('Ferry at Six');
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
  expect(await page.evaluate(() => window.__media?.paused)).toBe(true);
  expect(errors).toEqual([]);
});

test('deterministic mode: fixture=<lyric fixture> cues its guide track at the frame time', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/?frame=60000&fixture=ballad-word');
  await expect(title(page)).toHaveText('ballad-word');
  await expect(dock(page)).toHaveAttribute('data-status', 'paused');
  await expect(dock(page).locator('.scrubber-time').first()).toHaveText('1:00');
  expect(errors).toEqual([]);
});
