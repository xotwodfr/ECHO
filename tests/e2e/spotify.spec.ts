import { expect, type Page, test } from '@playwright/test';
import { fakeSpotify, SP_ALBUM, SP_GLASS, SP_PLAYLIST, SP_TRACKS } from './fake-spotify.ts';
import {
  clearLyricsCache,
  connectSpotify,
  faults,
  playAlbum,
  releaseSpotify,
  serverSetting,
  signedInWithNavidrome,
} from './helpers.ts';

// M7 with a fake Spotify (fake-spotify.ts) and the mock accounts service: connecting (SEC-07's
// flow end to end), the device and transport (PLAY-08 as far as a fake can show it), one provider
// per queue (QUE-03, QUE-04, SP-06), grouped search (SRCH-02), Spotify's attribution (SP-01, SP-02),
// the remote state (PLAY-09) and the documented error states (REL-04).

const dock = (page: Page) => page.getByRole('region', { name: 'Player' });

// The Spotify app has 5 seats: one test at a time per browser, each giving its seat back.
test.describe.configure({ mode: 'default' });
let user: string | null = null;
test.afterEach(() => {
  if (user) releaseSpotify(user);
  user = null;
});

async function ready(page: Page) {
  const fake = await fakeSpotify(page);
  user = await signedInWithNavidrome(page, 'sp');
  await connectSpotify(page);
  return fake;
}

async function playSpotifyAlbum(page: Page) {
  await page.goto(`/library/album/${encodeURIComponent(`spotify:${SP_ALBUM.id}`)}`);
  await expect(page.getByRole('heading', { name: 'Northern Static' })).toBeVisible();
  await page
    .locator('.action-bar')
    .getByRole('button', { name: /^Play / })
    .click();
  await expect(dock(page)).toHaveAttribute('data-status', 'playing');
}

test('connecting Spotify from Settings → Account (PKCE through ECHO)', async ({ page }) => {
  await ready(page);
  await expect(page.getByText('Connected as Ada')).toBeVisible();
  await expect(page.getByTestId('drm-guidance')).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect' }).last().click();
  await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
});

test('a Spotify playlist opens with its songs', async ({ page }) => {
  await ready(page);
  await page.goto(`/playlist/${encodeURIComponent(`spotify:${SP_PLAYLIST.id}`)}`);
  await expect(page.getByRole('heading', { name: 'Night Drive' })).toBeVisible();
  await expect(page.locator('.track-row')).toHaveCount(2);
  await expect(page.getByText('This playlist does not exist')).toHaveCount(0);
});

test('a connection older than the newer scopes asks for a reconnect', async ({ page }) => {
  await faults(`spotifyScope=${encodeURIComponent('streaming user-library-read')}`);
  try {
    await ready(page);
    await expect(page.getByText('Reconnect Spotify to finish setting it up.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  } finally {
    await faults();
  }
});

test('BRW-02: without Widevine, the browser’s own fix is named', async ({ page, browserName }) => {
  await fakeSpotify(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMediaKeySystemAccess', {
      configurable: true,
      value: async () => {
        throw new DOMException('Unsupported keySystem', 'NotSupportedError');
      },
    });
  });
  await signedInWithNavidrome(page, 'sp');
  await page.goto('/settings/account');
  const guidance = page.getByTestId('drm-guidance');
  await expect(guidance).toContainText(
    browserName === 'firefox' ? 'Play DRM-controlled content' : 'chromium-widevine',
  );
});

test('a Spotify album plays on the device "ECHO": transfer, then the album by its URI', async ({
  page,
}) => {
  const fake = await ready(page);
  await playSpotifyAlbum(page);
  const player = fake.requests.filter((r) => r.path.startsWith('/v1/me/player'));
  expect(player[0]).toMatchObject({
    method: 'PUT',
    path: '/v1/me/player',
    body: { device_ids: ['fake-echo-device'], play: false },
  });
  expect(player[1]).toMatchObject({
    method: 'PUT',
    path: '/v1/me/player/play',
    body: { context_uri: `spotify:album:${SP_ALBUM.id}`, offset: { position: 0 } },
  });
  expect(
    await page.evaluate(
      () =>
        (window as never as { __fakeSpotify: { options: { name: string } } }).__fakeSpotify.options
          .name,
    ),
  ).toBe('ECHO');
  await expect(dock(page).locator('.dock-title')).toHaveText('Signal Fires');
  // Next goes to the SDK, and the dock follows what Spotify reports.
  await dock(page).getByRole('button', { name: 'Next' }).click();
  await expect(dock(page).locator('.dock-title')).toHaveText('Long Wave');
});

