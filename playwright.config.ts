import { defineConfig, devices } from '@playwright/test';

// Host port 8080 is the documented container port; E2E uses its own port so it can run next to
// anything already bound to 8080 on a workstation.
const port = Number(process.env.E2E_PORT ?? 18787);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    {
      name: 'chromium',
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
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'pnpm build && node src/server/index.ts',
    env: { ECHO_PORT: String(port), ECHO_LOG: 'warn' },
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
