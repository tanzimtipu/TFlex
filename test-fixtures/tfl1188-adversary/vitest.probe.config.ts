import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: {
    root: process.cwd(),
    include: ['test-fixtures/tfl1188-adversary/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup/skipMotionAnimations.ts'],
  },
});
