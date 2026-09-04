const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const installedPath = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test.describe('Comprehensive Bug Verification (B1-B18)', () => {
  let electronApp;
  let window;

  test.beforeEach(async ({}, testInfo) => {
    console.log(`[Test] Starting: ${testInfo.title}`);
    electronApp = await launchApp([], 'default', installedPath);
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
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

  test('B1: Sign UX', async () => {
    await openSample('form.pdf');
    await window.click('[aria-label="Sign tool"]');
    await window.waitForSelector('.sig-manager');
    await window.click('.sig-tab:has-text("Type")');
    await window.fill('input[aria-label="Type your signature"]', 'QA B1');
    await window.click('.sig-manager button:text-is("Save")');
    await window.click('.sig-saved-pick');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 100, box.y + 100);
    await window.waitForSelector('[data-sig-action-bar]');
    await window.click('[data-sig-action="cancel"]');
    await window.waitForSelector('[data-sig-action-bar]', { state: 'hidden' });
    const signBtn = window.locator('[aria-label="Sign tool"]');
    // It should be false, but previous tests showed it stays true.
    const isPressed = await signBtn.getAttribute('aria-pressed');
    console.log(`B1 Outcome: aria-pressed=${isPressed}`);
    expect(isPressed).toBe('false');
  });

  test('B2: Textbox floating bar', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="textbox"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 300, box.y + 300);
    await window.waitForSelector('[data-annotation-action-bar="textbox"]');
    await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
    // Should be hidden, but previous test showed it stays visible.
    const bar = window.locator('[data-annotation-action-bar="textbox"]');
    await window.waitForTimeout(2000);
    const isVisible = await bar.isVisible();
    console.log(`B2 Outcome: isVisible=${isVisible}`);
    expect(isVisible).toBe(false);
  });

  test('B3: Custom hex renders', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="highlight"]');
    await window.click('.ann-color-swatch-main');
    await window.waitForSelector('[data-color-popover]');
    const hexInput = window.locator('input[data-palette-hex-input]');
    await hexInput.fill('#ff00ff');
    await window.keyboard.press('Enter');
    const swatch = window.locator('.ann-color-swatch-main');
    await window.waitForFunction(el => el.style.backgroundColor === 'rgb(255, 0, 255)', await swatch.elementHandle());
    const color = await swatch.evaluate(el => el.style.backgroundColor);
    console.log(`B3 Outcome: color=${color}`);
    expect(color).toBe('rgb(255, 0, 255)');
  });

  test('B4: Sticky note content', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="note"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 150, box.y + 150);
    await window.waitForSelector('[data-annotation-editor="note"]');
    await window.fill('[data-annotation-editor="note"] textarea', 'B4 Content');
    await window.click('button:has-text("Add note")');
    await expect(window.locator('.sticky-note-icon')).toBeVisible();
    console.log('B4 Outcome: PASS');
  });

  test('B6: Tab close clears state', async () => {
    await openSample('report.pdf');
    await window.click('button[data-tool="highlight"]');
    await window.click('.tab-close');
    await window.waitForSelector('.welcome');
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log(`B6 Outcome: activeTool=${diag.activeTool}`);
    expect(diag.activeTool == null).toBe(true);
  });

  test('B7: Thumbnail jump', async () => {
    await openSample('report.pdf');
    await window.click('.thumb[data-page="5"]');
    await window.waitForFunction(() => window.tflexDiagnostics().currentPage === 5, { timeout: 5000 });
    console.log('B7 Outcome: PASS');
  });

  test('B8: Close prompt', async () => {
    await openSample('report.pdf');
    await window.click('[aria-label="Rotate clockwise"]');
    await window.click('.tab-close');
    await window.waitForSelector('[data-close-prompt]');
    // Answer the prompt (Cancel keeps the tab) so the app is not left
    // sitting on the DEF-142 close gate before teardown.
    await window.click('[data-close-prompt-action="cancel"]');
    await window.waitForSelector('[data-close-prompt]', { state: 'hidden', timeout: 5000 });
    console.log('B8 Outcome: PASS');
  });

  test('B9: DOCX dialog', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('button[data-tool-id="exportDocx"]');
    await window.waitForSelector('.docx-export-dialog');
    console.log('B9 Outcome: PASS');
  });

  test('B11: OCR empty tab', async () => {
    await openSample('report.pdf'); // Open one to show '+'
    await window.click('[data-new-tab]');
    await window.click('[data-tools-toggle]');
    const btn = window.locator('button[data-tool-id="ocrSuspects"]');
    await expect(btn).toBeDisabled();
    console.log('B11 Outcome: PASS');
  });

  test('B12: Merge dialog', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('button[data-tool-id="merge"]');
    await window.waitForSelector('.merge-dialog');
    await expect(window.locator('input[name="afterPage"]')).toBeVisible();
    console.log('B12 Outcome: PASS');
  });

  test('B15: Flatten refreshes proxy', async () => {
    await openSample('form.pdf');
    // Ensure fields loaded
    await window.waitForFunction(() => window.tflexDiagnostics().hasFormFields, { timeout: 10000 });
    await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.webContents.send('menu:action', { action: 'flattenForms' });
    });
    await window.waitForFunction(() => !window.tflexDiagnostics().hasFormFields, { timeout: 10000 });
    console.log('B15 Outcome: PASS');
  });

  test('B16: Crop preview', async () => {
    await openSample('report.pdf');
    await window.click('[data-tools-toggle]');
    await window.click('button[data-tool-id="cropPages"]');
    await window.waitForSelector('.crop-editor');
    await expect(window.locator('.crop-editor-canvas')).toBeVisible();
    console.log('B16 Outcome: PASS');
  });

  test('B17: Replace refreshes proxy', async () => {
    await openSample('report.pdf');
    const initial = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;
    const other = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, other);
    await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.webContents.send('menu:action', { action: 'replacePages' });
    });
    await window.waitForFunction((init) => window.tflexDiagnostics().pageCount !== init, initial, { timeout: 10000 });
    console.log('B17 Outcome: PASS');
  });
});
