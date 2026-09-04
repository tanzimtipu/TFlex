const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

test.describe('DEF-098 Verification: Thumbnail Jump', () => {
  let electronApp;
  let window;

  const openDocument = async (filePath) => {
    console.log('Opening document:', filePath);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, filePath);
    const openBtn = window.locator('.btn-primary:has-text("Open"), button:has-text("Open PDF")').first();
    await openBtn.click();
    await window.waitForSelector('.workspace', { timeout: 15000 });
    console.log('Workspace loaded');
  };

  test.beforeEach(async () => {
    console.log('Launching DEV build');
    electronApp = await launchApp([], 'default');
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await hardClose(electronApp);
  });

  test('click thumbnail page 10 → document jumps to page 10 and stays there', async () => {
    const sample = getSamplePath('long.pdf');
    await openDocument(sample);

    // Check initial state
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.currentPage).toBe(1);

    // Ensure thumbnails are visible
    const rail = window.locator('.side-rail');
    const thumbTab = window.locator('.rail-tab[title="Page thumbnails"]');
    
    // If side rail isn't visible or doesn't have the active-rail class we expect, click it
    const isRailVisible = await rail.isVisible();
    if (!isRailVisible) {
        await thumbTab.click();
    }

    // Wait for thumbnails to load
    const thumb10 = window.locator('.thumb-item').nth(9);
    await thumb10.scrollIntoViewIfNeeded();
    await expect(thumb10).toBeVisible();

    console.log('Clicking thumbnail 10');
    await thumb10.click();

    // The bug was that it briefly updates then snaps back to 1.
    // So we wait for it to reach 10, then wait a bit more to ensure it STAYS at 10.
    
    console.log('Waiting for currentPage to reach 10');
    await expect.poll(async () => {
      const diag = await window.evaluate(() => window.tflexDiagnostics());
      return diag.currentPage;
    }, { 
        timeout: 10000,
        message: 'Current page did not reach 10'
    }).toBe(10);

    console.log('Page 10 reached. Waiting 2 seconds to ensure no snap-back...');
    await window.waitForTimeout(2000);

    diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('Current page after wait:', diag.currentPage);
    expect(diag.currentPage).toBe(10);

    await window.screenshot({ path: 'screenshots/def-098-verification.png' });
  });
});
