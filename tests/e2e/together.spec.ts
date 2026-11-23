import { expect, type Page, test } from '@playwright/test';
import { signedInWithNavidrome } from './helpers.ts';

// Listen together (docs/TOGETHER.md): two people on the same library, in two browsers. The host
// starts a session from the queue; the other opens its link and joins; both hear the same song at
// the same place, and the host's pause pauses both.

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });
const seek = (page: Page) => dock(page).getByRole('slider', { name: 'Seek' });
const queue = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Queue' })
    .or(page.getByRole('dialog', { name: 'Queue' }));

/** The scrubber's position (ms), read on both pages at the same moment. */
async function positions(a: Page, b: Page) {
  const [pa, pb] = await Promise.all([
    seek(a).getAttribute('aria-valuenow'),
    seek(b).getAttribute('aria-valuenow'),
  ]);
  return [Number(pa), Number(pb)] as const;
}

test('two listeners hear the same song at the same place; the host pauses both', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // Wide enough for the queue to be the right panel (a sheet below 1400 px).
  const viewport = { width: 1440, height: 900 };
  const host = await (await browser.newContext({ viewport })).newPage();
  const guest = await (await browser.newContext({ viewport })).newPage();
  await signedInWithNavidrome(host, 'tg');
  await signedInWithNavidrome(guest, 'tg');

  await host.goto('/library/album/al-2');
  await host
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  await expect(dock(host)).toHaveAttribute('data-status', 'playing');
  await dock(host).getByRole('button', { name: 'Queue' }).click();
  await queue(host).getByRole('button', { name: 'Listen together' }).click();
  const sheet = host.getByRole('dialog', { name: 'Listen together' });
  await expect(sheet.getByRole('img', { name: 'Listen together QR code' })).toBeVisible();
  const link = (await sheet.locator('code').textContent()) ?? '';
  expect(link).toMatch(/\/together\/[\w-]{24}$/);

  // The guest opens the link: whose session it is, then Join.
  await guest.goto(new URL(link).pathname);
  const offer = guest.getByRole('dialog', { name: 'Listen together' });
  await expect(offer).toContainText('invited you to listen together');
  await offer.getByRole('button', { name: 'Join' }).click();
  await expect(dock(guest)).toHaveAttribute('data-status', 'playing', { timeout: 15_000 });
  await expect(dock(guest).locator('.dock-title')).toHaveText(
    (await dock(host).locator('.dock-title').textContent()) ?? '',
  );
  await expect(sheet).toContainText('2 listeners');

  // In step within the 300 ms target once the first correction has settled (the scrubbers tick
  // on their own, so one reading can be a tick apart: the test waits for a close one).
  await expect
    .poll(
      async () => {
        const [a, b] = await positions(host, guest);
        return a > 1000 ? Math.abs(a - b) : Number.POSITIVE_INFINITY;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(300);

  // A member cannot pause for everyone.
  await dock(guest).getByRole('button', { name: 'Pause' }).click();
  await expect(guest.getByText('Only the host controls playback.')).toBeVisible();
  await expect(dock(guest)).toHaveAttribute('data-status', 'playing');

  // The host pauses: both pause at the same place (a transcoded stream on the whole second before
  // it, put right on Play); the host plays: both play, in step again.
  const apart = async () => {
    const [a, b] = await positions(host, guest);
    return Math.abs(a - b);
  };
  await sheet.getByRole('button', { name: 'Close' }).click();
  await dock(host).getByRole('button', { name: 'Pause' }).click();
  await expect(dock(guest)).toHaveAttribute('data-status', 'paused', { timeout: 10_000 });
  await expect.poll(apart, { timeout: 10_000 }).toBeLessThan(1000);
  await dock(host).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(dock(guest)).toHaveAttribute('data-status', 'playing', { timeout: 10_000 });
  await expect.poll(apart, { timeout: 15_000 }).toBeLessThan(300);

  // The guest's queue is the shared one; ending the session tells the guest.
  await dock(guest).getByRole('button', { name: 'Queue' }).click();
  await expect(queue(guest)).toContainText('Up next');
  await queue(host)
    .getByRole('button', { name: /Listening together · 2/ })
    .click();
  await host
    .getByRole('dialog', { name: 'Listen together' })
    .getByRole('button', { name: 'End session' })
    .click();
  await expect(guest.getByText('The listening session ended.')).toBeVisible({ timeout: 10_000 });
});
