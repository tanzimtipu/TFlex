const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test.describe('Phase 6 Verification', () => {
  let electronApp;
  let window;
  const userDataDir = path.join(os.tmpdir(), `tflex-p6-test-${Date.now()}`);

  test.beforeAll(async () => {
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    window.on('console', msg => console.log('RENDERER:', msg.text()));
    await window.waitForSelector('.welcome:visible');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('DEF-034: Tab switching on padding/gap clicks', async () => {
    // Open two docs
    const reportPath = getSamplePath('report.pdf');
    const longPath = getSamplePath('long.pdf');
    
    // Open report.pdf
    console.log('Opening report.pdf...');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('.welcome button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');
    console.log('report.pdf opened.');

    // Create empty tab for long.pdf
    console.log('Creating new tab...');
    await window.click('button[aria-label="New empty tab"]');
    await window.waitForSelector('.welcome:visible');
    console.log('New tab created.');

    // Open long.pdf in the second tab
    console.log('Opening long.pdf...');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, longPath);
    await window.click('.welcome button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible', { timeout: 60000 });
    console.log('long.pdf opened.');

    // Now we have two tabs: report.pdf and long.pdf
    const tabs = window.locator('.tab');
    await expect(tabs).toHaveCount(2);

    // Click padding of the first tab (report.pdf)
    const firstTab = tabs.first();
    const box = await firstTab.boundingBox();
    
    // Click near the top-left edge (padding area)
    await window.mouse.click(box.x + 5, box.y + 5);
    
    // Verify first tab is active
    const activeTab = window.locator('.tab.tab-active');
    await expect(activeTab).toContainText('report.pdf');

    // Click the second tab in the gap between title and close button
    const secondTab = tabs.nth(1);
    const box2 = await secondTab.boundingBox();
    // Assuming close button is on the right, click in the middle-right but not on the button
    await window.mouse.click(box2.x + box2.width - 40, box2.y + box2.height / 2);

    await expect(window.locator('.tab.tab-active')).toContainText('long.pdf');
    
    // SC 1: Empty tabs
    // Current state: report.pdf, long.pdf (active)
    const tabsCount = await window.locator('.tab').count();
    
    // Click +
    await window.click('button[aria-label="New empty tab"]');
    await expect(window.locator('.tab')).toHaveCount(tabsCount + 1);
    await expect(window.locator('.welcome')).toBeVisible();

    // Opening a PDF fills the live empty tab
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('.welcome button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');
    
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    await expect(window.locator('.tab.tab-active')).toContainText('form.pdf');
    expect(await window.locator('.tab').count()).toBe(tabsCount + 1);

    // Close tab falls back to previous
    const closeBtn = window.locator('.tab').nth(2).locator('button.tab-close');
    await closeBtn.click();
    
    await expect(window.locator('.tab')).toHaveCount(tabsCount);
    await expect(window.locator('.tab.tab-active')).toContainText('long.pdf'); // long was active before +
    
    // Tools Palette
    await window.click('button[aria-label="Tools palette"]:visible');
    await window.waitForSelector('.tools-palette:visible');
    await window.click('button[aria-label="Grid layout"]:visible');
    await expect(window.locator('.tools-palette:visible')).toHaveClass(/tools-palette-grid/);
    
    // Accelerators
    await window.click('button[aria-label="Rotate clockwise"]:visible');
    await expect(window.locator('.tab.tab-active .tab-modified-dot')).toBeVisible();
    await window.keyboard.press('Control+S');
    await expect(window.locator('.tab.tab-active .tab-modified-dot')).not.toBeVisible();

    // Preferences
    await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        win.webContents.send('menu:action', { action: 'preferences' });
    });
    await window.waitForSelector('[data-prefs-dialog]:visible');
    await window.fill('[data-prefs-recents-cap]:visible', '15');
    await window.click('button[aria-label="Close preferences"]:visible');

    // Color Palette
    await window.click('button[aria-label="Highlight"]:visible');
    const swatch = window.locator('.ann-color-swatch-main:visible');
    await swatch.click();
    await window.waitForSelector('.color-palette:visible');
    
    // Pick a custom color via the pad (Phase 7 visual picker)
    await window.click('[data-palette-pad]:visible');
    const pickedHex = (await window.textContent('.color-palette-hex:visible')).trim();
    console.log(`Picked custom color: ${pickedHex}`);
    await window.click('[data-palette-add]:visible');

    // Apply it by clicking the new swatch
    await window.click(`[data-palette-custom="${pickedHex}"]:visible`);
    const appliedColor = await swatch.evaluate(el => getComputedStyle(el).backgroundColor);
    // Convert hex to rgb for comparison if needed, but appliedColor is rgb
    console.log(`Applied color: ${appliedColor}`);
    expect(appliedColor).not.toBe('rgb(255, 255, 0)'); // Default highlight is yellow


    console.log('Phase 6 verification complete.');
  });

  test('Performance: tab-switch timing', async () => {
    const tabs = window.locator('.tab');
    const start = Date.now();
    await tabs.first().click();
    const end = Date.now();
    const duration = end - start;
    console.log(`Tab switch duration: ${duration}ms`);
    expect(duration).toBeLessThan(300);
  });
});

