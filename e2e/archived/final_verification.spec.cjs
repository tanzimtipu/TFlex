const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

test.describe('Final Verification (dev build)', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default');
    window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 800 });
    await window.waitForSelector('.welcome, .workspace');
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  async function openSample(name) {
    const selector = `.sample-card:has-text("${name}")`;
    await window.click(selector);
    await window.waitForSelector('.workspace');
    // Wait for PDF to load into the scroller
    await window.waitForSelector('.page-slot');
    await window.waitForTimeout(1000);
  }

  test('DEF-095: textbox bar unmounts and commits', async () => {
    await openSample('report.pdf');

    // Click Text Box tool in the annotation toolbar (bottom left usually)
    const tbBtn = window.locator('button[data-tool="textbox"]');
    await tbBtn.click();
    
    // Click page to place
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 100, box.y + 100);

    // Wait for editor
    await window.waitForSelector('[data-annotation-editor="textbox"]');
    await window.fill('[data-annotation-editor="textbox"]', 'DEF-095 Committed');
    
    // Click Confirm on the floating bar
    const confirmBtn = window.locator('button[data-annotation-action="textbox-confirm"]');
    await confirmBtn.click();
    
    // Assert bar unmounted
    await expect(window.locator('[data-annotation-action-bar="textbox"]')).toBeHidden();
    await expect(window.locator('[data-annotation-editor-wrap="textbox"]')).toBeHidden();
    
    // Verify committed in engine state
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    const tb = diag.engineState.annotations.find(a => a.kind === 'textbox');
    expect(tb).toBeDefined();
    expect(tb.text).toBe('DEF-095 Committed');
    
    await window.screenshot({ path: 'screenshots/def-095-pass.png' });
  });

  test('DEF-096: sticky note click icon opens editor pre-filled', async () => {
    await openSample('report.pdf');

    // Requirement: locator must use [data-tool="note"]
    await window.click('button[data-tool="note"]');
    
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 150, box.y + 150);

    await window.waitForSelector('[data-annotation-editor="note"]');
    await window.fill('[data-annotation-editor="note"] textarea', 'DEF-096 Pre-filled Content');
    await window.click('button[data-annotation-action="note-confirm"]');

    const noteIcon = window.locator('.ann-note[data-kind="note"]').first();
    await expect(noteIcon).toBeVisible();
    
    // Click icon to reopen
    await noteIcon.click();
    
    await window.waitForSelector('[data-annotation-editor="note"]');
    const content = await window.inputValue('[data-annotation-editor="note"] textarea');
    expect(content).toBe('DEF-096 Pre-filled Content');
    
    // Delete works
    await window.click('button[data-annotation-action="note-delete"]');
    await expect(noteIcon).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-096-pass.png' });
  });

  test('DEF-097: tab close clears activeTool', async () => {
    await openSample('report.pdf');

    await window.click('button[data-tool="highlight"]');
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTool).toBe('highlight');

    // Close tab
    await window.click('.tab-close');
    await window.waitForSelector('.welcome');
    
    diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTool).toBe(null);
    
    await window.screenshot({ path: 'screenshots/def-097-pass.png' });
  });

  test('DEF-098: thumbnail click jumps to page', async () => {
    await openSample('long.pdf');

    // Thumbs load async, wait a bit
    await window.waitForSelector('.thumb-item');
    
    const thumb10 = window.locator('.thumb-item').nth(9); // page 10
    await thumb10.scrollIntoViewIfNeeded();
    
    console.log('Clicking thumb 10...');
    await thumb10.click();
    
    // Wait for jump to complete and currentPage to update
    await window.waitForFunction(() => window.tflexDiagnostics().currentPage === 10, { timeout: 10000 });
    
    await window.screenshot({ path: 'screenshots/def-098-pass.png' });
  });

  test('DEF-099: blank page background is white', async () => {
    await openSample('report.pdf');

    // Ensure dark theme
    await window.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
    });

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="insertPages"]');
    
    await window.waitForSelector('[data-insert-pages-dialog]');
    await window.click('[data-insert-confirm]'); // "Blank page" is default
    
    // Wait for new page slot to appear
    await window.waitForTimeout(2000);
    
    const lastPage = window.locator('.page-slot').last();
    await lastPage.scrollIntoViewIfNeeded();
    
    const bgColor = await lastPage.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(255, 255, 255)');
    
    await window.screenshot({ path: 'screenshots/def-099-pass.png' });
  });

  test('DEF-100: flatten dialog clickable and backdrop behavior', async () => {
    await openSample('form.pdf');

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="forms"]');
    
    const backdrop = window.locator('.modal-backdrop');
    await expect(backdrop).toBeVisible();
    
    // Flatten button is clickable
    const flattenBtn = window.locator('.modal-footer button.btn-primary');
    await flattenBtn.click();
    
    await expect(backdrop).toBeHidden();
    
    // Re-open for backdrop test
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="forms"]');
    await expect(backdrop).toBeVisible();
    
    // Click outside (backdrop edge)
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-100-pass.png' });
  });

  test('B10: stamp visible after placement', async () => {
    await openSample('report.pdf');

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="stamp"]');
    
    await window.waitForSelector('[data-stamp-dialog]');
    await window.click('[data-stamp-id="APPROVED"]');
    await window.click('[data-stamp-confirm]');
    
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 100, box.y + 100);
    
    // Should be visible via .stamp-annotation
    await expect(window.locator('.stamp-annotation')).toBeVisible();
    await window.screenshot({ path: 'screenshots/b10-pass.png' });
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openSample('report.pdf');

    // Create empty tab
    await window.click('[data-new-tab]');
    await window.waitForSelector('.tab-item-active:has-text("Empty tab")');

    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    
    const ocrBtn = window.locator('button[data-tool-id="recognizeText"]');
    await expect(ocrBtn).toBeDisabled();
    
    await window.screenshot({ path: 'screenshots/b11-pass.png' });
  });
});
