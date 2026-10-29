import { expect, test } from '@playwright/test';
import { clearLyricsCache, faults, playAlbum, signedInWithNavidrome } from './helpers.ts';

// REL-01 and REL-02 (ACCEPTANCE_CRITERIA.md) against the mock Navidrome, whose faults this spec
// switches on and off. It runs in the "isolated" project, one test at a time.

test.describe.configure({ mode: 'serial' });

test.afterEach(() => faults());

test('REL-02: a broken stream is reloaded, then skipped with a toast', async ({ page }) => {
  await signedInWithNavidrome(page);
  await page.goto('/library/album/al-2');
  await faults('breakStreamAt=4000'); // every stream breaks after 4 KB
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  await expect(page.getByText('This track could not be played. Skipped to the next.')).toBeVisible({
    timeout: 15_000,
  });
  await faults(); // healthy again: the track it skipped to plays
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).not.toContainText('Copper Rain 1');
  await expect(dock).toHaveAttribute('data-status', 'playing', { timeout: 15_000 });
});

// ON-PB-2: a stream that fails before its metadata (Navidrome restarting) is reloaded too, not
// skipped at once: the first two requests fail, the third plays the same track.
test('REL-02: a stream failing before it starts is reloaded and plays, with no skip', async ({
  page,
}) => {
  await signedInWithNavidrome(page);
  await page.goto('/library/album/al-2');
  await faults('failStreams=2');
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock).toHaveAttribute('data-status', 'playing', { timeout: 15_000 });
  await expect(dock).toContainText('Copper Rain 1');
  await expect(page.getByText('This track could not be played. Skipped to the next.')).toHaveCount(
    0,
  );
});

test('REL-01: Navidrome down shows in the dock, and recovers on its own', async ({ page }) => {
  await signedInWithNavidrome(page);
  await faults('down=1');
  await page.goto('/library/album/al-1'); // the album's tracks need Navidrome
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(dock.getByRole('status')).toContainText('Navidrome unreachable');
  await faults();
  // Recovery within one backoff interval (≤ 2 s at this point), no reload.
  await expect(dock.getByRole('status')).toHaveCount(0, { timeout: 5000 });
});

test('LYR-16: a slow lyric source shows the dots at 600 ms and the note at 1.5 s, then the lyrics', async ({
  page,
}) => {
  await signedInWithNavidrome(page);
  await faults('lyricsDelayMs=2500');
  clearLyricsCache();
  await playAlbum(page, 'al-3'); // Glass Weather: lyrics from (the mock) LRCLIB
  const t0 = Date.now();
  const dots = page.locator('.stage-dots');
  await expect(dots).toBeVisible({ timeout: 3000 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(450); // not before ~600 ms (and the click/route cost)
  await expect(page.getByText('Finding lyrics…')).toBeVisible();
  await expect(
    page.locator('.ly-field .ly-line', { hasText: 'Glass in the morning' }),
  ).toBeAttached({ timeout: 6000 });
  await expect(dots).toHaveCount(0);
});

test('REL-03: lyric sources failing never block playback or the palette', async ({ page }) => {
  await signedInWithNavidrome(page);
  await faults('lrclibStatus=500');
  clearLyricsCache();
  await playAlbum(page, 'al-3');
  const dock = page.getByRole('region', { name: 'Player' });
  await expect(page.getByText('No lyrics found')).toBeVisible({ timeout: 8000 });
  await expect(dock).toHaveAttribute('data-status', 'playing'); // still playing
  const room = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--art-room'),
  );
  expect(room).toMatch(/oklch/); // the album's palette arrived regardless
});