test('SP-01, SP-02: art, metadata linking to open.spotify.com, and the logo, even with chrome hidden', async ({
  page,
}) => {
  await ready(page);
  await playSpotifyAlbum(page);
  const d = dock(page);
  await expect(d.getByRole('link', { name: 'Signal Fires' })).toHaveAttribute(
    'href',
    `https://open.spotify.com/track/${SP_TRACKS[0]?.id}`,
  );
  await expect(d.getByRole('link', { name: 'Kite Weather' })).toHaveAttribute(
    'href',
    /^https:\/\/open\.spotify\.com\/artist\//,
  );
  await expect(d.getByRole('link', { name: 'Northern Static' })).toHaveAttribute(
    'href',
    `https://open.spotify.com/album/${SP_ALBUM.id}`,
  );
  const logo = d.getByRole('img', { name: 'Spotify' });
  await expect(logo).toBeVisible();
  expect((await logo.boundingBox())?.width).toBeGreaterThanOrEqual(70);
  await expect(d.getByText('Spotify', { exact: true })).toBeVisible(); // the provider mark
  // On the Stage with the chrome hidden, the metadata and logo stay (data-attribution).
  await page
    .getByRole('region', { name: 'Player' })
    .getByRole('button', { name: 'Lyrics', exact: true })
    .click();
  await expect(page.locator('.shell')).toHaveAttribute('data-attribution', 'true');
  await page.mouse.move(5, 5);
  await expect(page.locator('.shell')).toHaveAttribute('data-chrome', 'hidden', {
    timeout: 10_000,
  });
  await expect(d.locator('.dock-meta')).toHaveCSS('opacity', '1');
  await expect(logo).toBeVisible();
});

