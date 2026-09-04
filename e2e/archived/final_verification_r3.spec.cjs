const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

test.describe('Final Verification (dev build) - Round 3', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default');
    window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 1000 });
    await window.waitForSelector('.welcome, .workspace');
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  async function openSample(name) {
    const selector = `.sample-card:has-text("${name}")`;
    await window.click(selector);
    await window.waitForSelector('.workspace');
    await window.waitForSelector('.page-slot');
    await window.waitForTimeout(1000);
  }

  test('DEF-098: thumbnail click jumps to page', async () => {
    await openSample('long.pdf');
    await window.waitForSelector('.thumb-item');
    
    const thumb10 = window.locator('.thumb-item').nth(9); // page 10
    await thumb10.scrollIntoViewIfNeeded();
    await window.waitForTimeout(500);
    
    await window.screenshot({ path: 'screenshots/def-098-before-click.png' });
    console.log('Clicking thumb 10...');
    await thumb10.click();
    
    // Wait for jump
    for (let i = 0; i < 20; i++) {
        const diag = await window.evaluate(() => window.tflexDiagnostics());
        console.log(`Page at tick ${i}: ${diag.currentPage}`);
        if (diag.currentPage === 10) break;
        await window.waitForTimeout(500);
    }
    
    const finalDiag = await window.evaluate(() => window.tflexDiagnostics());
    expect(finalDiag.currentPage).toBe(10);
    
    await window.screenshot({ path: 'screenshots/def-098-pass.png' });
  });

  test('DEF-100: flatten dialog clickable and backdrop behavior', async () => {
    await openSample('form.pdf');

    // Wait for fields to load (host calls engine.getFormFields)
    await window.waitForTimeout(2000);

    console.log('Opening palette...');
    await window.click('[data-tools-toggle]', { force: true });
    await window.waitForSelector('[data-tools-palette]');
    
    const formsBtn = window.locator('button[data-tool-id="forms"]');
    await formsBtn.waitFor({ state: 'visible' });
    
    // If disabled, wait for fields
    if (await formsBtn.isDisabled()) {
        console.log('Forms button disabled, waiting for fields...');
        await window.waitForFunction(() => !document.querySelector('button[data-tool-id="forms"]').disabled, { timeout: 10000 });
    }
    
    await formsBtn.click();
    
    const backdrop = window.locator('.modal-backdrop');
    await expect(backdrop).toBeVisible();
    
    await window.screenshot({ path: 'screenshots/def-100-dialog-visible.png' });
    
    // Flatten button is clickable
    const flattenBtn = window.locator('.modal-footer button.btn-primary');
    await flattenBtn.click();
    
    await expect(backdrop).toBeHidden();
    
    // Re-open for backdrop test
    await window.click('[data-tools-toggle]', { force: true });
    await window.waitForSelector('[data-tools-palette]');
    await window.click('button[data-tool-id="forms"]');
    await expect(backdrop).toBeVisible();
    
    console.log('Clicking backdrop...');
    const box = await backdrop.boundingBox();
    await window.mouse.click(box.x + 5, box.y + 5);
    await expect(backdrop).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-100-pass.png' });
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openSample('report.pdf');

    console.log('Creating empty tab...');
    await window.click('[data-new-tab]');
    await window.waitForSelector('.tab.tab-active');
    
    const tabTitle = await window.locator('.tab.tab-active .tab-title').textContent();
    console.log('Active tab title:', tabTitle);
    
    await window.click('[data-tools-toggle]', { force: true });
    await window.waitForSelector('[data-tools-palette]');
    
    const ocrBtn = window.locator('button[data-tool-id="recognizeText"]');
    await expect(ocrBtn).toBeDisabled();
    
    await window.screenshot({ path: 'screenshots/b11-pass.png' });
  });
});
