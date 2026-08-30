const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

test('DEF-050 Retest: Search finds OCRed words', async () => {
  test.setTimeout(900000);
  const app = await launchApp();
  const page = await app.firstWindow();
  
  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.text()}`);
  });

  const filePath = getSamplePath('scanned.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await page.click('button:has-text("Open PDF")');
  await page.waitForSelector('.workspace');

  console.log('Running OCR...');
  const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
  await activeTabPane.locator('[data-tools-toggle]').click();
  await page.click('[data-tool-id="recognizeText"]');
  await page.waitForSelector('.ocr-dialog');
  await page.click('[data-ocr-confirm]');

  console.log('Waiting for OCR completion...');
  await page.waitForSelector('[data-ocr-suspects-panel]', { timeout: 300000 });

  // Save the file (proxy refresh path)
  console.log('Saving file...');
  const savePath = path.join(os.tmpdir(), `retest-ocr-050-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  
  await page.click('button:has-text("Save…")');
  await page.waitForSelector('button:has-text("Choose location…")', { timeout: 10000 });
  await page.click('button:has-text("Choose location…")');
  
  // Wait for file to be written
  let saved = false;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(savePath) && fs.statSync(savePath).size > 500000) {
      saved = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(saved).toBe(true);
  console.log('File saved.');

  // The "proxy refresh path" might take a moment to update the UI
  await page.waitForTimeout(5000);

  console.log('Opening search for "Sir" in current session...');
  await page.keyboard.press('Control+F');
  // Re-locate active tab pane just in case
  const currentTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
  await currentTabPane.locator('.search-input').fill('Sir');
  await page.keyboard.press('Enter');

  console.log('Waiting for search results...');
  let found = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    const status = await currentTabPane.locator('.search-status').textContent();
    console.log(`Attempt ${i+1} search status: ${status}`);
    if (status !== 'Searching...' && status !== 'No results' && status.includes('of')) {
      found = true;
      break;
    }
  }

  if (found) {
    console.log('Search found the OCRed word "Sir" in current session after Save!');
  } else {
    console.log('Search still failed in current session. Trying re-open...');
    
    await page.locator('.tab.tab-active .tab-close').click();
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await page.waitForTimeout(2000);

    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savePath);
    await page.click('button:has-text("Open PDF")');
    
    // Use a more robust way to wait for the document
    await page.waitForSelector('.workspace', { timeout: 60000 });
    
    const reOpenedTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
    await page.keyboard.press('Control+F');
    await reOpenedTabPane.locator('.search-input').fill('Sir');
    await page.keyboard.press('Enter');
    
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const status = await reOpenedTabPane.locator('.search-status').textContent();
      console.log(`Re-opened attempt ${i+1} search status: ${status}`);
      if (status !== 'Searching...' && status !== 'No results' && status.includes('of')) {
        found = true;
        break;
      }
    }
  }

  if (!found) {
    await page.screenshot({ path: 'screenshots/retest-def-050-final-fail.png' });
  }
  expect(found).toBe(true);
  
  await app.close();
});
