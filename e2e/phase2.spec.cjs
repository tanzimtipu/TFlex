const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');

test('Phase 2: Merge and Reorder', async () => {
  const electronApp = await launchApp();

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.welcome', { timeout: 20000 });
  
  // --- PHASE 1 REGRESSIONS ---
  
  // 1. Welcome Samples
  const diag1 = await window.evaluate(() => window.tflexDiagnostics());
  expect(diag1.sampleCount).toBe(4);
  
  // 2. Search (using fixture w/ outline for DEF-033/Phase 2 verification)
  console.log('Opening report.pdf (fixture)...');
  const reportPath = path.resolve(__dirname, '../test-fixtures/report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  await window.click('button[title*="Find in document"]');
  await window.fill('.search-input', 'orchestration');
  await window.waitForTimeout(5000); // Wait longer for index & search
  const diagSearch = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagSearch.searchHits).toBe(265);
  
  // 3. Theme
  const themeBefore = diagSearch.theme;
  await window.click('.theme-toggle');
  await window.waitForTimeout(500);
  const diagTheme = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagTheme.theme).not.toBe(themeBefore);
  
  // 4. Outline
  await window.click('button[title="Bookmarks"]');
  const outlineCount = await window.locator('.outline-link').count();
  expect(outlineCount).toBe(8);

  // Switch back to thumbnails for Phase 2 scenarios
  await window.click('button[title="Page thumbnails"]');
  await window.waitForSelector('.thumb');
  
  // --- PHASE 2 SCENARIOS ---
  
  // 1. Merge scanned.pdf (position after)
  const scannedPath = path.resolve(__dirname, '../test-fixtures/scanned.pdf');
  // Use electronApp.evaluate to patch the main process dialog for the pick
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, scannedPath);

  // Click Merge button
  await window.click('button[aria-label="Merge with another PDF"]');
  await window.waitForSelector('.modal-dialog');
  
  // Click "Choose PDF..." button in dialog
  await window.click('.modal-dialog button:has-text("Choose PDF")');
  await expect(window.locator('.modal-picked')).toContainText('scanned.pdf');
  
  // Confirm Merge
  await window.click('.modal-footer button:has-text("Merge")');
  await window.waitForSelector('.modal-dialog', { state: 'hidden' });
  await window.waitForTimeout(1000);
  
  await window.screenshot({ path: 'screenshots/e2e-merge.png' });
  const diagMerge = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagMerge.pageCount).toBe(40);
  
  // 2. DnD reorder page 1 to position 2
  // We'll use the dragTo but we need to make sure the elements are visible
  const thumb1 = window.locator('.thumb[data-page="1"]');
  const thumb3 = window.locator('.thumb[data-page="3"]');
  await thumb1.dragTo(thumb3);
  await window.waitForTimeout(1000);
  
  const diagReorder = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagReorder.engineState.pageOrder[0]).toBe(1);
  expect(diagReorder.engineState.pageOrder[1]).toBe(0);
  
  await window.screenshot({ path: 'screenshots/e2e-reorder.png' });

  // 3. Undo
  await window.click('button[aria-label="Undo last change"]');
  await window.waitForTimeout(1000);
  const diagUndo = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagUndo.engineState.pageOrder[0]).toBe(0);
  expect(diagUndo.engineState.pageOrder[1]).toBe(1);

  
  await electronApp.close();
});
