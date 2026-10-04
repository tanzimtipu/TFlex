// TFL-663 adversary diff-pass probes. Runs against the dev build via the
// canonical launcher. Lives outside e2e/ so the shipped suite is untouched.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.cjs',
  timeout: 180000,
  workers: 1,
  use: { headless: true },
  reporter: [['list']],
});