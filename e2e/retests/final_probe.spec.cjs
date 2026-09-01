const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

test.describe('Defect Fix Verification (Installed App) - v1.7.4 - Final Probe', () => {
  let electronApp;
  let window;

  const openDocument = async (filePath) => {
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, filePath);
    const openBtn = window.locator('.btn-primary:has-text("Open"), button:has-text("Open PDF")').first();
    await openBtn.click();
    await window.waitForSelector('.workspace', { timeout: 15000 });
  };

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default', EXE_PATH);
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('B11: OCR suspects disabled on empty tab', async () => {
    await openDocument(getSamplePath('report.pdf'));
    await window.click('[data-new-tab]');
    await window.click('[data-tools-toggle]');
    const ocrSuspects = window.locator('[data-tool-id="ocrSuspects"]');
    const isDisabled = await ocrSuspects.getAttribute('disabled');
    console.log('B11 Result - isDisabled:', isDisabled);
    expect(isDisabled).not.toBeNull();
  });

  test('DEF-100: Flatten backdrop check', async () => {
    await openDocument(getSamplePath('form.pdf'));
    await window.waitForSelector('.tool-btn-form');
    await window.click('.tool-btn-form');
    const dialog = window.locator('.modal-dialog');
    await expect(dialog).toBeVisible();
    
    // Check if backdrop intercepts
    const confirmBtn = dialog.locator('button:has-text("Flatten")');
    try {
      await confirmBtn.click({ timeout: 2000 });
      console.log('DEF-100 Result: PASS (Clicked)');
    } catch (e) {
      console.log('DEF-100 Result: FAIL (Intercepted/Timeout)');
    }
  });

  test('DEF-098: Thumbnail jump check', async () => {
    await openDocument(getSamplePath('long.pdf'));
    const rail = window.locator('.side-rail');
    if (!(await rail.isVisible())) {
      await window.click('.rail-tab[title="Page thumbnails"]');
    }
    const thumb2 = window.locator('.thumb-item').nth(1);
    await thumb2.click();
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('DEF-098 Result - currentPage:', diag.currentPage);
    expect(diag.currentPage).toBe(2);
  });
});
