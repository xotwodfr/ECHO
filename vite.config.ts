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
  },
});