test.describe('Phase 6 Persistence Verification (Restart)', () => {
  let electronApp;
  let window;
  const userDataDir = path.join(os.tmpdir(), `tflex-p6-test-persistence`);

  test.beforeAll(async () => {
    // First run to set values
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome:visible');
    
    // Open a document so toolbar is visible
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');
    
    // Set Tools Palette to Grid
    await window.click('button[aria-label="Tools palette"]:visible');
    await window.waitForSelector('.tools-palette:visible');
    await window.click('button[aria-label="Grid layout"]:visible');
    
    // Set Recents Limit in Preferences
    await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        win.webContents.send('menu:action', { action: 'preferences' });
    });
    await window.waitForSelector('[data-prefs-dialog]:visible');
    await window.fill('[data-prefs-recents-cap]:visible', '12');
    await window.click('button[aria-label="Close preferences"]:visible');

    // Set Custom Color
    await window.click('button[aria-label="Highlight"]:visible');
    await window.click('.ann-color-swatch-main:visible');
    await window.waitForSelector('.color-palette:visible');
    await window.click('[data-palette-pad]:visible');
    const persistedHex = (await window.textContent('.color-palette-hex:visible')).trim();
    await window.click('[data-palette-add]:visible');
    // Apply it
    await window.click(`[data-palette-custom="${persistedHex}"]:visible`);
    
    await electronApp.close();
  });

  test('Persistence across restart', async () => {
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome:visible');

    // Open document to see toolbar
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');
    
    // Verify Tools Palette Grid mode
    await window.click('button[aria-label="Tools palette"]:visible');
    await expect(window.locator('.tools-palette:visible')).toHaveClass(/tools-palette-grid/);
    
    // Verify Preferences (recentsLimit)
    await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        win.webContents.send('menu:action', { action: 'preferences' });
    });
    await window.waitForSelector('[data-prefs-dialog]:visible');
    await expect(window.locator('[data-prefs-recents-cap]:visible')).toHaveValue('12');
    await window.click('button[aria-label="Close preferences"]:visible');

    // Verify Custom Color (should still be applied as the active tool color)
    await window.click('button[aria-label="Highlight"]:visible');
    const swatchColor = await window.locator('.ann-color-swatch-main:visible').evaluate(el => getComputedStyle(el).backgroundColor);
    console.log(`Verifying persisted color: ${swatchColor}`);
    expect(swatchColor).not.toBe('rgb(255, 255, 0)');

    
    await window.screenshot({ path: 'screenshots/p6-persistence.png' });
    await electronApp.close();
  });
});
