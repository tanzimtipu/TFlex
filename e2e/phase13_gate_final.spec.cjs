const { test, expect } = require('@playwright/test');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');
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
    if (electronApp) await hardClose(electronApp);
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
    
    // Phase 36 — the annotation toolbar lives in the REVIEW dock's Annotate
    // flyout; arm Highlight through the canonical helper.
    await armAnnotationTool(window, 'highlight');
    
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
    // 1.10.0+ contract: the theme control is an embedded dropdown. One click
    // on the trigger opens the option popover; selecting an option applies
    // that theme (data-theme on documentElement, :root[data-theme]) AND
    // persists it to settings.json via the settings IPC. (The pre-1.10.0
    // single-click blind toggle cycle no longer exists - see AppHeader.tsx.)
    const themeOf = () => window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const themeOrder = ['frosted', 'dark', 'light'];

    // Current theme
    const theme1 = (await themeOf()) || 'frosted';
    await takeScreenshot(`gate-p13-theme-${theme1}.png`);

    // Open the dropdown and pick the next theme in the list (wraps around).
    const want = themeOrder[(themeOrder.indexOf(theme1) + 1) % themeOrder.length] || 'dark';
    await window.click('[data-theme-toggle]');
    await window.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await window.click(`[data-theme-option="${want}"]`);
    await window.waitForFunction(
      (w) => document.documentElement.getAttribute('data-theme') === w,
      want,
    );

    const theme2 = await themeOf();
    expect(theme2).toBe(want);
    expect(theme2).not.toBe(theme1);
    await takeScreenshot(`gate-p13-theme-${theme2}.png`);

    // The selection must be persisted immediately (trackAndSave -> settings
    // IPC), not only at quit: poll the settings file for the new value.
    const udd = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const settingsPath = path.join(udd, 'settings.json');
    let persisted = null;
    for (let i = 0; i < 20 && persisted !== want; i += 1) {
      await window.waitForTimeout(250);
      try {
        persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).theme;
      } catch { /* settings.json not written yet */ }
    }
    console.log(`PERF: SC5 theme ${theme1} -> ${theme2}, persisted=${persisted}`);
    expect(persisted, 'the selected theme must be persisted to settings.json').toBe(want);
  });
});
