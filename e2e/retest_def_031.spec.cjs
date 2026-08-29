const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');

test('Retest DEF-031: Form field page references stale after merge before', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // 1. Open form.pdf (1 page)
  const formPath = getSamplePath('form.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, formPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 20000 });

  // Verify initial state: 1 page, form fields on page 1
  await window.waitForFunction(() => window.tflexDiagnostics().formFieldsLoaded, { timeout: 10000 });
  const diagInit = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagInit.pageCount).toBe(1);
  const fieldInit = diagInit.formFields[0];
  expect(fieldInit.page).toBe(1);

  // 2. Open Merge dialog and pick report.pdf (34 pages)
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);

  await window.click('button[aria-label="Merge with another PDF"]');
  await window.waitForSelector('.modal-dialog');
  
  await window.click('.modal-dialog button:has-text("Choose PDF")');
  // Use a looser check or wait for the text to appear
  await window.waitForSelector('.modal-picked:has-text("report.pdf")', { timeout: 10000 });

  // 3. Select "Before" position
  await window.click('label:has-text("Before") input');

  // 4. Confirm Merge
  await window.click('.modal-footer button:has-text("Merge")');
  await window.waitForSelector('.modal-dialog', { state: 'hidden' });
  
  // Wait for page count to update and fields to be re-derived
  await window.waitForFunction(() => window.tflexDiagnostics().pageCount === 35, { timeout: 10000 });
  await window.waitForFunction(() => window.tflexDiagnostics().formFieldsLoaded, { timeout: 10000 });

  // 5. Verify results: 35 pages, form field should be on page 35
  const diagFinal = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagFinal.pageCount).toBe(35);
  
  const fieldFinal = diagFinal.formFields[0];
  console.log(`DEF-031 verification: Field page is ${fieldFinal.page} (expected 35)`);
  
  expect(fieldFinal.page).toBe(35);

  await electronApp.close();
});
