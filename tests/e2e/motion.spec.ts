import { expect, type Page, test } from '@playwright/test';
import { signedIn } from './helpers.ts';

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
  expect(await motion(page)).toBe('less');
  await setMotion(page, 'Full');
  await expect.poll(() => motion(page)).toBe('full');
  await setMotion(page, 'Off');
  await expect.poll(() => motion(page)).toBe('off');
});
