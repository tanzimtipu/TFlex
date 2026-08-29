const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('smoke', async () => {
  const electronApp = await launchApp();

  const window = await electronApp.firstWindow();

  await window.waitForSelector('.sample-card', { timeout: 10000 });
  const sampleCount = await window.$$eval('.sample-card', el => el.length);
  expect(sampleCount).toBeGreaterThanOrEqual(4);

  // Using temp copy for DEF-026
  console.log('Opening report.pdf (temp copy)...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 10000 });

  const diag = await window.evaluate(() => window.tflexDiagnostics());
  expect(diag.pageCount).toBe(34);

  await electronApp.close();
});
