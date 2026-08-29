const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Phase 10: Quick Check', async () => {
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
  
  const textBtn = window.locator('[data-edit-tool="text"]');
  await textBtn.click();
  await expect(textBtn).toHaveClass(/edit-toolbar-btn-active/);
  
  const boxBtn = window.locator('[data-edit-tool="box"]');
  await boxBtn.click();
  await expect(boxBtn).toHaveClass(/edit-toolbar-btn-active/);

  const imageBtn = window.locator('[data-edit-tool="image"]');
  const imageBtnCount = await imageBtn.count();
  console.log('Image tool button count:', imageBtnCount);

  await electronApp.close();
});
