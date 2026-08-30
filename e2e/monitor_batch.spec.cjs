const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Monitor Batch OCR IPC', async () => {
  test.setTimeout(900000);
  const app = await launchApp();
  const page = await app.firstWindow();
  
  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.text()}`);
  });

  const file1 = getSamplePath('scanned.pdf');
  const file2 = getSamplePath('scanned.pdf');
  
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file1);
  await page.click('button:has-text("Open PDF")');
  await page.waitForSelector('.tab-pane[style*="visibility: visible"] .workspace');

  await page.click('[data-new-tab]');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file2);
  await page.click('button:has-text("Open PDF")');
  await page.waitForSelector('.tab-pane[style*="visibility: visible"] .workspace');

  console.log('Starting Batch OCR...');
  const activeTabPane = page.locator('.tab-pane[style*="visibility: visible"]');
  await activeTabPane.locator('[data-tools-toggle]').click();
  await page.click('[data-tool-id="batchOcr"]');
  
  console.log('Waiting for completion toast...');
  try {
    const toast = page.locator('text=Batch OCR finished on 2 of 2 documents');
    await toast.waitFor({ state: 'visible', timeout: 600000 });
    console.log('Batch OCR completed successfully!');
  } catch (e) {
    console.error('Batch OCR timed out or failed!');
    await page.screenshot({ path: 'screenshots/batch-ocr-fail.png' });
  }

  await app.close();
});
