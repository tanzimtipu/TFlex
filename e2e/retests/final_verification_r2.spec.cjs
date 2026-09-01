const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test.describe('Final Verification (Installed App) - Round 2', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default', EXE_PATH);
    window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 800 });
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
    await window.waitForTimeout(1000);
  }

  test('DEF-097: tab close clears activeTool', async () => {
    await openSample('report.pdf');

    // Wait for annotation toolbar to be present
    await window.waitForSelector('.ann-toolbar');
    
    // Select highlight tool
    const highlightBtn = window.locator('button[data-tool="highlight"]');
    await highlightBtn.waitFor({ state: 'visible' });
    await highlightBtn.click();
    
    // Give it a moment to sync to diagnostics
    await window.waitForTimeout(500);
    
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('DEF-097 activeTool after arm:', diag.activeTool);
    expect(diag.activeTool).toBe('highlight');

    // Close tab
    await window.click('.tab-close');
    await window.waitForSelector('.welcome');
    
    diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('DEF-097 activeTool after close:', diag.activeTool);
    expect(diag.activeTool).toBe(null);
    
    await window.screenshot({ path: 'screenshots/def-097-pass.png' });
  });

  test('DEF-098: thumbnail click jumps to page', async () => {
    await openSample('long.pdf');

    // Wait for thumbs to be visible
    await window.waitForSelector('.thumb-scroller');
    await window.waitForSelector('.thumb-item');
    
    const thumb10 = window.locator('.thumb-item').nth(9); // page 10
    await thumb10.scrollIntoViewIfNeeded();
    await window.waitForTimeout(500); // Let it settle
    
    console.log('Clicking thumb 10...');
    await thumb10.click();
    
    // Wait for jump to complete and currentPage to update in diagnostics
    await window.waitForFunction(() => {
        const d = window.tflexDiagnostics();
        console.log('Current page diagnostic:', d.currentPage);
        return d.currentPage === 10;
    }, { timeout: 15000 });
    
    await window.screenshot({ path: 'screenshots/def-098-pass.png' });
  });

  test('DEF-100: flatten dialog clickable and backdrop behavior', async () => {
    await openSample('form.pdf');

    // Open palette
    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    
    // Find Forms tool
    const formsBtn = window.locator('button[data-tool-id="forms"]');
    await formsBtn.waitFor({ state: 'visible' });
    
    // Check if it is disabled (might happen if fields not detected yet)
    if (await formsBtn.isDisabled()) {
        console.log('Forms button disabled, waiting...');
        await window.waitForFunction(() => !document.querySelector('button[data-tool-id="forms"]').disabled, { timeout: 10000 });
    }
    
    await formsBtn.click();
    
    const backdrop = window.locator('.modal-backdrop');
    await expect(backdrop).toBeVisible();
    
    // Flatten button is clickable
    const flattenBtn = window.locator('.modal-footer button.btn-primary');
    await flattenBtn.click();
    
    await expect(backdrop).toBeHidden();
    
    // Re-open for backdrop test
    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    await window.click('button[data-tool-id="forms"]');
    await expect(backdrop).toBeVisible();
    
    // Click outside (backdrop edge)
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-100-pass.png' });
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openSample('report.pdf');

    // Create empty tab
    await window.click('[data-new-tab]');
    // Corrected selector from Round 1
    await window.waitForSelector('.tab.tab-active:has-text("Empty tab")');

    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    
    const ocrBtn = window.locator('button[data-tool-id="recognizeText"]');
    await expect(ocrBtn).toBeDisabled();
    
    await window.screenshot({ path: 'screenshots/b11-pass.png' });
  });
});
