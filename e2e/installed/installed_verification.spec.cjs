// INSTALLED-APP-ONLY spec. Excluded from the standard suite via
// playwright.config.js testIgnore (e2e/installed/**). Run ONLY when the
// orchestrator explicitly asks to test the installed app.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test.describe('Installed App Verification (Behavior-First Fixes)', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp([], 'default', EXE_PATH);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome, .workspace');
    // Ensure we are NOT in Edit mode
    const editToggle = window.locator('[data-toolbar-edit-toggle]');
    if (await editToggle.isVisible()) {
        const pressed = await editToggle.getAttribute('aria-pressed');
        if (pressed === 'true') {
            await editToggle.click();
        }
    }
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  async function openReport() {
    await window.click('.sample-card:has-text("report.pdf"), .sample-card:has-text("Report")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1000);
  }

  test('DEF-095: textbox bar unmounts and commits', async () => {
    await openReport();

    // Select Text Box annotation tool (ensure NOT clicking Pencil)
    await window.click('button[data-tool="textbox"]');
    
    // Click in the middle of the page
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 100, box.y + 100);

    // Wait for annotation editor
    await window.waitForSelector('[data-annotation-editor="textbox"]');
    await window.fill('[data-annotation-editor="textbox"]', 'DEF-095 Verification Text');
    
    await window.screenshot({ path: 'screenshots/def-095-before-commit.png' });
    
    // Click Confirm on the action bar
    await window.click('button[data-annotation-action="textbox-confirm"]');
    
    // Verify editor wrapper is gone
    await expect(window.locator('[data-annotation-editor-wrap="textbox"]')).toBeHidden();
    // Verify action bar is gone
    await expect(window.locator('[data-annotation-action-bar="textbox"]')).toBeHidden();
    
    await window.screenshot({ path: 'screenshots/def-095-after-commit.png' });
  });

  test('DEF-096: sticky note click icon opens editor pre-filled', async () => {
    await openReport();

    await window.click('button[data-tool="note"]');
    
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 200, box.y + 200);

    await window.waitForSelector('[data-annotation-editor="note"]');
    await window.fill('[data-annotation-editor="note"] textarea', 'DEF-096 Sticky Note Content');
    await window.click('button[data-annotation-action="note-confirm"]');

    const noteIcon = window.locator('.ann-note[data-kind="note"]').first();
    await expect(noteIcon).toBeVisible();
    
    // Click the placed icon to re-open
    await noteIcon.click();
    
    await window.waitForSelector('[data-annotation-editor="note"]');
    const content = await window.inputValue('[data-annotation-editor="note"] textarea');
    expect(content).toBe('DEF-096 Sticky Note Content');
    
    await window.screenshot({ path: 'screenshots/def-096-editor-open.png' });
    
    // Verify delete works
    await window.click('button[data-annotation-action="note-delete"]');
    await expect(noteIcon).toBeHidden();
  });

  test('DEF-097: tab close clears activeTool', async () => {
    await openReport();

    await window.click('button[data-tool="highlight"]');
    
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTool).toBe('highlight');

    // Close tab
    await window.click('.tab-close');
    
    await window.waitForSelector('.welcome');
    
    diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.activeTool).toBe(null);
  });

  test('DEF-098: thumbnail click jumps to page', async () => {
    await window.click('.sample-card:has-text("long.pdf"), .sample-card:has-text("Long")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1000);

    await window.waitForSelector('.thumb-scroller');
    
    const thumb10 = window.locator('.thumb-item').nth(9); // page 10
    await thumb10.scrollIntoViewIfNeeded();
    await thumb10.click();
    
    // Wait for jump and diagnostic update
    await window.waitForFunction(() => window.tflexDiagnostics().currentPage === 10, { timeout: 5000 });
    
    await window.screenshot({ path: 'screenshots/def-098-thumb-jump.png' });
  });

  test('DEF-099: blank page background is white', async () => {
    await openReport();

    // Force Dark theme via diagnostic/settings if possible, or just click toggle
    const themeToggle = window.locator('.theme-toggle');
    const currentTheme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (currentTheme !== 'dark') {
        await themeToggle.click();
    }

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="insertPages"]');
    
    await window.waitForSelector('.modal-dialog');
    await window.click('button:has-text("Blank Page")');
    
    // Wait for insertion
    await window.waitForTimeout(1000);
    
    const lastPage = window.locator('.page-slot').last();
    await lastPage.scrollIntoViewIfNeeded();
    
    const bgColor = await lastPage.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(255, 255, 255)');
    
    await window.screenshot({ path: 'screenshots/def-099-blank-page-white.png' });
  });

  test('DEF-100: flatten dialog clickable and backdrop behavior', async () => {
    await window.click('.sample-card:has-text("form.pdf"), .sample-card:has-text("Form")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1000);

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="forms"]');
    
    await window.waitForSelector('.modal-backdrop');
    
    const flattenBtn = window.locator('.modal-footer button.btn-primary');
    await expect(flattenBtn).toBeVisible();
    await flattenBtn.click(); // Should be clickable
    
    await expect(window.locator('.modal-backdrop')).toBeHidden();
    
    // Re-open and test backdrop click
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="forms"]');
    await window.waitForSelector('.modal-backdrop');
    
    const backdrop = window.locator('.modal-backdrop');
    // Click exactly on the backdrop, not the dialog
    await backdrop.click({ position: { x: 5, y: 5 } });
    
    await expect(window.locator('.modal-backdrop')).toBeHidden();
    await window.screenshot({ path: 'screenshots/def-100-flatten-dialog.png' });
  });

  test('B10: stamp visible after placement', async () => {
    await openReport();

    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="stamp"]');
    
    await window.waitForSelector('.modal-dialog');
    await window.click('button:has-text("APPROVED")');
    await window.click('button:has-text("Place on page")');
    
    const page = window.locator('.page-slot').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + 150, box.y + 150);
    
    // DEF-101 fix: check for .stamp-annotation
    await expect(window.locator('.stamp-annotation')).toBeVisible();
    await window.screenshot({ path: 'screenshots/b10-stamp-placed.png' });
  });

  test('B11: OCR disabled on empty tab', async () => {
    await openReport();

    await window.click('[data-new-tab]');
    await window.waitForSelector('.tab-item-active:has-text("Empty tab")');

    await window.click('[data-tools-toggle]');
    await window.waitForSelector('[data-tools-palette]');
    
    const ocrBtn = window.locator('button[data-tool-id="recognizeText"]');
    await expect(ocrBtn).toBeDisabled();
    
    await window.screenshot({ path: 'screenshots/b11-ocr-disabled.png' });
  });
});
