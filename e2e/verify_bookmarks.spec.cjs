const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Verify Bookmarks for report.pdf', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  await window.click('[title="Bookmarks"]');
  await window.waitForTimeout(1000);
  
  const content = await window.locator('.rail-content').innerText();
  console.log('Rail Content (Bookmarks):', content);
  
  const outlineItems = await window.locator('.outline-item').count();
  console.log('Outline items found:', outlineItems);

  await electronApp.close();
});
