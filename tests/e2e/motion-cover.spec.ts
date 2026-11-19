import { expect, test } from '@playwright/test';
import { signedInWithNavidrome } from './helpers.ts';

// Animated lock-screen covers (docs/MOTION.md): an admin uploads a video for an album from the album
// page's menu, the iPhone app's endpoint then serves it, and the admin removes it; other users see
// no such items. The motion service is the mock Navidrome's stand-in (playwright.config.ts).

const MP4 = Buffer.concat([
  Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0isommp42'),
  Buffer.alloc(4096, 7),
]);
// One album per browser: both run at once against the same mock Navidrome.
const ALBUMS: Record<string, [string, string]> = {
  chromium: ['al-2', 'Copper Rain'],
  firefox: ['al-3', 'Glass Weather'],
};

test('an admin uploads a motion cover from the album page, and removes it', async ({
  page,
}, info) => {
  const [id, title] = ALBUMS[info.project.name] ?? ['al-4', 'Long Exposure'];
  await signedInWithNavidrome(page, 'mc', 'admin');
  await page.goto(`/library/album/${id}`);
  const more = page
    .locator('.action-bar')
    .getByRole('button', { name: `More options for ${title}` });
  await expect(page.locator('.track-row').first()).toBeVisible(); // the menu knows the album by its tracks

  await more.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload motion cover…' }).click();
  await (await chooser).setFiles({ name: 'loop.mp4', mimeType: 'video/mp4', buffer: MP4 });
  await expect(page.getByText('The motion cover is ready.')).toBeVisible({ timeout: 15_000 });

  // What the iPhone app is given for the album now.
  const res = await page.request.get(`/api/v1/motion/${id}?shape=tall&loop=8`);
  expect(await res.json()).toMatchObject({ status: 'ready', source: 'upload', style: 'video' });
  const video = await page.request.get(`/api/v1/motion/${id}/video?shape=tall`, {
    headers: { range: 'bytes=4-11' },
  });
  expect(video.status()).toBe(206);
  expect((await video.body()).toString()).toBe('ftypisom');

  await more.click();
  await page.getByRole('menuitem', { name: 'Remove motion cover' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(title);
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Motion cover removed.')).toBeVisible();
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Upload motion cover…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove motion cover' })).toHaveCount(0);
});

test('a video that is not one is refused in the page; other users have no such items', async ({
  page,
  browser,
}, info) => {
  const [id, title] = ALBUMS[info.project.name] ?? ['al-4', 'Long Exposure'];
  await signedInWithNavidrome(page, 'mc', 'admin');
  await page.goto(`/library/album/${id}`);
  await expect(page.locator('.track-row').first()).toBeVisible();
  const more = page
    .locator('.action-bar')
    .getByRole('button', { name: `More options for ${title}` });
  await more.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /motion cover…$/ }).click();
  await (await chooser).setFiles({
    name: 'loop.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  });
  await expect(page.getByText('That isn’t an MP4, M4V or QuickTime video.')).toBeVisible();

  const other = await browser.newPage();
  await signedInWithNavidrome(other, 'mcu');
  await other.goto(`/library/album/${id}`);
  await expect(other.locator('.track-row').first()).toBeVisible();
  await other
    .locator('.action-bar')
    .getByRole('button', { name: `More options for ${title}` })
    .click();
  await expect(other.getByRole('menuitem', { name: 'Add to queue' })).toBeVisible();
  await expect(other.getByRole('menuitem', { name: /motion cover/ })).toHaveCount(0);
  await other.close();
});
