const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Isolate Audit Space Crash', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  await window.click('[aria-label="Tools palette"]');
  await window.waitForSelector('.tools-palette');

  console.log('Clicking Audit space usage...');
  await window.click('[data-tool-id="audit"]');
  await window.waitForSelector('.sheet, .dialog', { timeout: 10000 });
  console.log('Audit dialog appeared.');

  await electronApp.close();
});
