const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

test.describe('Defect Fix Verification (Installed App) - v1.7.4', () => {
  let electronApp;
  let window;

  const openDocument = async (filePath) => {
    console.log('Opening document:', filePath);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, filePath);
    // Try title bar Open button or Welcome screen button
    const openBtn = window.locator('.btn-primary:has-text("Open"), button:has-text("Open PDF")').first();
    await openBtn.click();
    await window.waitForSelector('.workspace', { timeout: 15000 });
    console.log('Workspace loaded');
  };

  test.beforeEach(async () => {
    console.log('Launching app from:', EXE_PATH);
    electronApp = await launchApp([], 'default', EXE_PATH);
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('DEF-095: Textbox floating bar unmounts after Confirm', async () => {
    const sample = getSamplePath('report.pdf');
    await openDocument(sample);

    // Click Tools button to open palette if textbox not in main toolbar
    // Based on Toolbar.tsx, textbox is NOT in the main toolbar, it's in the Tools palette or Edit toolbar.
    // Wait, Toolbar.tsx has: {onEditModeToggle !== undefined && ... data-toolbar-edit-toggle}
    // And AnnotationToolbar.tsx has "textbox".
    
    // Let's use the Tools palette for consistency
    await window.click('[data-tools-toggle]');
    // Wait for a tool that we know is there.
    await window.waitForSelector('[data-tool-id="sign"]');
    
    // Wait, textbox might be in the Edit toolbar.
    // Let's try to find the textbox tool.
    const textboxTool = window.locator('[data-tool="textbox"]');
    if (!(await textboxTool.isVisible())) {
       // Try opening Edit mode
       const editToggle = window.locator('[data-toolbar-edit-toggle]');
       if (await editToggle.isVisible()) {
         await editToggle.click();
       }
    }
    await textboxTool.click();
    
    // Click on page to place
    const page = window.locator('.pdf-page').first();
    await page.click({ position: { x: 50, y: 50 } });

    // Floating bar should be visible
    const bar = window.locator('[data-annotation-action-bar="textbox"]');
    await expect(bar).toBeVisible();

    // Click Confirm
    const confirmBtn = bar.locator('[data-annotation-action="textbox-confirm"]');
    await confirmBtn.click({ force: true });

    // Floating bar should unmount
    await expect(bar).not.toBeVisible();
    await window.screenshot({ path: 'screenshots/def-095-pass.png' });
  });

  test('DEF-096: Sticky note icon is clickable (not intercepted by textLayer)', async () => {
    const sample = getSamplePath('report.pdf');
    await openDocument(sample);

    // Select Sticky Note tool (might be in palette)
    await window.click('[data-tools-toggle]');
    const noteTool = window.locator('[data-tool-id="rotate"]'); // Placeholder to check palette
    // Let's look at ToolsPalette.tsx again. Sticky note is not there?
    // Wait, I saw "note" in AnnotationOverlay.
    // It's in the Annotation toolbar usually.
    
    const stickynoteTool = window.locator('[data-tool="stickynote"]');
    await stickynoteTool.click();
    
    // Click on page to place
    const page = window.locator('.pdf-page').first();
    await page.click({ position: { x: 100, y: 100 } });

    // Confirm placement in the note editor
    const confirmBtn = window.locator('[data-annotation-action="note-confirm"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Now attempt to click the committed icon
    const icon = window.locator('[data-kind="note"]').first();
    await expect(icon).toBeVisible();
    
    // Clicking it should open the editor again
    await icon.click();
    
    const editor = window.locator('[data-annotation-editor="note"]');
    await expect(editor).toBeVisible();
    await window.screenshot({ path: 'screenshots/def-096-pass.png' });
  });

  test('DEF-097: activeTool diagnostic not cleared on tab close', async () => {
    const sample = getSamplePath('report.pdf');
    await openDocument(sample);
    
    // Set a tool (Highlight is in main toolbar usually)
    const highlightTool = window.locator('[aria-label="Highlight"]');
    await highlightTool.click();
    
    let diagnostics = await window.evaluate(() => window.tflexDiagnostics());
    expect(diagnostics.activeTool).toBe('highlight');

    // Close the current tab
    await window.locator('.tab-active .tab-close').click();

    // Check diagnostics
    diagnostics = await window.evaluate(() => window.tflexDiagnostics());
    expect(diagnostics.activeTool).toBe(null);
    await window.screenshot({ path: 'screenshots/def-097-pass.png' });
  });

  test('DEF-098: Thumbnail click jumps to clicked page', async () => {
    const sample = getSamplePath('long.pdf');
    await openDocument(sample);

    // Ensure thumbnails are visible
    const rail = window.locator('.side-rail');
    if (!(await rail.isVisible())) {
      await window.click('.rail-tab[title="Page thumbnails"]');
    }

    // Click thumbnail for page 2 (index 1)
    const thumb2 = window.locator('.thumb-item').nth(1);
    await thumb2.click();

    // Check currentPage diagnostic
    await expect.poll(async () => {
      const diag = await window.evaluate(() => window.tflexDiagnostics());
      return diag.currentPage;
    }, { timeout: 10000 }).toBe(2);

    await window.screenshot({ path: 'screenshots/def-098-pass.png' });
  });

  test('DEF-099: Blank page background is white (not dark)', async () => {
    const sample = getSamplePath('report.pdf');
    await openDocument(sample);

    // Set Dark theme
    const currentTheme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (currentTheme !== 'dark') {
      await window.locator('.theme-toggle').click();
    }

    // Insert blank page
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="insertPages"]');
    
    const dialog = window.locator('.modal-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("Insert Blank")').click();

    // Check background color of the new page (last one)
    const lastPage = window.locator('.pdf-page').last();
    const bgColor = await lastPage.evaluate(el => window.getComputedStyle(el).backgroundColor);
    
    // Should be paper-white even in dark mode
    expect(bgColor).toBe('rgb(255, 255, 255)');
    await window.screenshot({ path: 'screenshots/def-099-pass.png' });
  });

  test('DEF-100: Flatten dialog Confirm button works', async () => {
    const sample = getSamplePath('form.pdf');
    await openDocument(sample);
    
    // Trigger flatten (wait for hasFormFields to enable it)
    await window.waitForSelector('.tool-btn-form');
    await window.click('.tool-btn-form');

    // Dialog should appear
    const dialog = window.locator('.modal-dialog');
    await expect(dialog).toBeVisible();

    // Click Confirm button
    const confirmBtn = dialog.locator('button:has-text("Flatten")');
    await confirmBtn.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible();
    await window.screenshot({ path: 'screenshots/def-100-pass.png' });
  });

  test('B10/DEF-101: Stamp foreground placement', async () => {
    const sample = getSamplePath('report.pdf');
    await openDocument(sample);

    // Select Stamp tool (from palette)
    await window.click('[data-tools-toggle]');
    await window.click('[data-tool-id="stamp"]');
    
    const dialog = window.locator('.modal-dialog'); // StampDialog
    await expect(dialog).toBeVisible();
    
    const approved = dialog.locator('[data-stamp-id="APPROVED"]');
    await approved.click();
    await dialog.locator('button:has-text("Place on page")').click();

    // Click on page to place
    const page = window.locator('.pdf-page').first();
    await page.click({ position: { x: 150, y: 150 } });

    // Annotation should exist
    const stamp = window.locator('.stamp-annotation');
    await expect(stamp).toBeVisible();
    await window.screenshot({ path: 'screenshots/b10-pass.png' });
  });

  test('B11/DEF-102: OCR suspects disabled on empty tab', async () => {
    // Open new empty tab
    await window.click('[data-new-tab]');

    // Open Tools palette
    await window.click('[data-tools-toggle]');
    const palette = window.locator('[data-tools-palette]');
    await expect(palette).toBeVisible();

    // Check OCR suspects tool state
    const ocrSuspects = palette.locator('[data-tool-id="ocrSuspects"]');
    
    const isDisabled = await ocrSuspects.getAttribute('disabled');
    expect(isDisabled).not.toBeNull();
    await window.screenshot({ path: 'screenshots/b11-pass.png' });
  });
});
