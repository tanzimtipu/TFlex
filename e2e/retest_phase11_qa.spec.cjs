const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test.describe('Retest Phase 11 Defects', () => {
  let app;
  let page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
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

  test('DEF-049: Ctrl+Shift+R opens OCR dialog', async () => {
    const filePath = getSamplePath('scanned.pdf');
    await openFile(filePath);
    
    await page.focus('body');
    await page.keyboard.press('Control+Shift+R');
    
    await expect(page.locator('.ocr-dialog')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'screenshots/retest-def-049.png' });
  });

  test('DEF-050: Search finds OCRed words', async () => {
    test.setTimeout(300000);
    const filePath = getSamplePath('scanned.pdf');
    await openFile(filePath);
    
    // Open OCR dialog
    await page.locator('.tab-pane[style*="visibility: visible"] [data-tools-toggle]').click();
    await page.click('[data-tool-id="recognizeText"]');
    await page.waitForSelector('.ocr-dialog');
    
    // Start OCR (All Pages)
    await page.click('[data-ocr-confirm]');
    
    // Wait for OCR to complete (suspects panel appears)
    await page.waitForSelector('[data-ocr-suspects-panel]', { timeout: 240000 });
    
    // Get a suspect word - prefer "Sir" if present
    const suspects = await page.locator('.ocr-suspects-word').allTextContents();
    const wordToSearch = suspects.includes('Sir') ? 'Sir' : (suspects.find(w => w.length >= 3) || suspects[0]);
    console.log(`Searching for suspect word: "${wordToSearch}"`);
    
    // Search for it
    await page.keyboard.press('Control+F');
    const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
    await activeTabPane.locator('.search-input').fill(wordToSearch);
    await page.keyboard.press('Enter');
    
    // Verify search results
    console.log('Waiting for search results...');
    let found = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const status = await activeTabPane.locator('.search-status').textContent();
      console.log(`Search status attempt ${i+1}: ${status}`);
      if (status !== 'Searching...' && status !== 'No results' && status.includes('of')) {
        found = true;
        break;
      }
    }
    
    expect(found).toBe(true);
    
    await page.screenshot({ path: 'screenshots/retest-def-050.png' });
  });

  test('DEF-051: Batch OCR across tabs with toast', async () => {
    test.setTimeout(900000);
    const file1 = getSamplePath('scanned.pdf');
    const file2 = getSamplePath('scanned.pdf');
    
    await openFile(file1);
    await page.click('[data-new-tab]');
    await openFile(file2);
    
    const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
    await activeTabPane.locator('[data-tools-toggle]').click();
    await page.click('[data-tool-id="batchOcr"]');
    
    // Verify toast
    const toast = page.locator('text=Batch OCR finished on 2 of 2 documents');
    await expect(toast).toBeVisible({ timeout: 600000 });
    
    await page.screenshot({ path: 'screenshots/retest-def-051.png' });
  });
});
