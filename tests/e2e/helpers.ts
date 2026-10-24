import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashSecret } from '../../src/server/auth/password.ts';
import { createSession, SESSION_COOKIE } from '../../src/server/auth/sessions.ts';

// Shared E2E steps: a fresh user straight into the E2E database, signed in, with the mock Navidrome
// connected (Playwright starts it next to ECHO, playwright.config.ts).

export const MOCK = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 18787) + 1}`;
export const faults = (q = '') => fetch(`${MOCK}/__faults?${q}`);
const PASSWORD = 'correct horse battery staple';

/**
 * A signed-in user with the mock Navidrome connected. The session is created in the database and
 * set as the cookie: signing in through the form is the account spec's job, and doing it in every
 * spec would trip the login rate limit (10 a minute per address, SETTINGS_AND_SECURITY.md §4.4).
 */
export async function signedInWithNavidrome(page: Page, prefix = 'u') {
  const user = `${prefix}-${randomBytes(4).toString('hex')}`;
  const db = new Database(join(tmpdir(), 'echo-e2e', 'data', 'echo.db'));
  const id = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'user', 0)",
      )
      .run(user, await hashSecret(PASSWORD)).lastInsertRowid,
  );
  const token = createSession(db, id, 'web', Date.now());
  db.close();
  // Set from the page: localhost is a secure context, so a Secure __Host- cookie is allowed there
  // (the protocol API refuses Secure cookies for an http URL).
  await page.goto('/login');
  await page.evaluate(
    ([name, value]) => {
      // biome-ignore lint/suspicious/noDocumentCookie: a test sets the session the server issued
      document.cookie = `${name}=${value}; Secure; Path=/; SameSite=Lax`;
    },
    [SESSION_COOKIE, token],
  );
  await page.goto('/settings/account');
  await page.getByLabel('Navidrome username').fill('ada');
  await page.getByLabel('Navidrome password', { exact: true }).fill('navidrome-pass');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page).toHaveURL(/\/$/);
  return user;
}

/** Plays an album from its page, then opens the Stage. */
export async function playAlbum(page: Page, albumId: string, track = 0) {
  await page.goto(`/library/album/${albumId}`);
  if (track === 0)
    await page
      .locator('.detail-actions')
      .getByRole('button', { name: 'Play', exact: true })
      .click();
  else await page.locator('.track-row').nth(track).getByRole('button').first().click();
  await expect(page.getByRole('region', { name: 'Player' })).toHaveAttribute(
    'data-status',
    'playing',
  );
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Listen' })
    .click();
}

/** Empties the server's lyric cache, so a test meets the sources themselves (the files are shared). */
export function clearLyricsCache() {
  rmSync(join(tmpdir(), 'echo-e2e', 'data', 'cache', 'lyrics'), { recursive: true, force: true });
}
