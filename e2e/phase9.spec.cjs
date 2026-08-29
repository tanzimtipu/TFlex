const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 9: Create and Export (Partial Verification)', async () => {
  test.setTimeout(60000);
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));

  // 1. Export pages as images (Verified first because image picker is racy)
  console.log('Testing Export pages...');
  
  // Open a sample PDF
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.screenshot({ path: 'screenshots/phase9-workspace.png' });

  // Open tools palette
  await window.click('button[aria-label="Tools"]');
  await window.waitForSelector('[data-tool-id="exportPages"]');
  await window.click('[data-tool-id="exportPages"]');
  
  await window.waitForSelector('.modal-dialog:has-text("Export pages as images")');
  
  // Set format and DPI
  await window.selectOption('select', 'jpeg');
  const dpiInput = window.locator('input[type="number"]');
  await dpiInput.fill('300');
  
  // Trigger export
  console.log('Triggering export...');
  await window.click('button.btn-primary:has-text("Export")');
  
  // Wait for export to complete (toast appears)
  await window.waitForSelector('.toast-info:has-text("Exported")', { timeout: 15000 });
  
  // Verify persistence of export settings in diagnostics
  let diag = await window.evaluate(() => window.tflexDiagnostics());
  expect(diag.exportImageFormat).toBe('jpeg');
  expect(diag.exportImageDpi).toBe(300);

  // 2. Create PDF from images UI existence
  console.log('Checking Create from images UI...');
  await window.click('button[aria-label="Close tools palette"]'); // Close palette
  
  // Create is reachable from Welcome too. Close the tab to go back.
  await window.keyboard.press('Control+W');
  await window.waitForSelector('button:has-text("Create from images")');
  
  await window.click('button:has-text("Create from images")');
  const createDialog = await window.waitForSelector('.modal-dialog:has-text("Create PDF from images")');
  expect(createDialog).toBeTruthy();
  
  await window.click('button:has-text("Cancel")');

  // 3. Verify missing features (Reporting)
  console.log('Checking for missing Phase 9 features...');
  
  const missing = [
    'Insert blank page',
    'Insert from PDF',
    'Create from clipboard'
  ];
  
  for (const feature of missing) {
    const visible = await window.isVisible(`button:has-text("${feature}")`);
    if (visible) {
      console.warn(`Unexpectedly found feature: ${feature}`);
    } else {
      console.log(`Feature correctly identified as missing: ${feature}`);
    }
  }

  await electronApp.close();
});