test('QUE-03: Spotify music over a Navidrome queue asks first; Cancel keeps it, Replace switches', async ({
  page,
}) => {
  await ready(page);
  await playAlbum(page, 'al-1');
  // In the app (a reload would start without the queue).
  await page.getByRole('button', { name: 'Close Now playing' }).click();
  // One library at a time: Spotify's albums show once the switch says Spotify (the queue stays).
  await page
    .getByRole('group', { name: 'Library', exact: true })
    .getByRole('button', { name: 'Spotify', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Your Library' })
    .getByRole('link', { name: /^Northern Static/ })
    .click();
  const play = page.locator('.action-bar').getByRole('button', { name: /^Play / });
  await play.click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Replace the queue with this Spotify music?',
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dock(page).locator('.dock-title')).toHaveText(/^Harbour Lights \d$/);
  await play.click();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(dock(page).locator('.dock-title')).toHaveText('Signal Fires');
  await expect(dock(page).getByText('Spotify', { exact: true })).toBeVisible();
});

test('QUE-04: Spotify’s queue is read-only except Add, with the explanation', async ({ page }) => {
  const fake = await ready(page);
  await playSpotifyAlbum(page);
  await dock(page).getByRole('button', { name: 'Queue' }).click();
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  await expect(sheet.getByText('Queue managed by Spotify')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Clear queue' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^More/ })).toHaveCount(0);
  await expect(sheet.locator('[draggable="true"]')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  // Add to queue goes to Spotify's queue.
  const row = page.locator('.track-row').nth(2);
  await row.getByRole('button', { name: /More/ }).click();
  await page.getByRole('menuitem', { name: 'Add to queue' }).click();
  await expect
    .poll(() => fake.requests.some((r) => r.method === 'POST' && r.path === '/v1/me/player/queue'))
    .toBe(true);
});

test('SRCH-02: search finds the active source only; Spotify at most 10 per type', async ({
  page,
}) => {
  const fake = await ready(page);
  await page.goto('/search');
  await page
    .getByRole('group', { name: 'Library', exact: true })
    .getByRole('button', { name: 'Navidrome', exact: true })
    .click();
  const box = page.getByRole('navigation', { name: 'Main' }).getByRole('searchbox');
  await box.fill('a');
  const groups = page.locator('.results-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveAttribute('data-provider', 'navidrome');
  // The same query, now against Spotify: only its results, never the Navidrome ones meanwhile.
  await page
    .getByRole('group', { name: 'Library', exact: true })
    .getByRole('button', { name: 'Spotify', exact: true })
    .click();
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toHaveAttribute('data-provider', 'spotify');
  const searches = fake.requests.filter((r) => r.path === '/v1/search');
  expect(searches.length).toBeGreaterThan(0);
  for (const s of searches) expect(Number(s.query.get('limit'))).toBeLessThanOrEqual(10);
});

test('PLAY-09: playback moved to another device shows "Playing on …"; Play here takes it back', async ({
  page,
}) => {
  const fake = await ready(page);
  await playSpotifyAlbum(page);
  fake.device = { id: 'kitchen', name: 'Kitchen speaker' };
  await page.evaluate(() =>
    (window as never as { __fakeSpotify: { moveAway(): void } }).__fakeSpotify.moveAway(),
  );
  await expect(dock(page).getByText('Playing on Kitchen speaker')).toBeVisible();
  fake.device = null;
  await dock(page).getByRole('button', { name: 'Play here' }).click();
  await expect(dock(page).getByText('Playing on Kitchen speaker')).toHaveCount(0);
  expect(fake.requests.at(-1)).toMatchObject({
    method: 'PUT',
    path: '/v1/me/player',
    body: { device_ids: ['fake-echo-device'], play: true },
  });
});

test('REL-04: not_ready, Premium missing and sign-in expiry each show their state', async ({
  page,
}) => {
  await ready(page);
  await playSpotifyAlbum(page);
  const fire = (event: string) =>
    page.evaluate(
      (e) =>
        (
          window as never as { __fakeSpotify: { fire(e: string, a: unknown): void } }
        ).__fakeSpotify.fire(e, { message: 'x' }),
      event,
    );
  await fire('not_ready');
  await expect(dock(page).getByText('Reconnecting to Spotify…')).toBeVisible();
  await fire('account_error');
  await expect(dock(page).getByText('Spotify playback needs Premium.')).toBeVisible();
  // The token ECHO hands out is refused, and ECHO says the sign-in has expired.
  await page.route('**/api/v1/spotify/token', (r) =>
    r.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"spotify.expired"}',
    }),
  );
  await fire('authentication_error');
  await expect(dock(page).getByText('Spotify sign-in expired.')).toBeVisible();
  await expect(dock(page).getByRole('link', { name: 'Reconnect' })).toBeVisible();
});

test('SP-04: G1 and G2 on give art colour and timed lyrics; switched off, the next track falls back', async ({
  page,
  browserName,
}) => {
  // The gates are server-wide: one browser flips them, so the other's tests never see a race.
  test.skip(browserName !== 'chromium', 'gates are shared server state');
  clearLyricsCache();
  await ready(page);
  const palette = () =>
    page.waitForResponse((r) => r.url().includes('/api/v1/palette/spotify%3Aalbum%3A'));
  try {
    const first = palette();
    await page.goto(`/library/album/${encodeURIComponent(`spotify:${SP_GLASS.id}`)}`);
    await page
      .locator('.action-bar')
      .getByRole('button', { name: /^Play / })
      .click();
    const on = await first;
    expect(on.url()).toContain(encodeURIComponent('https://i.scdn.co/image/glass-weather-300'));
    expect((await on.json()).source).toBe('art');
    await page
      .getByRole('region', { name: 'Player' })
      .getByRole('button', { name: 'Lyrics', exact: true })
      .click();
    await expect(page.getByRole('list', { name: 'Lyrics' })).toContainText('Glass Weather 1');
    await expect(page.locator('.ly-sheet')).toHaveCount(0);

    serverSetting('spotify.gates.artPalette', false);
    serverSetting('spotify.gates.syncedLyrics', false);
    const second = palette();
    await page.keyboard.press('Control+ArrowRight'); // Next
    expect((await (await second).json()).source).toBe('fallback');
    await expect(page.locator('.ly-sheet')).toContainText('Glass Weather 2');
  } finally {
    serverSetting('spotify.gates.artPalette', true);
    serverSetting('spotify.gates.syncedLyrics', true);
  }
});
