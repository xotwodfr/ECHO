/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const serverPort = process.env.ECHO_PORT ?? '8080';

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      // The type specimen (which also carries the Geologica alternative) is a dev/review page.
      // The production image builds with ECHO_SPECIMEN=0 so neither ships (DS-10).
      input: {
        main: 'index.html',
        ...(process.env.ECHO_SPECIMEN === '0' ? {} : { specimen: 'specimen.html' }),
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
