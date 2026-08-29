const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 10: Edit Content (Text Only)', async () => {
  test.setTimeout(60000);
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));

  // 1. Edit text run in report.pdf
  console.log('Testing text run edit...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 15000 });

  // Toggle Edit mode
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');

  // Select Text tool
  await window.click('[data-edit-tool="text"]');
  
  // Find "TFlex" span
  const textSpan = window.locator('.textLayer span:has-text("TFlex")').first();
  await textSpan.waitFor({ state: 'visible', timeout: 10000 });
  const box = await textSpan.boundingBox();
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // The EditInlineEditor should appear.
  await window.waitForSelector('.edit-inline-editor textarea', { timeout: 5000 });
  
  // Replace text
  await window.fill('.edit-inline-editor textarea', 'TFlex-Edited');
  await window.click('button[aria-label="Apply edit"]');
  
  // Wait for editor to close
  await expect(window.locator('.edit-inline-editor')).toHaveCount(0);
  console.log('Text edit committed.');

  // 2. Add text box
  console.log('Testing add text box...');
  await window.click('[data-edit-tool="box"]');
  await window.mouse.move(400, 400);
  await window.mouse.down();
  await window.mouse.move(600, 500);
  await window.mouse.up();

  await window.waitForSelector('.edit-inline-editor textarea');
  await window.fill('.edit-inline-editor textarea', 'New Text Box');
  await window.click('button[aria-label="Apply edit"]');
  console.log('Text box added.');

  // 3. Undo
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(300);
  console.log('Undo performed.');

  // 4. Save and Reopen
  const outputPath = path.join(process.cwd(), 'test-fixtures', 'phase10-out.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outputPath);

  await window.click('button[aria-label="Save As"]');
  await window.waitForSelector('.toast-info:has-text("Saved")');

  await window.keyboard.press('Control+w');
  await window.waitForSelector('button:has-text("Open PDF")');

  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outputPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  // Verify via search
  await window.click('button[title*="Find in document"]');
  await window.fill('input[placeholder="Search..."]', 'TFlex-Edited');
  await window.waitForSelector('.search-hit-active', { timeout: 5000 });
  console.log('Verified edited text survives save/reopen.');

  await electronApp.close();
});
