const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Retest DEF-068', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  
  // Select Highlight tool
  await window.click('[aria-label="Highlight"]');
  
  // Click on the page to create annotation (mocking coordinates)
  await window.click('.page-view', { position: { x: 100, y: 100 } });
  
  // Wait for diagnostics to update
  await window.waitForFunction(() => {
    const diag = window.tflexDiagnostics();
    return diag.engineState && diag.engineState.annotations.length > 0;
  }, { timeout: 10000 });
  
  const diag = await window.evaluate(() => window.tflexDiagnostics());
  console.log('Annotations count:', diag.engineState.annotations.length);
  
  expect(diag.engineState.annotations.length).toBeGreaterThan(0);
  
  await electronApp.close();
});
