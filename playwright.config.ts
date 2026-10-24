import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Host port 8080 is the documented container port; E2E uses its own port so it can run next to
// anything already bound to 8080 on a workstation.
const port = Number(process.env.E2E_PORT ?? 18787);
const mockPort = port + 1;

// The server refuses to start without a master key (SETTINGS_AND_SECURITY.md §3.2): E2E uses a
// throwaway one, with its data, outside the repo.
const e2eDir = join(tmpdir(), 'echo-e2e');
const keyFile = join(e2eDir, 'master_key');
mkdirSync(e2eDir, { recursive: true });
if (!existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });

// CSP violation reports of the whole run land here; the isolated csp spec checks it is empty.
export const CSP_REPORTS = join(e2eDir, 'csp-reports.jsonl');

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // localhost, not 127.0.0.1: Firefox keeps a Secure (__Host-) cookie over http only for localhost.
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: 'chromium',
      testIgnore: /photosensitivity|reliability|states|csp|perf/,
      use: {
        ...devices['Desktop Chrome'],
        // WebGL 2 in software, the same everywhere (TECHNICAL_ARCHITECTURE.md §8).
        launchOptions: {
          // Greyscale text antialiasing everywhere: subpixel (LCD) fringes depend on the host's
          // font settings (Ubuntu CI has them, Arch does not) and would make pixel baselines and
          // the DS-02 colour share machine-specific.
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader-webgl',
            '--enable-unsafe-swiftshader',
            '--disable-lcd-text',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /photosensitivity|reliability|states|csp|perf/,
    },
    // Run on their own, after the rest: A11Y-08 reads the stage back every frame for 10 s, and the
    // reliability and states specs break the shared mock Navidrome on purpose.
    {
      name: 'isolated',
      testMatch: /(photosensitivity|reliability|states|csp|perf)\.spec\.ts/,
      workers: 1, // reliability and states both break the shared mock: one test at a time
      dependencies: ['chromium', 'firefox'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader-webgl',
            '--enable-unsafe-swiftshader',
            '--disable-lcd-text',
          ],
        },
      },
    },
  ],
  webServer: [
    // A mock Navidrome for the account and playback specs (src/server/navidrome/mock.ts).
    {
      command: `node scripts/mock-subsonic.ts ${mockPort}`,
      url: `http://127.0.0.1:${mockPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm build && node src/server/index.ts',
      env: {
        ECHO_PORT: String(port),
        ECHO_LOG: 'warn',
        ECHO_MASTER_KEY_FILE: keyFile,
        ECHO_DATA_DIR: join(e2eDir, 'data'),
        ECHO_DEV_FIXTURES: '1',
        ECHO_NAVIDROME_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_LRCLIB_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_SPICY_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_SPOTIFY_ACCOUNTS_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_SPOTIFY_API_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_SPOTIFY_IMAGE_URL: `http://127.0.0.1:${mockPort}`,
        ECHO_CSP_REPORT_FILE: CSP_REPORTS,
      },
      url: `http://127.0.0.1:${port}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
