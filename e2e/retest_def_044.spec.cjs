const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test.describe('DEF-044 Retest: Theme persistence on rapid quit', () => {
  let electronApp;
  let page;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('theme toggle persists even when closing immediately', async () => {
    // 1. Launch app
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const userDataDir = path.join(os.tmpdir(), `tflex-retest-def-044-${Date.now()}`);

    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });

    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Initial theme:', initialTheme);
    const targetTheme = initialTheme === 'dark' ? 'light' : 'dark';

    // 2. Toggle theme
    await page.click('.theme-toggle');
    // Verify it toggled in renderer
    await expect(page.locator('html')).toHaveAttribute('data-theme', targetTheme);

    // Get settings path
    const appInfo = await page.evaluate(() => window.tflex.app.getInfo());
    const settingsPath = appInfo.storagePaths.settings;
    console.log('Settings path:', settingsPath);

    // 3. Immediately close the window (mimic the race condition)
    console.log(`Toggled to ${targetTheme}, closing window immediately...`);
    await page.close();
    // Wait for the app to quit normally
    await new Promise(r => setTimeout(r, 1000));
    
    electronApp = null;

    // 4. Restart and verify
    console.log('Restarting app...');
    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });

    const finalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Final theme:', finalTheme);

    expect(finalTheme).toBe(targetTheme);
    await page.screenshot({ path: 'screenshots/def-044-retest.png' });
  });
});
