const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const installedPath = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test('B4 targeted verification', async () => {
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

    await window.click('button[data-tool="note"]');
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    
    console.log('Clicking page to place note...');
    await window.mouse.click(box.x + 150, box.y + 150);
    
    try {
        await window.waitForSelector('[data-annotation-editor="note"]', { timeout: 10000 });
        console.log('Note editor found.');
        await window.fill('[data-annotation-editor="note"] textarea', 'B4 Verification Content');
        await window.click('button:text-is("Save")');
        
        await expect(window.locator('.sticky-note-icon')).toBeVisible();
        await window.screenshot({ path: 'screenshots/repro_B4_final.png' });
    } catch (e) {
        console.log('Note editor NOT FOUND.');
        await window.screenshot({ path: 'screenshots/repro_B4_fail.png' });
        // Dump DOM
        const html = await window.locator('.workspace').innerHTML();
        console.log('Workspace HTML snippet:', html.substring(0, 1000));
    }

    await electronApp.close();
});
