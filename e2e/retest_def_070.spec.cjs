const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('DEF-070 Retest', async () => {
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
  await window.click('button[aria-label="Highlight"]');
  
  // Click the color swatch (if visible) or the tool button again to open palette?
  // Usually the palette is under the tool.
  await window.click('.color-swatch, [aria-label="Pick color"]');
  
  const hexInput = window.locator('input[aria-label="Custom color hex"]');
  await expect(hexInput).toBeVisible();
  
  await electronApp.close();
});
