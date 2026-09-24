// Dev-suite config (QA). The canonical suite MINUS the installed/release specs
// that launch the PACKAGED exe. `testIgnore` is applied by Playwright itself, so
// the exclusion is filename-level — unlike `--grep-invert`, which matches test
// TITLES and therefore silently keeps these files in the run.
//
// Excluded (all launch the installed/packaged exe):
//   e2e/installed/**
//   e2e/archived/**
//   e2e/release_1272_installed_gates.spec.cjs
//   e2e/retests/release_1250_headline_installed.spec.cjs
//   e2e/retests/release_1260_headline_installed.spec.cjs
//   e2e/retests/release_1270_headline_installed.spec.cjs
//   e2e/retests/release_1270_file_assoc_installed.spec.cjs
//
// Run the dev suite with:
//   npm.cmd run test:e2e -- --config=e2e/playwright.dev.config.js
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: here,
  testIgnore: [
    /[\\/]e2e[\\/]installed[\\/]/,
    /[\\/]e2e[\\/]archived[\\/]/,
    /release_1[0-9]+.*_installed.*\.spec\.cjs$/,
  ],
  timeout: 120000,
  workers: 1,
  use: {
    headless: true,
  },
});