/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const serverPort = process.env.ECHO_PORT ?? '8080';

// Development pages (the type specimen, the /__ui component gallery) and the fixture library are
// left out of the image.
const devPages = process.env.ECHO_SPECIMEN !== '0';

export default defineConfig({
  define: {
    __ECHO_UI_PAGE__: JSON.stringify(devPages),
    __ECHO_FIXTURES__: JSON.stringify(devPages),
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // The lazy `engine` chunk is three.js with the Stage (~580 kB, 150 kB gzip), loaded only on
    // Listen. The budget that matters is PERF-05's shell JS ≤ 350 KB gzip.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      // The type specimen (which also carries the Geologica alternative) is a dev/review page.
      // The production image builds with ECHO_SPECIMEN=0 so neither ships (DS-10).
      input: {
        main: 'index.html',
        ...(devPages ? { specimen: 'specimen.html' } : {}),
      },
    },
  },
  server: {
    proxy: { '/api': `http://127.0.0.1:${serverPort}` },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Auth tests hash with Argon2id at production cost (SETTINGS_AND_SECURITY.md §4.3); several
    // take 3–4 s alone and crossed the 5 s default under the full parallel run.
    testTimeout: 15_000,
  },
});
