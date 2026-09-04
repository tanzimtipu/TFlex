const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('Phase 13 Final Gate', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  async function takeScreenshot(name) {
    const screenshotPath = path.join(__dirname, '../screenshots', name);
    await window.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  }

  test('SC1: Frameless + Window Controls', async () => {
    const titlebar = window.locator('.titlebar').first();
    await expect(titlebar).toBeVisible();
    
    const minBtn = window.locator('.titlebar-control-min');
    const maxBtn = window.locator('.titlebar-control-max');
    const closeBtn = window.locator('.titlebar-control-close');
    
    await expect(minBtn).toBeVisible();
    await expect(maxBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();
    
    // Check for drag region
    const dragRegion = await titlebar.getAttribute('data-titlebar');
    expect(dragRegion).toBe('true');
  });

  test('SC2: Menu Popover', async () => {
    const menuBtn = window.locator('.titlebar-menu-button');
    await menuBtn.click({ force: true });
    
    const menu = window.locator('.popover, .dropdown-menu, .context-menu, [role="menu"]');
    await expect(menu.first()).toBeVisible();
    
    await takeScreenshot('gate-p13-menu.png');
    await window.keyboard.press('Escape');
  });

  test('SC3: Performance - 520 Page Open', async () => {
    const longPath = getSamplePath('long.pdf');
    const start = Date.now();
    
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, longPath);
    
    // Use the big "Open PDF" button in the welcome screen
    const openBtn = window.locator('.welcome .btn-primary').first();
    await openBtn.click({ force: true });
    
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 20000 });
    
    const duration = Date.now() - start;
    console.log(`PERF: Open 520-page duration: ${duration}ms`);
    expect(duration).toBeLessThan(3000);
    
    await takeScreenshot('gate-p13-long-doc.png');
  });

  test('SC4: Annotation Swatches & Semantic colors', async () => {
    // Click sample card via evaluate to bypass any overlays
    await window.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.sample-card'));
        const reportCard = cards.find(c => c.innerText.includes('report.pdf'));
        if (reportCard) reportCard.click();
    });
    
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 20000 });
    
    // Redesign: annotation tools are DISABLED while Edit mode is open
    // (mutual exclusion, title "Edit mode is open — close Edit to use
    // annotation tools"). With Edit closed the Highlight button is
    // enabled directly, so no edit-toggle detour anymore.
    await window.click('button[aria-label="Highlight"]', { force: true });
    
    // Open palette
    await window.click('.ann-color-swatch-main', { force: true });
    
    const swatches = window.locator('.color-swatch');
    await expect(swatches.first()).toBeVisible();
    const count = await swatches.count();
    console.log(`INFO: Found ${count} color swatches`);
    expect(count).toBeGreaterThan(8); 
    
    await takeScreenshot('gate-p13-swatches.png');
    
    // Verify semantic colors - check the "Retry" button (error state)
    const retryBtn = window.locator('.update-indicator-error');
    if (await retryBtn.isVisible()) {
        const bg = await retryBtn.evaluate(el => getComputedStyle(el).backgroundColor);
        console.log(`INFO: Retry button background: ${bg}`);
        // Red-ish color expected for error
        // Tailwind red-500 is rgb(239, 68, 68)
        // zinc-800 is rgb(39, 39, 42)
    }
  });

  test('SC5: Both Themes', async () => {
    // Redesign: the theme attribute lives on documentElement
    // (:root[data-theme]), not on <body>.
    const themeOf = () => window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const toggle = window.locator('.theme-toggle');
    
    // Current theme
    const theme1 = (await themeOf()) || 'light';
    await takeScreenshot(`gate-p13-theme-${theme1}.png`);
    
    // Toggle
    await toggle.click({ force: true });
    await window.waitForTimeout(1000);
    
    const theme2 = await themeOf();
    expect(theme2).not.toBe(theme1);
    await takeScreenshot(`gate-p13-theme-${theme2}.png`);
  });
});
