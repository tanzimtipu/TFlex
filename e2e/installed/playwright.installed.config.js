// Config for the INSTALLED-APP suite ONLY (e2e/installed/*.spec.cjs).
// The standard suite (root playwright.config.js) ignores this directory.
// Run it only when the orchestrator explicitly asks to test the installed app:
//   npx playwright test --config=e2e/installed/playwright.installed.config.js
//
// testMatch stays broad so a future installed-build spec deliberately placed
// in this directory is collected automatically. testIgnore blocks the retired
// one-off specs that still live here (dead selectors / hardcoded old versions)
// and anything under e2e/archived/. The canonical spec is
// canonical_installed_build.spec.cjs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.cjs',
  testIgnore: [
    'archived/**',
    'def_079_080.spec.cjs',
    'installed_textbug_repro.spec.cjs',
    'installed-app-test.spec.cjs',
    'ota_bug9_live.spec.cjs',
    'def_172_update_prompt_dismiss.spec.cjs',
    'diag_installed_sheet_190.spec.cjs',
  ],
  timeout: 120000,
  workers: 1,
  use: {
    headless: true,
  },
});
