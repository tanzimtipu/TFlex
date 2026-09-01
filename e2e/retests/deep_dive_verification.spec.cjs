const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test.describe('Final Verification (Installed App) - Deep Dive', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default', EXE_PATH);
    window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 1000 });
    await window.waitForSelector('.welcome, .workspace');
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  async function openSample(name) {
    const selector = `.sample-card:has-text("${name}")`;
    await window.click(selector);
    await window.waitForSelector('.workspace');
    await window.waitForSelector('.page-slot');
    await window.waitForTimeout(2000);
  }

  test('DEF-098: thumbnail click jumps to page 10', async () => {
    await openSample('long.pdf');
    await window.waitForSelector('.thumb-item');
    
    const thumb10 = window.locator('.thumb-item').nth(9); // page 10
    await thumb10.scrollIntoViewIfNeeded();
    await window.waitForTimeout(1000);
    
    const b = await thumb10.boundingBox();
    console.log('Thumb 10 bounding box:', b);
    
    await window.screenshot({ path: 'screenshots/def-098-debug-1.png' });
    
    // Perform the click
    await thumb10.click();
    console.log('Clicked thumb 10');
    
    // Monitor diagnostic for 10 seconds
    for (let i = 0; i < 20; i++) {
        const diag = await window.evaluate(() => window.tflexDiagnostics());
        console.log(`[Tick ${i}] Page: ${diag.currentPage}`);
        if (diag.currentPage === 10) break;
        await window.waitForTimeout(500);
    }
    
    const finalDiag = await window.evaluate(() => window.tflexDiagnostics());
    if (finalDiag.currentPage !== 10) {
        await window.screenshot({ path: 'screenshots/def-098-failed.png' });
    }
    expect(finalDiag.currentPage).toBe(10);
  });

  test('DEF-100: Flatten dialog clickable and backdrop', async () => {
    await openSample('form.pdf');
    await window.waitForTimeout(2000);

    // Open palette
    console.log('Opening Tools palette...');
    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]', { state: 'visible' });
    await window.screenshot({ path: 'screenshots/def-100-palette-open.png' });
    
    // Forms button
    const formsBtn = window.locator('button[data-tool-id="forms"]');
    await expect(formsBtn).toBeEnabled({ timeout: 10000 });
    console.log('Clicking Forms tool...');
    await formsBtn.click();
    
    const backdrop = window.locator('.modal-backdrop');
    await expect(backdrop).toBeVisible();
    
    const flattenBtn = window.locator('.modal-footer button.btn-primary');
    console.log('Checking if Flatten button is clickable...');
    // This should NOT throw intercepted by backdrop error
    await flattenBtn.click();
    
    await expect(backdrop).toBeHidden();
    console.log('Flatten button worked.');
    
    // Re-open for backdrop click test
    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    await window.click('button[data-tool-id="forms"]');
    await expect(backdrop).toBeVisible();
    
    console.log('Testing backdrop click...');
    // Click top-left of the viewport which is guaranteed to be backdrop
    await window.mouse.click(10, 10);
    await expect(backdrop).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-100-pass.png' });
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openSample('report.pdf');
    
    console.log('Creating new tab...');
    const newTabBtn = window.locator('[data-new-tab]');
    await newTabBtn.click();
    
    await window.waitForSelector('.tab.tab-active:has-text("Empty tab")');
    console.log('Empty tab active.');
    
    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    
    const ocrBtn = window.locator('button[data-tool-id="recognizeText"]');
    const isDisabled = await ocrBtn.isDisabled();
    console.log('OCR button isDisabled:', isDisabled);
    
    await window.screenshot({ path: 'screenshots/b11-palette.png' });
    expect(isDisabled).toBe(true);
  });
});
