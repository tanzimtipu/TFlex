const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test.describe('TFlex 20-Bug Comprehensive Verification (Final Refinement)', () => {
  let electronApp;
  let window;

  test.beforeEach(async ({}, testInfo) => {
    console.log(`[TEST] ${testInfo.title}`);
    electronApp = await launchApp([], 'default');
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async ({}, testInfo) => {
    const safeTitle = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const screenshotPath = `screenshots/v3_${safeTitle}.png`;
    await window.screenshot({ path: screenshotPath });
    console.log(`[SCREENSHOT] Saved to ${screenshotPath}`);
    if (electronApp) await hardClose(electronApp);
  });

  async function openSample(sampleName = 'report.pdf') {
    const samplePath = getSamplePath(sampleName);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    
    const openBtn = window.locator('button:has-text("Open PDF")').first();
    await expect(openBtn).toBeVisible({ timeout: 15000 });
    await openBtn.click();
    
    await window.waitForSelector('.workspace', { timeout: 30000 });
    await window.waitForSelector('.pdf-page', { timeout: 30000 });
    return samplePath;
  }

  async function getFirstPageBox() {
    const page = window.locator('.pdf-page').first();
    await page.waitFor({ state: 'visible' });
    return await page.boundingBox();
  }

  test('B1: Sign ghost flow - Cancel exits Sign mode', async () => {
    await openSample('form.pdf');
    await window.click('[aria-label="Sign tool"]');
    await window.waitForSelector('.sig-manager');
    await window.click('.sig-tab:has-text("Type"), .sig-manager >> button:has-text("Type")');
    await window.fill('input[aria-label="Type your signature"], .sig-manager >> input[type="text"]', 'QA B1');
    await window.click('.sig-manager button:text-is("Save")');
    await window.click('.sig-saved-pick');
    
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 100, box.y + 100);
    await window.waitForSelector('[data-sig-action-bar]');
    
    await window.click('[data-sig-action="cancel"]');
    await window.waitForSelector('[data-sig-action-bar]', { state: 'hidden' });
    
    const signBtn = window.locator('[aria-label="Sign tool"]');
    const isPressed = await signBtn.getAttribute('aria-pressed');
    expect(isPressed).toBe('false');
  });

  test('B2: Textbox bar unmounts after confirm', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="textbox"], button[aria-label="Text box"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 300, box.y + 300);
    await window.waitForSelector('[data-annotation-action-bar="textbox"]');
    
    await window.keyboard.type('B2 Verification');
    await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
    await window.waitForSelector('[data-annotation-action-bar="textbox"]', { state: 'hidden', timeout: 5000 });
  });

  test('B3: Custom hex renders in swatch', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="highlight"], button[aria-label="Highlight"]');
    await window.click('.ann-color-swatch-main');
    await window.waitForSelector('[data-color-popover]');
    const hexInput = window.locator('input[data-palette-hex-input]');
    await hexInput.fill('#ff00ff');
    await window.keyboard.press('Enter');
    
    const swatch = window.locator('.ann-color-swatch-main');
    await window.waitForFunction(el => getComputedStyle(el).backgroundColor === 'rgb(255, 0, 255)', await swatch.elementHandle());
    const color = await swatch.evaluate(el => el.style.backgroundColor);
    expect(color).toBe('rgb(255, 0, 255)');
  });

  test('B4: Sticky note content persists', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="note"], button[aria-label="Sticky note"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 150, box.y + 150);
    
    const editor = window.locator('[data-annotation-editor="note"], .ann-note-editor');
    await expect(editor).toBeVisible({ timeout: 10000 });
    
    await editor.locator('textarea').fill('B4 Verification');
    // Button text is "Confirm"
    await window.click('[data-annotation-action="note-confirm"], button:has-text("Confirm")');
    
    const noteIcon = window.locator('.ann-note, .sticky-note-icon, .note-icon').first();
    await expect(noteIcon).toBeVisible();
    await noteIcon.click();
    const content = await editor.locator('textarea').inputValue();
    expect(content).toBe('B4 Verification');
  });

  test('B5/B14: Edit mode disables shape tools', async () => {
    await openSample('report.pdf');
    await window.click('[data-toolbar-edit-toggle]');
    await window.waitForSelector('.edit-toolbar, .workspace-edit-mode', { timeout: 10000 });
    
    const rectBtn = window.locator('button[aria-label="Rectangle"], button[data-tool="rectangle"]');
    expect(await rectBtn.isDisabled()).toBe(true);
  });

  test('B6: Tab close clears active tool state', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="highlight"], button[aria-label="Highlight"]');
    await window.click('.tab-close');
    await window.waitForSelector('.welcome');
    
    // We expect this to FAIL based on analysis
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTool).toBe(null);
  });

  test('B7: Thumbnail jump scrolls to page', async () => {
    await openSample('report.pdf');
    await window.waitForSelector('.thumb[data-page="10"]', { timeout: 10000 });
    await window.click('.thumb[data-page="10"]');
    // We expect this to FAIL based on previous run
    await window.waitForFunction(() => window.tflexDiagnostics().currentPage === 10, { timeout: 5000 });
  });

  test('B8: Close prompt for modified doc', async () => {
    await openSample('report.pdf');
    await window.click('[data-toolbar-rotate-cw], [aria-label="Rotate clockwise"]');
    await window.click('.tab-close');
    await window.waitForSelector('[data-close-prompt], .modal-dialog:has-text("Save")');
    // Answer the prompt (Cancel keeps the tab) so the app is not left
    // sitting on the DEF-142 close gate before teardown.
    await window.click('[data-close-prompt-action="cancel"]');
    await window.waitForSelector('[data-close-prompt]', { state: 'hidden', timeout: 5000 });
  });

  test('B9: DOCX export dialog visibility', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="exportDocx"]');
    await window.waitForSelector('.docx-export-dialog, .modal-dialog:has-text("Word")');
  });

  test('B10: Stamp foreground placement', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="stamp"]');
    await window.waitForSelector('[data-stamp-dialog], .modal-dialog:has-text("Stamp")');
    // Click radio label or input
    await window.click('label:has-text("APPROVED"), input[data-stamp-id="APPROVED"]');
    await window.click('[data-stamp-confirm], button:has-text("Place on page")');
    
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 200, box.y + 200);
    await window.waitForTimeout(1000);
    await expect(window.locator('.stamp-annotation, .stamp-object, [data-annotation-type="stamp"]')).toBeVisible();
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openSample('report.pdf');
    await window.click('[data-new-tab]');
    await window.waitForSelector('.welcome, .empty-tab-content', { timeout: 10000 });
    // Open tools palette via shortcut
    await window.keyboard.press('Control+Shift+P');
    await window.waitForSelector('[data-tools-palette]');
    const btn = window.locator('button[data-tool-id="recognizeText"]');
    await expect(btn).toBeDisabled();
  });

  test('B12: Merge modal inputs present', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="merge"]');
    await window.waitForSelector('.merge-dialog, .modal-dialog, .sheet-content');
    const pageInput = window.locator('input[type="number"], input[name*="Page"], input[aria-label*="page"]');
    await expect(pageInput.first()).toBeVisible();
  });

  test('B13: Dialog hover states (Visual)', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="merge"]');
    await window.waitForSelector('.modal-dialog');
    const closeBtn = window.locator('.modal-close, button[aria-label="Close dialog"], .dialog-close');
    await closeBtn.hover();
    await window.waitForTimeout(500);
  });

  test('B15: Blank page is white', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="insertPages"]');
    await window.waitForSelector('[data-insert-pages-dialog]');
    await window.click('[data-insert-mode="blank"]');
    await window.click('[data-insert-confirm]');
    
    await window.waitForTimeout(2000);
    const pages = window.locator('.pdf-page');
    const lastPage = pages.last();
    await lastPage.scrollIntoViewIfNeeded();
    const bgColor = await lastPage.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(255, 255, 255)');
  });

  test('B16: Crop preview canvas visible', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="cropPages"]');
    await window.waitForSelector('.crop-editor, .modal-dialog:has-text("Crop")');
    await expect(window.locator('.crop-editor canvas, .modal-dialog canvas')).toBeVisible();
  });

  test('B17: Delete page popup', async () => {
    await openSample('report.pdf');
    await window.waitForSelector('.thumb[data-page="1"]');
    await window.click('[data-toolbar-delete-pages], [aria-label="Delete pages"]');
    await window.waitForSelector('.delete-confirm-dialog, .modal-dialog:has-text("Delete")');
  });

  test('B18: Merge block - UI responsive', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="merge"]');
    await window.waitForSelector('.merge-dialog');
    await window.click('button:has-text("Cancel")');
    await window.waitForSelector('.merge-dialog', { state: 'hidden' });
  });

  test('B19: Proxy refresh after flatten (Form fields)', async () => {
    await openSample('form.pdf');
    await window.waitForFunction(() => window.tflexDiagnostics().hasFormFields, { timeout: 10000 });
    
    // Use UI to trigger flatten
    await window.click('[aria-label="Flatten form fields"], button:has-text("Flatten")');
    await window.waitForSelector('.modal-dialog:has-text("Flatten")');
    await window.click('button:has-text("Flatten")');
    
    await window.waitForFunction(() => !window.tflexDiagnostics().hasFormFields, { timeout: 10000 });
  });

  test('B20: Dropdown stability', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    const palette = window.locator('[data-tools-palette], .tools-palette');
    await expect(palette).toBeVisible();
    await window.click('.tools-palette-close, [aria-label="Close tools palette"]');
    await expect(palette).toBeHidden();
  });
});
