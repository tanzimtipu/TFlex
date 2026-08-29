const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

test.setTimeout(180000);

test('Phase 5 walkthrough both themes', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 800 });
  await window.waitForFunction(() => typeof window.tflexDiagnostics === 'function', { timeout: 20000 });

  const themes = ['light', 'dark'];
  const projectRoot = path.resolve(process.cwd());
  const screenshotsDir = path.join(projectRoot, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  
  for (const theme of themes) {
    console.log(`Starting walkthrough for theme: ${theme}`);
    
    // Set theme
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    if (diag.theme !== theme) {
      await window.click('.theme-toggle');
      await window.waitForTimeout(1000);
    }
    
    // 1. Welcome screen
    // Close all tabs to get back to welcome screen
    let tabsCount = await window.evaluate(() => window.tflexDiagnostics().openTabs);
    while (tabsCount > 0) {
      await window.click('.tab-close');
      await window.waitForTimeout(500);
      tabsCount = await window.evaluate(() => window.tflexDiagnostics().openTabs);
    }
    
    await window.waitForSelector('.welcome', { timeout: 10000 });
    await window.screenshot({ path: path.join(screenshotsDir, `p5-welcome-${theme}.png`) });
    
    // 2. Doc Open
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.screenshot({ path: path.join(screenshotsDir, `p5-doc-open-${theme}.png`) });
    
    // 3. Rail 3 tabs
    // Thumbnails (default)
    await window.screenshot({ path: path.join(screenshotsDir, `p5-rail-thumbnails-${theme}.png`) });
    
    // Annotations
    await window.click('button[title="Annotations"]');
    await window.waitForSelector('.ann-panel');
    await window.screenshot({ path: path.join(screenshotsDir, `p5-rail-annotations-${theme}.png`) });
    
    // Bookmarks (Outline)
    // Close current tab and open report.pdf
    await window.click('.tab-close');
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    // Wait for outline to load and button to appear
    await window.waitForTimeout(2000);
    const bookmarksBtn = window.locator('button[title="Bookmarks"]');
    if (await bookmarksBtn.isVisible()) {
      await bookmarksBtn.click();
      await window.waitForSelector('.outline-panel', { timeout: 10000 });
      await window.screenshot({ path: path.join(screenshotsDir, `p5-rail-bookmarks-${theme}.png`) });
    } else {
      console.warn(`Bookmarks button not visible for report.pdf in ${theme} theme`);
      await window.screenshot({ path: path.join(screenshotsDir, `p5-rail-no-bookmarks-${theme}.png`) });
    }
    
    // 4. Toolbar Zoom/Search
    await window.click('button[title*="Find in document"]');
    await window.fill('.search-input', 'report');
    await window.waitForTimeout(2000);
    await window.screenshot({ path: path.join(screenshotsDir, `p5-toolbar-search-${theme}.png`) });
    
    // Zoom buttons
    await window.screenshot({ path: path.join(screenshotsDir, `p5-toolbar-zoom-${theme}.png`) });

    // 5. Annotation tools + panel
    await window.click('button[data-tool="highlight"]');
    await window.waitForSelector('.pdf-page[data-page="1"] .textLayer span, .pdf-page[data-page="1"] .textLayer div');
    const textRect = await window.evaluate(() => {
      const el = document.querySelector('.pdf-page[data-page="1"] .textLayer span');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    if (textRect) {
      await window.mouse.move(textRect.x, textRect.y);
      await window.mouse.down();
      await window.mouse.move(textRect.x + textRect.width, textRect.y + textRect.height);
      await window.mouse.up();
    }
    await window.click('button[title="Annotations"]');
    await window.waitForSelector('.ann-panel-row');
    await window.screenshot({ path: path.join(screenshotsDir, `p5-annotations-${theme}.png`) });

    // 6. Forms editors positioned
    await window.click('.tab-close');
    const formPath2 = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath2);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForFunction(() => window.tflexDiagnostics().formFieldsLoaded, { timeout: 20000 });
    await window.screenshot({ path: path.join(screenshotsDir, `p5-forms-editors-${theme}.png`) });

    // 7. Signature manager + placement
    await window.click('button[title*="Sign"]');
    await window.waitForSelector('.sig-manager');
    await window.screenshot({ path: path.join(screenshotsDir, `p5-sig-manager-${theme}.png`) });
    
    await window.click('.modal-tabs button:has-text("Type")');
    await window.fill('input.sig-type-input', 'QA Signature');
    await window.click('.sig-tab-actions button:has-text("Save")');
    await window.waitForSelector('.sig-saved-pick');
    await window.locator('.sig-saved-pick').first().click();
    
    await window.waitForSelector('.signatures-layer[data-armed="true"]');
    await window.mouse.click(400, 400);
    await window.waitForTimeout(1000);
    await window.screenshot({ path: path.join(screenshotsDir, `p5-sig-placement-${theme}.png`) });

    // 8. Error messages (Optional)
    try {
      // Close all tabs to get back to welcome screen
      let tabsCount2 = await window.evaluate(() => window.tflexDiagnostics().openTabs);
      while (tabsCount2 > 0) {
        await window.click('.tab-close');
        await window.waitForTimeout(500);
        tabsCount2 = await window.evaluate(() => window.tflexDiagnostics().openTabs);
      }
      await window.waitForSelector('.welcome', { timeout: 10000 });

      const dummyPath = path.join(os.tmpdir(), `dummy-${Date.now()}.txt`);
      fs.writeFileSync(dummyPath, 'not a pdf');
      await electronApp.evaluate(async ({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, dummyPath);
      await window.click('button:has-text("Open PDF")');
      await window.waitForSelector('.toast.toast-error', { timeout: 10000 });
      await window.screenshot({ path: path.join(screenshotsDir, `p5-error-toast-${theme}.png`) });
      if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
    } catch (e) {
      console.warn(`Error toast walkthrough failed: ${e.message}`);
    }
  }

  await electronApp.close();
});
