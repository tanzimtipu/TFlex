import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // INSTALLED-APP specs (e2e/installed/**) launch the installed/packaged exe
  // and are NOT part of the standard suite. They run only via
  // `npx playwright test --config=e2e/installed/playwright.installed.config.js`
  // when the orchestrator explicitly asks to test the installed app.
  testIgnore: ['e2e/installed/**', 'e2e/archived/**'],
  timeout: 120000,
  // Electron instances lock the shared %APPDATA%/tflex user-data path on this
  // machine; parallel launches race ("User data directory already in use") and die
  // mid-run. Run genuinely serial — one instance at a time, one worker.
  workers: 1,
  use: {
    headless: true,
  },
});

