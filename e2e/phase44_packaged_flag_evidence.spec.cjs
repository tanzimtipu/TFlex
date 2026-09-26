// Phase 44 release-gate evidence: the accounts flag on the PACKAGED build.
//
// Proves the launch really targeted release/win-unpacked/TFlex.exe (logs
// app.getVersion() and process.execPath), that the flag-OFF default exposes no
// account surface, and that flipping the flag ON in settings makes the account
// surface appear live. Captures the two required screenshots.
//
// Run with TFLEX_PACKAGED_EXE pointing at release/win-unpacked/TFlex.exe.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.cwd(), 'release', 'win-unpacked', 'TFlex.exe');

test('packaged build: flag OFF has no account surface; flag ON shows it live', async () => {
  const app = await launchApp([], null, PACKAGED_EXE);
  try {
    const page = await app.firstWindow();
    const version = await app.evaluate(({ app: a }) => a.getVersion());
    const execPath = await app.evaluate(() => process.execPath);
    console.log(`[p44-evidence] version=${version} execPath=${execPath}`);
    expect(version, 'packaged build version').toBe('1.36.0');
    expect(execPath.toLowerCase(), 'launched the packaged exe').toContain('win-unpacked');

    await page.waitForSelector('.app', { timeout: 30000 });

    // Flag OFF (default): no account control anywhere.
    expect(await page.locator('[data-header-accounts]').count()).toBe(0);
    await page.screenshot({ path: 'screenshots/phase44-packaged-flag-off.png' });

    // Flip the flag ON through the real settings IPC (no restart).
    const s = await page.evaluate(() => window.tflex.loadSettings());
    await page.evaluate((next) => window.tflex.saveSettings(next), { ...s, accountsEnabled: true });
    await page.waitForSelector('[data-header-accounts]', { timeout: 10000 });
    expect(await page.locator('[data-header-accounts]').count()).toBe(1);

    // The entry opens the account surface.
    await page.locator('[data-header-accounts]').click();
    await expect(page.locator('[data-animated-dialog="accounts-dialog"]')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/phase44-packaged-flag-on.png' });
  } finally {
    await app.close();
  }
});
