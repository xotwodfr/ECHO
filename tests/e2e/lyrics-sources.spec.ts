import { expect, test } from '@playwright/test';
import { playAlbum, signedInWithNavidrome } from './helpers.ts';

// M6 on the mock sources: lyrics from the user's own Navidrome (word-timed) and from LRCLIB, the
// attribution for each (LI-05), Cover mode when there are none (LYR-15), the timing offset
// (LYR-25), the scrubber's lyric line (PLAY-10), and no browser request to Spicy (LI-07).

test('word-timed lyrics from your library, with their attribution', async ({ page }) => {
  const spicy: string[] = [];
  page.on('request', (r) => r.url().includes('spicylyrics') && spicy.push(r.url()));
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-1'); // Harbour Lights 1: songLyrics v2 cues in the mock
  await expect(page.locator('.ly-field .ly-line', { hasText: 'First line here' })).toBeAttached();
  await expect(page.locator('.ly-field .ly-w').first()).toBeAttached(); // per-word spans: word sync
  await expect(page.locator('.stage-attribution')).toHaveText(/Lyrics from your library/);
  expect(spicy).toEqual([]); // LI-07: the browser never calls Spicy Lyrics
});

test('LRCLIB lyrics are attributed with a link (LI-05)', async ({ page }) => {
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-3');
  await expect(
    page.locator('.ly-field .ly-line', { hasText: 'Glass in the morning' }),
  ).toBeAttached();
  const link = page.locator('.stage-attribution').getByRole('link', { name: 'LRCLIB' });
  await expect(link).toHaveAttribute('href', 'https://lrclib.net');
});

test('no lyrics anywhere: Cover mode, "No lyrics found", the sources tried (LYR-15)', async ({
  page,
}) => {
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-4'); // Long Exposure: nothing in the mock sources
  await expect(page.getByText('No lyrics found')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.stage-cover')).toBeVisible();
  await expect(page.locator('.stage-missing')).toContainText(/Sources tried: .*LRCLIB: not found/);
});

test('[ and ] shift the lyrics per track, with a toast, and it is kept (LYR-25)', async ({
  page,
}) => {
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-1');
  await expect(page.locator('.ly-field .ly-line').first()).toBeAttached();
  for (let i = 0; i < 3; i++) await page.keyboard.press(']');
  await expect(page.getByRole('status').filter({ hasText: 'Lyrics +150 ms' })).toBeVisible();
  await page.keyboard.press('[');
  await expect(page.getByRole('status').filter({ hasText: 'Lyrics +100 ms' })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/v1/me/tracks/navidrome:al-1-t1/override')).json())
          .offsetMs,
      {
        timeout: 5000,
      },
    )
    .toBe(100);
});

test('the scrubber shows the lyric line at the hovered time (PLAY-10)', async ({ page }) => {
  await signedInWithNavidrome(page);
  await playAlbum(page, 'al-1');
  await expect(page.locator('.ly-field .ly-line').first()).toBeAttached();
  const seek = page.getByRole('region', { name: 'Player' }).getByRole('slider', { name: 'Seek' });
  const box = await seek.boundingBox();
  if (!box) throw new Error('seek');
  // 6 s into the 20 s track: the second line (it starts at 5 s). The Stage hides its chrome when
  // idle, so the first move may only wake it: hover until the bubble shows.
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height / 2;
  await expect(async () => {
    await page.mouse.move(x - 4, y);
    await page.mouse.move(x, y);
    await expect(page.locator('.slider-preview')).toHaveText('Second line here', { timeout: 500 });
  }).toPass({ timeout: 8000 });
});
