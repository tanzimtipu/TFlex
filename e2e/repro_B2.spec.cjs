const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const installedPath = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test('B2 targeted verification', async () => {
    const electronApp = await launchApp([], 'default', installedPath);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const samplePath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForSelector('.pdf-page');

    await window.click('button[data-tool="textbox"]');
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    
    await window.mouse.click(box.x + 300, box.y + 300);
    await window.waitForSelector('[data-annotation-action-bar="textbox"]');
    await window.screenshot({ path: 'screenshots/repro_B2_bar_visible.png' });
    
    // Type something
    await window.fill('[data-annotation-editor="textbox"]', 'Testing B2');
    await window.screenshot({ path: 'screenshots/repro_B2_typed.png' });
    
    // Try to click Confirm
    console.log('Clicking Confirm...');
    await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
    
    // Wait for bar to go away
    try {
        await window.waitForSelector('[data-annotation-action-bar="textbox"]', { state: 'hidden', timeout: 5000 });
        console.log('Bar hidden.');
    } catch (e) {
        console.log('Bar STILL VISIBLE.');
        await window.screenshot({ path: 'screenshots/repro_B2_fail.png' });
    }

    // Try Cancel
    console.log('Clicking Cancel...');
    await window.click('[data-annotation-action="textbox-cancel"]', { force: true });
    try {
        await window.waitForSelector('[data-annotation-action-bar="textbox"]', { state: 'hidden', timeout: 5000 });
        console.log('Bar hidden after Cancel.');
    } catch (e) {
        console.log('Bar STILL VISIBLE after Cancel.');
        await window.screenshot({ path: 'screenshots/repro_B2_fail_cancel.png' });
    }

    await electronApp.close();
});
