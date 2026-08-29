const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('DEF-018 and DEF-019 Retests', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    window.on('console', msg => console.log('RENDERER:', msg.text()));
    // Wait for welcome screen
    await window.waitForSelector('.welcome', { timeout: 20000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('DEF-018: Rotate/Delete rail buttons visible on thumbnail selection', async () => {
    // 1. Open report.pdf (using temp copy for DEF-026)
    console.log('Opening report.pdf (temp copy)...');
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace', { timeout: 20000 });

    // 2. Select a page thumbnail in the left rail
    console.log('Selecting thumbnail...');
    const thumb = window.locator('.thumb[data-page="1"]');
    await thumb.waitFor({ state: 'visible', timeout: 10000 });
    
    // Use Ctrl+Click to match the user's focus
    await window.keyboard.down('Control');
    await thumb.click();
    await window.keyboard.up('Control');

    // 3. Observe the overlay tools on the selected thumbnail
    // They are usually child elements of the selected thumbnail or sibling overlays
    console.log('Checking buttons visibility...');
    const rotateCw = window.locator('button[aria-label="Rotate clockwise"]');
    const rotateCcw = window.locator('button[aria-label="Rotate counter-clockwise"]');
    const deleteBtn = window.locator('button[aria-label="Delete this page"]');

    await expect(rotateCw).toBeVisible({ timeout: 10000 });
    await expect(rotateCcw).toBeVisible({ timeout: 10000 });
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });

    const screenshotsDir = path.join(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    await window.screenshot({ path: path.join(screenshotsDir, 'retest-def-018.png') });
    console.log('DEF-018 verified.');
  });

  test('DEF-019: save in flight + deletes', async () => {
    // 1. Open report.pdf (34 pages) (using temp copy for DEF-026)
    console.log('Opening report.pdf for DEF-019 (temp copy)...');
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace', { timeout: 20000 });

    const getDiag = () => window.evaluate(() => window.tflexDiagnostics());
    
    // Wait for engine to be ready
    await window.waitForFunction(() => {
        const d = window.tflexDiagnostics();
        return d && d.engineState && d.pageCount === 34;
    }, { timeout: 20000 });

    const diagStart = await getDiag();
    expect(diagStart.pageCount).toBe(34);

    // 2. Mock save dialog
    const tempSavePath = path.join(process.env.TEMP || 'C:\\Users\\tanzi\\AppData\\Local\\Temp', `def019-test-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, tempSavePath);

    // 3. Trigger a save (Ctrl+S)
    console.log('Triggering save...');
    await window.keyboard.press('Control+s');

    // 4. Immediately delete 3 pages while the save is in progress.
    console.log('Deleting 3 pages during save...');
    
    for (let i = 0; i < 3; i++) {
        const thumb = window.locator('.thumb[data-page="1"]');
        // Use Control+Click to select so the action bar appears
        await thumb.click({ modifiers: ['Control'] });
        const delBtn = window.locator('button[aria-label="Delete this page"]');
        await delBtn.waitFor({ state: 'visible', timeout: 5000 });
        await delBtn.click();
        // Wait for page count to decrease
        const expectedCount = 34 - (i + 1);
        await window.waitForFunction((cnt) => window.tflexDiagnostics().pageCount === cnt, expectedCount, { timeout: 5000 });
    }

    // 5. Wait for the save to complete and check state
    console.log('Waiting for state to settle...');
    
    // The bug was that modified became false and changes were lost.
    // We expect pageCount 31 and modified true.
    const diagFinal = await getDiag();
    console.log('Final state:', diagFinal.pageCount, 'pages, modified:', diagFinal.modified);
    
    expect(diagFinal.pageCount).toBe(31);
    expect(diagFinal.modified).toBe(true);

    const screenshotsDir = path.join(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    await window.screenshot({ path: path.join(screenshotsDir, 'retest-def-019.png') });
    
    if (fs.existsSync(tempSavePath)) fs.unlinkSync(tempSavePath);
    console.log('DEF-019 verified.');
  });
});
