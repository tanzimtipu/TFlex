import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: {
    root: process.cwd(),
    include: ['test-fixtures/phase104-adversary/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup/skipMotionAnimations.ts'],
  },
});
