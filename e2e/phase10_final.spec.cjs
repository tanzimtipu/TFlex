const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('Phase 10 Verification', async () => {
  test.setTimeout(120000);
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // 1. Text edit verification
  console.log('Step 1: Text edit');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  
  await window.click('[data-edit-tool="text"]');
  
  // Wait for text layer
  await window.waitForSelector('.textLayer span', { timeout: 10000 });
  
  // Click "TFlex Technical Report"
  const target = window.locator('.textLayer span:has-text("TFlex Technical Report")').first();
  await target.click();
  
  await window.waitForSelector('.edit-inline-editor textarea');
  await window.fill('.edit-inline-editor textarea', 'TFlex-Edited');
  await window.click('button[aria-label="Apply edit"]');
  await expect(window.locator('.edit-inline-editor')).toHaveCount(0);

  // 2. Add text box
  console.log('Step 2: Add box');
  await window.click('[data-edit-tool="box"]');
  const canvas = window.locator('.pdf-page-canvas').first();
  const cBox = await canvas.boundingBox();
  await window.mouse.click(cBox.x + 100, cBox.y + 100); // Click to place default box
  
  await window.waitForSelector('.edit-inline-editor textarea');
  await window.fill('.edit-inline-editor textarea', 'New Box');
  await window.click('button[aria-label="Apply edit"]');
  
  // 3. Undo
  console.log('Step 3: Undo');
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(500);

  // 4. Save and Reopen
  console.log('Step 4: Save/Reopen');
  const outPath = path.join(process.cwd(), 'test-fixtures', 'p10-out.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await window.click('button[aria-label="Save As"]');
  await window.waitForSelector('.toast-info:has-text("Saved")');
  
  await window.keyboard.press('Control+w');
  await window.waitForSelector('button:has-text("Open PDF")');
  
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  
  // Verify via search
  await window.click('button[title*="Find in document"]');
  await window.fill('input[placeholder="Search..."]', 'TFlex-Edited');
  await window.waitForSelector('.search-hit-active');

  // 5. Font persistence
  console.log('Step 5: Font persistence');
  await window.click('[data-toolbar-edit-toggle]');
  await window.selectOption('select[aria-label="Default font"]', 'Courier');
  
  await electronApp.close();
  
  const electronApp2 = await launchApp();
  const window2 = await electronApp2.firstWindow();
  await window2.waitForSelector('button:has-text("Open PDF")');
  
  await electronApp2.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window2.click('button:has-text("Open PDF")');
  await window2.waitForSelector('.workspace');
  await window2.click('[data-toolbar-edit-toggle]');
  
  const font = await window2.locator('select[aria-label="Default font"]').inputValue();
  console.log('Font after restart:', font);
  expect(font).toBe('Courier');
  
  await electronApp2.close();
  console.log('DONE');
});
