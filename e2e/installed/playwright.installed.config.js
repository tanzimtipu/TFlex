// Config for the INSTALLED-APP suite ONLY (e2e/installed/*.spec.cjs).
// The standard suite (root playwright.config.js) ignores this directory.
// Run it only when the orchestrator explicitly asks to test the installed app:
//   npx playwright test --config=e2e/installed/playwright.installed.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.cjs',
  timeout: 120000,
  workers: 1,
  use: {
    headless: true,
  },
});
