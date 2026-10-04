import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: {
    include: ['test-fixtures/tfl663/**/*.test.ts'],
    environment: 'node',
  },
});