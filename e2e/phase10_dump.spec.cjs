const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const fs = require('node:fs');

test('Phase 10: Dump HTML', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  
  const html = await window.locator('.workspace').innerHTML();
  fs.writeFileSync('workspace_dump.html', html);
  
  await electronApp.close();
});
