const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('Retest DEF-048: Reachability and Move verifiable', async () => {
  test.setTimeout(120000);
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  try {
    // 1. Open report.pdf
    console.log('Step 1: Open report.pdf');
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace', { timeout: 20000 });
    
    // 2. Toggle Edit mode
    console.log('Step 2: Toggle Edit mode');
    await window.click('[data-toolbar-edit-toggle]');
    const editToolbar = window.locator('[data-edit-toolbar]').first();
    await expect(editToolbar).toBeVisible({ timeout: 10000 });
    
    // 3. Verify Image tool button
    console.log('Step 3: Verify Image tool reachable');
    const imageTool = editToolbar.locator('[data-edit-tool="image"]');
    await expect(imageTool).toBeVisible({ timeout: 5000 });
    
    const buttons = await editToolbar.locator('button').evaluateAll(btns => btns.map(b => b.innerText));
    console.log('Edit toolbar buttons found:', buttons);
    expect(buttons).toContain('Image');

    await imageTool.click();
    console.log('Image tool clicked.');
    
    // 4. Verify presence of Image tool hint
    const hint = editToolbar.locator('[data-edit-hint]');
    const hintText = await hint.innerText();
    console.log('Hint text:', hintText);
    expect(hintText).toContain('Click an image to select');

    // 5. Add image
    console.log('Step 5: Add image');
    // Find the first page wrapper to get a safe bounding box
    const page = window.locator('.pdf-page').first();
    await page.waitFor({ state: 'visible' });
    const pBox = await page.boundingBox();
    
    const bluePng = path.resolve(process.cwd(), 'test-fixtures', 'blue.png');
    
    // Drag in the middle of the page
    await window.mouse.move(pBox.x + 100, pBox.y + 100);
    await window.mouse.down();
    await window.mouse.move(pBox.x + 300, pBox.y + 300);
    
    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser'),
      window.mouse.up()
    ]);
    await fileChooser.setFiles(bluePng);

    // Verify placement UI appears
    const placement = window.locator('[data-placement-id]').first();
    await expect(placement).toBeVisible({ timeout: 15000 });
    const initialPos = await placement.boundingBox();
    console.log('Image placed at:', initialPos);

    // 6. Move image
    console.log('Step 6: Move image');
    await window.mouse.move(initialPos.x + initialPos.width / 2, initialPos.y + initialPos.height / 2);
    await window.mouse.down();
    await window.mouse.move(initialPos.x + initialPos.width / 2 + 50, initialPos.y + initialPos.height / 2 + 50);
    await window.mouse.up();
    
    await window.waitForTimeout(500);
    const movedPos = await placement.boundingBox();
    console.log('Image moved to:', movedPos);
    expect(movedPos.x).toBeGreaterThan(initialPos.x);

    // 7. Verification of Save
    const outPath = path.join(process.cwd(), 'test-fixtures', 'def048-move-verified.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, outPath);
    await window.click('button[aria-label="Save As"]');
    await window.waitForSelector('.toast-info:has-text("Saved")');
    console.log('Saved with moved image.');

    await window.screenshot({ path: 'screenshots/def048_retest_final.png' });
    console.log('Retest successful.');

  } catch (err) {
    console.error('Retest failed:', err);
    await window.screenshot({ path: 'screenshots/def048_retest_failure.png' });
    throw err;
  } finally {
    await electronApp.close();
  }
});
