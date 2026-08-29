const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test('Retest DEF-033: Outline regression', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();

  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  // 1. Open report.pdf from test-fixtures (has outline)
  console.log('Opening test-fixtures/report.pdf...');
  const reportPath = path.resolve(__dirname, '../test-fixtures/report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 10000 });

  // 2. Check for Bookmarks icon in SideRail
  console.log('Checking for Bookmarks icon in side rail...');
  await window.screenshot({ path: path.join(screenshotsDir, 'retest-def-033-debug.png') });
  const bookmarksButton = window.locator('button[title="Bookmarks"]');
  await expect(bookmarksButton).toBeVisible();

  // 3. Click Bookmarks icon and verify outline entries
  console.log('Clicking Bookmarks icon...');
  await bookmarksButton.click();
  
  await window.waitForSelector('.outline-link', { timeout: 5000 });
  const outlineCount = await window.locator('.outline-link').count();
  console.log(`Found ${outlineCount} outline items.`);
  
  // report.pdf should have 8 outline nodes according to DEF-033 description
  expect(outlineCount).toBe(8);

  await window.screenshot({ path: path.join(screenshotsDir, 'retest-def-033.png') });

  await electronApp.close();
});
