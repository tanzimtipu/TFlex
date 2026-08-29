import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  // Electron instances lock the shared %APPDATA%/tflex user-data path on this
  // machine; parallel launches race ("User data directory already in use") and die
  // mid-run. Run genuinely serial — one instance at a time, one worker.
  workers: 1,
  use: {
    headless: true,
  },
});

