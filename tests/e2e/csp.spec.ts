import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CSP_REPORTS } from '../../playwright.config.ts';

// SEC-08: no Content-Security-Policy violation during the whole E2E run. Runs in the isolated
// project, after Chromium and Firefox; the server appended every report it received.

test('SEC-08: the full run caused no CSP violation', async ({ page }) => {
  // A page load here too, so the check never passes on a run that loaded nothing.
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your Library', level: 1 })).toBeVisible();
  const reports = existsSync(CSP_REPORTS) ? readFileSync(CSP_REPORTS, 'utf8').trim() : '';
  expect(reports).toBe('');
});
