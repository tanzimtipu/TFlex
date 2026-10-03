import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export default defineConfig({
  root,
  test: {
    include: [
      'test-fixtures/adv442/**/*.probe.test.ts',
      'test-fixtures/adv442/**/*.probe.test.tsx',
    ],
    environment: 'node',
    setupFiles: ['test/setup/skipMotionAnimations.ts'],
  },
});