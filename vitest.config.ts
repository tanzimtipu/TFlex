import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8's resolver returns null for bare specifiers on this Windows/OneDrive
  // checkout unless symlinks are preserved; without it every renderer suite
  // fails to resolve "motion/react" and friends before collecting tests.
  resolve: { preserveSymlinks: true },
  test: {
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup/skipMotionAnimations.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
    },
  },
});
