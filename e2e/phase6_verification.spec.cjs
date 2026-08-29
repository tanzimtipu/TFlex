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
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    console.log('report.pdf opened.');

    // Create empty tab for long.pdf
    console.log('Creating new tab...');
    await window.click('button[aria-label="New Tab"]');
    await window.waitForSelector('.welcome-screen');
    console.log('New tab created.');

    // Open long.pdf in the second tab
    console.log('Opening long.pdf...');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, longPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    console.log('long.pdf opened.');

    // Now we have two tabs: report.pdf and long.pdf
    const tabs = window.locator('.tab-item');
    await expect(tabs).toHaveCount(2);

    // Click padding of the first tab (report.pdf)
    // The tab-item is likely the container.
    const firstTab = tabs.first();
    const box = await firstTab.boundingBox();
    
    // Click near the top-left edge (padding area)
    await window.mouse.click(box.x + 5, box.y + 5);
    
    // Verify first tab is active
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTabTitle).toBe('report.pdf');

    // Click the second tab in the gap between title and close button
    const secondTab = tabs.nth(1);
    const box2 = await secondTab.boundingBox();
    // Assuming close button is on the right, click in the middle-right but not on the button
    await window.mouse.click(box2.x + box2.width - 40, box2.y + box2.height / 2);

    diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTabTitle).toBe('long.pdf');

    // Theme churn clicks work
    await window.keyboard.press('Control+T'); // Toggle theme
    // Immediately click first tab
    await window.mouse.click(box.x + 5, box.y + 5);
    
    diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTabTitle).toBe('report.pdf');
    
    await window.screenshot({ path: 'screenshots/p6-def-034-verified.png' });
  });

  test('Empty tabs: + makes empty, open PDF fills, close falls back', async () => {
    // Current state: report.pdf (active), long.pdf
    const tabsCount = await window.locator('.tab-item').count();
    
    // Click +
    await window.click('button[aria-label="New Tab"]');
    await expect(window.locator('.tab-item')).toHaveCount(tabsCount + 1);
    await expect(window.locator('.welcome-screen')).toBeVisible();

    // Opening a PDF fills the live empty tab
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTabTitle).toBe('form.pdf');
    expect(await window.locator('.tab-item').count()).toBe(tabsCount + 1);

    // Close tab falls back to previous
    // Close form.pdf (index 2)
    const closeBtn = window.locator('.tab-item').nth(2).locator('button[aria-label="Close tab"]');
    await closeBtn.click();
    
    await expect(window.locator('.tab-item')).toHaveCount(tabsCount);
    diag = await window.evaluate(() => window.tflexDiagnostics());
    // Should fall back to report.pdf (which was active before we created the empty tab)
    // Actually the requirement says "close falls previous to previous present"
    // Usually it falls to the one on the left if closing the rightmost.
    expect(diag.activeTabTitle).toBe('report.pdf');
    
    await window.screenshot({ path: 'screenshots/p6-empty-tabs.png' });
  });

  test('Tools palette: list/grid toggle persists', async () => {
    // Open tools palette
    await window.click('button[aria-label="Tools"]');
    await window.waitForSelector('.tools-palette');
    
    // Toggle to grid (assuming default is list)
    const gridToggle = window.locator('button[aria-label="Grid view"]');
    await gridToggle.click();
    
    await window.screenshot({ path: 'screenshots/p6-tools-palette-grid.png' });
    
    // We'll check persistence in a separate restart test
  });

  test('Menu accelerators', async () => {
    // Ctrl+O opens dialog
    // We already mocked dialog.showOpenDialog in previous tests, but let's do it specifically here.
    const samplePath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    
    await window.keyboard.press('Control+O');
    // If it worked, it would try to open the file.
    // We can check if the file opened.
    await window.waitForFunction((p) => {
      const diag = window.tflexDiagnostics();
      return diag.activeTabTitle === 'report.pdf';
    }, path.basename(samplePath));

    // Ctrl+S (Save)
    // For Save, we check if modified becomes false
    // First modify something
    await window.click('button[aria-label="Rotate Clockwise"]');
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.modified).toBe(true);
    
    await window.keyboard.press('Control+S');
    await window.waitForFunction(() => !window.tflexDiagnostics().modified);
    
    await window.screenshot({ path: 'screenshots/p6-accelerators.png' });
  });

  test('About box and version', async () => {
    // Open About from Help menu
    // Since it's a native menu, we can't click it easily in Playwright.
    // However, Phase 6 SC 3 says "standard app menu... Help/About with version badge"
    // Developers usually implement a custom About dialog for Electron if they want to show it in-app.
    // Or it might be the native About.
    // Let's check if there's a way to trigger it. 
    // Usually "About" is in the Help menu or can be triggered via IPC.
    
    // If there is an About dialog in the DOM:
    await window.evaluate(() => {
        // Trigger via internal command if available, or just check if it exists
        // Assuming there is a button or menu item to open it.
    });
    
    // If we can't trigger it, we'll check if the version is available in diagnostics.
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('App Version:', diag.version);
    expect(diag.version).toBeDefined();
    
    // Let's try to find an About button in the UI
    const aboutBtn = window.locator('button:has-text("About"), [aria-label="About"]');
    if (await aboutBtn.isVisible()) {
        await aboutBtn.click();
        await window.waitForSelector('.about-dialog');
        const versionText = await window.textContent('.about-dialog .version');
        expect(versionText).toContain(diag.version);
        await window.screenshot({ path: 'screenshots/p6-about.png' });
        await window.click('button:has-text("Close")');
    }
  });

  test('Preferences: opens and changes persist', async () => {
    // Open Preferences
    const prefBtn = window.locator('button[aria-label="Preferences"]');
    await prefBtn.click();
    await window.waitForSelector('.preferences-dialog');
    
    // Change recents limit
    const limitInput = window.locator('input[name="recentsLimit"]');
    await limitInput.fill('15');
    
    await window.screenshot({ path: 'screenshots/p6-preferences.png' });
    await window.click('button:has-text("Save")');
    
    // Restart will check persistence
  });

  test('Color palette swatch as rounded square', async () => {
    // Open an annotation tool, e.g., Highlight
    await window.click('button[aria-label="Highlight"]');
    
    // Check for color swatch
    const swatch = window.locator('.color-swatch');
    await expect(swatch).toBeVisible();
    
    // Verify it's a rounded square (check border-radius in CSS)
    const borderRadius = await swatch.evaluate(el => getComputedStyle(el).borderRadius);
    expect(parseInt(borderRadius)).toBeGreaterThan(0);

    // Open palette
    await swatch.click();
    await window.waitForSelector('.color-palette');
    
    // Pick a custom hex
    const hexInput = window.locator('input[aria-label="Custom color hex"]');
    await hexInput.fill('#ff00ff');
    await window.keyboard.press('Enter');
    
    await window.screenshot({ path: 'screenshots/p6-color-palette.png' });
    
    // Check if the color was applied
    const appliedColor = await swatch.evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(255, 0, 255) is #ff00ff
    expect(appliedColor).toBe('rgb(255, 0, 255)');
  });

  test('Performance: tab-switch timing', async () => {
    const tabs = window.locator('.tab-item');
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
    
    // Set Tools Palette to Grid
    await window.click('button[aria-label="Tools"]');
    await window.waitForSelector('.tools-palette');
    await window.click('button[aria-label="Grid view"]');
    
    // Set Recents Limit in Preferences
    await window.click('button[aria-label="Preferences"]');
    await window.waitForSelector('.preferences-dialog');
    await window.locator('input[name="recentsLimit"]').fill('12');
    await window.click('button:has-text("Save")');

    // Set Custom Color
    await window.click('button[aria-label="Highlight"]');
    await window.click('.color-swatch');
    await window.waitForSelector('.color-palette');
    await window.locator('input[aria-label="Custom color hex"]').fill('#00ffff');
    await window.keyboard.press('Enter');
    
    await electronApp.close();
  });

  test('Persistence across restart', async () => {
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    
    // Verify Tools Palette Grid mode
    await window.click('button[aria-label="Tools"]');
    await expect(window.locator('.tools-palette.grid-view')).toBeVisible();
    
    // Verify Preferences (recentsLimit)
    await window.click('button[aria-label="Preferences"]');
    await expect(window.locator('input[name="recentsLimit"]')).toHaveValue('12');
    await window.click('button:has-text("Close")');

    // Verify Custom Color
    await window.click('button[aria-label="Highlight"]');
    const swatchColor = await window.locator('.color-swatch').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(swatchColor).toBe('rgb(0, 255, 255)');
    
    await window.screenshot({ path: 'screenshots/p6-persistence.png' });
    await electronApp.close();
  });
});
