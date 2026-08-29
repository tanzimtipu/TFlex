const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test.describe('Phase 9 Re-verification', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    // Wait for the app to be fully loaded
    await window.waitForSelector('.app', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  const getDiag = async () => {
    await window.waitForFunction(() => typeof window.tflexDiagnostics === "function", { timeout: 10000 });
    return await window.evaluate(() => window.tflexDiagnostics());
  };

  test('Verify Insert Blank Page and Round-trip', async () => {
    // 1. Open a sample PDF
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    const initialPageCount = (await getDiag()).pageCount;
    
    // 2. Open Tools Palette and Insert Blank Page
    await window.click('button[aria-label="Tools palette"]');
    await window.click('[data-tool-id="insertPages"]');
    await window.waitForSelector('[data-insert-pages-dialog]');
    
    await window.click('[data-insert-mode="blank"]');
    await window.fill('[data-insert-position]', '2'); // Insert at page 2 (visible index 1)
    await window.click('[data-insert-confirm]');
    
    // 3. Verify page count increased
    await window.waitForFunction((count) => window.tflexDiagnostics().pageCount === count + 1, initialPageCount);
    
    // 4. Save and Re-open (Round-trip)
    const savedPath = path.join(os.tmpdir(), `reverify-blank-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savedPath);
    
    await window.click('button[aria-label="Save As"]');
    await window.waitForSelector('[data-save-as-dialog]');
    await window.click('[data-save-as-confirm]');
    await window.waitForSelector('.toast-info:has-text("Saved")');
    
    // Close tab and open the saved file
    await window.keyboard.press('Control+W');
    await window.waitForSelector('button:has-text("Open PDF")');

    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savedPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    const finalPageCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    expect(finalPageCount).toBe(initialPageCount + 1);
  });

  test('Verify Insert from PDF', async () => {
    const activeId = await window.evaluate(() => window.tflexDiagnostics().activeTabId);
    if (!activeId) {
        // Open a sample PDF if none open
        const reportPath = getSamplePath('report.pdf');
        await electronApp.evaluate(async ({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        }, reportPath);
        await window.click('button:has-text("Open PDF")');
        await window.waitForSelector('.workspace');
    }

    const initialPageCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    const otherPdfPath = getSamplePath('form.pdf');
    
    // Mock the openFileDialog for the dialog's "Pick PDF" button
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, otherPdfPath);

    await window.click('button[aria-label="Tools palette"]');
    await window.click('[data-tool-id="insertPages"]');
    await window.waitForSelector('[data-insert-pages-dialog]');
    
    await window.click('[data-insert-mode="fromPdf"]');
    // The pick button
    await window.click('[data-insert-pick]');
    // Wait for file path to appear
    await window.waitForSelector('.modal-picked:has-text("form.pdf")');
    
    await window.click('[data-insert-confirm]');
    
    // form.pdf has 1 page usually. Let's wait for change.
    await window.waitForFunction((count) => window.tflexDiagnostics().pageCount > count, initialPageCount);
    const midPageCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    expect(midPageCount).toBeGreaterThan(initialPageCount);
  });

  test('Verify Create from Clipboard (Mocked)', async () => {
    // Mock clipboard content
    await electronApp.evaluate(async ({ clipboard }) => {
      clipboard.writeText('Hello from Clipboard!');
    });

    // Click "Create from images" on Welcome screen
    await window.click('[data-welcome-create]');
    await window.waitForSelector('.modal-dialog:has-text("Create PDF from images")');
    
    // Click "Create from clipboard"
    await window.click('button:has-text("Create from clipboard")');
    
    // Should open a new tab
    await window.waitForSelector('.workspace');
    const pageCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    expect(pageCount).toBe(1);
    
    const displayName = await window.evaluate(() => {
        const activeId = window.tflexDiagnostics().activeTabId;
        return document.querySelector('.tab-active .tab-title')?.textContent;
    });
    expect(displayName).toContain('clipboard');
  });

  test('Verify Export RTF', async () => {
    // Open a sample PDF
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    await window.click('button[aria-label="Tools palette"]');
    
    // RTF Export
    await window.click('[data-tool-id="exportText"]');
    await window.waitForSelector('.modal-dialog:has-text("Export text")');
    await window.click('[data-text-export-format="rtf"]');
    
    const [rtfDownload] = await Promise.all([
      window.waitForEvent('download', { timeout: 30000 }),
      window.click('[data-text-export-confirm]')
    ]);
    expect(rtfDownload.suggestedFilename()).toContain('.rtf');
  });

  test('Verify Export DOCX', async () => {
    // DOCX Export
    await window.click('button[aria-label="Tools palette"]');
    await window.click('[data-tool-id="exportDocx"]');
    await window.waitForSelector('.modal-dialog:has-text("Export to Word")');
    
    const [docxDownload] = await Promise.all([
      window.waitForEvent('download', { timeout: 30000 }),
      window.click('[data-docx-export-confirm]')
    ]);
    expect(docxDownload.suggestedFilename()).toContain('.docx');
  });

  test('Verify Quality Persistence (DEF-047)', async () => {
    await window.keyboard.press('Control+W'); // Close current doc
    
    await window.click('button:has-text("Create from images")');
    await window.waitForSelector('.modal-dialog:has-text("Create PDF from images")');
    
    // Change quality
    const qualityInput = window.locator('input[type="range"]');
    // The dialog might have a numerical input too, let's try filling the range or the number
    if (await qualityInput.isVisible()) {
        await qualityInput.fill('90');
    } else {
        const numInput = window.locator('input[type="number"]');
        await numInput.fill('90');
    }
    // Wait for debounce/persist
    await window.waitForTimeout(1000);
    
    // Check diagnostics
    let diag = await window.evaluate(() => window.tflexDiagnostics());
    expect(diag.createImageQuality).toBe(0.9);
    
    // Close and Reopen
    await window.click('button:has-text("Cancel")');
    await window.click('button:has-text("Create from images")');
    await window.waitForSelector('.modal-dialog:has-text("Create PDF from images")');
    
    const qualityVal = await (await window.locator('input[type="range"]').isVisible() ? window.locator('input[type="range"]') : window.locator('input[type="number"]')).inputValue();
    expect(qualityVal).toBe('90');
    
    await window.click('button:has-text("Cancel")');
  });

  test('Verify Toolbar Visuals', async () => {
    // Open a document to show full toolbar
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    await window.screenshot({ path: 'screenshots/phase9-toolbar-check.png' });
    // Visual inspection required by human/QA duty
  });
});
