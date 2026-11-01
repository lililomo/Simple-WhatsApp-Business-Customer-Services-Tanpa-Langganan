import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Semua file test memakai satu database test yang sama.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
