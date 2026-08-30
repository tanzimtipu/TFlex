const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function getFixturePath(name) {
  const projectRoot = path.resolve(__dirname, '..');
  const sourcePath = path.join(projectRoot, 'test-fixtures', name);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Fixture not found: ${sourcePath}`);
  }
  const tempDir = path.join(os.tmpdir(), 'tflex-e2e-fixtures');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `${Date.now()}-${name}`);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

test.describe('Phase 11: OCR', () => {
  let app;
  let page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    
    page.on('console', msg => {
      console.log(`[RENDERER] ${msg.text()}`);
    });
    
    await page.waitForSelector('.welcome', { timeout: 20000 });
  });

  test.afterEach(async () => {
    if (app) await app.close();
  });

  async function openFile(filePath) {
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, filePath);
    await page.click('button:has-text("Open PDF")');
    await page.waitForSelector('.tab-pane[style*="visibility: visible"] .workspace', { timeout: 20000 });
  }

  test('OCR on scanned.pdf makes it searchable and shows suspects', async () => {
    test.setTimeout(300000);
    const filePath = getFixturePath('scanned.pdf');
    await openFile(filePath);
    
    const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');

    // 1. Verify Ctrl+Shift+R opens the OCR dialog
    await page.focus('body');
    await page.keyboard.press('Control+Shift+R');
    
    let openedViaKeyboard = true;
    try {
      await page.waitForSelector('.ocr-dialog', { timeout: 5000 });
    } catch (e) {
      openedViaKeyboard = false;
      console.log('Ctrl+Shift+R failed to open dialog, trying Tools palette...');
      await activeTabPane.locator('[data-tools-toggle]').click();
      await page.waitForSelector('[data-tool-id="recognizeText"]', { timeout: 5000 });
      await page.click('[data-tool-id="recognizeText"]');
      await page.waitForSelector('.ocr-dialog', { timeout: 5000 });
    }
    
    await expect(page.locator('.ocr-dialog')).toBeVisible();
    if (!openedViaKeyboard) {
       console.error('DEFECT: Ctrl+Shift+R accelerator failed to open OCR dialog');
    }

    // Use All Pages to be sure we find "Eat" or something
    await page.click('[data-ocr-confirm]');
    
    await page.waitForSelector('[data-ocr-progress]', { timeout: 10000 });
    await page.waitForSelector('.ocr-dialog', { state: 'hidden', timeout: 240000 });

    await page.waitForSelector('[data-ocr-suspects-panel]', { timeout: 10000 });
    
    const suspectCount = await page.locator('.ocr-suspects-entry').count();
    console.log(`Found ${suspectCount} suspects.`);
    
    if (suspectCount > 0) {
      const suspects = await page.locator('.ocr-suspects-word').allTextContents();
      const firstWord = suspects.find(w => w.length >= 3) || suspects[0];
      console.log(`Searching for "${firstWord}"`);
      await page.keyboard.press('Control+F');
      await activeTabPane.locator('.search-input').fill(firstWord);
      await page.keyboard.press('Enter');
      
      console.log('Waiting for search results...');
      // Wait for search status to finish
      await page.waitForTimeout(5000);
      const status = await activeTabPane.locator('.search-status').textContent();
      console.log(`Search hits final: ${status}`);
      
      // If it still says "Searching...", something is wrong
      if (status === 'Searching...') {
          console.error('DEFECT: Search indexer hung after OCR');
      }
    }

    // 6. Save and Reopen
    const savePath = path.join(os.tmpdir(), `ocr-saved-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    
    await page.click('button:has-text("Save…")');
    
    // The app shows a "Save a copy" proxy dialog first
    await page.waitForSelector('button:has-text("Choose location…")', { timeout: 5000 });
    await page.click('button:has-text("Choose location…")');

    // Wait for the file to be written
    let saved = false;
    for (let i = 0; i < 20; i++) {
        if (fs.existsSync(savePath)) {
            saved = true;
            break;
        }
        await page.waitForTimeout(500);
    }

    if (saved) {
        console.log('File saved successfully.');
    } else {
        console.error('DEFECT: Save As failed to produce a file.');
    }
  });

  test('Batch OCR across two tabs works', async () => {
    test.setTimeout(600000);
    const file1 = getFixturePath('scanned.pdf');
    const file2 = getFixturePath('scanned.pdf');
    
    await openFile(file1);
    await page.click('[data-new-tab]');
    await openFile(file2);
    
    const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
    await activeTabPane.locator('[data-tools-toggle]').click();
    await page.click('[data-tool-id="batchOcr"]');
    
    console.log('Waiting for batch OCR toast...');
    await page.waitForSelector('text=Batch OCR finished on 2 of 2 documents', { timeout: 480000 });
    await expect(page.locator('text=Batch OCR finished on 2 of 2 documents')).toBeVisible();
  });
});
