const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('B3 targeted verification', async () => {
    const electronApp = await launchApp([], 'default');
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const samplePath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    await window.click('button[data-tool="highlight"]');
    await window.click('.ann-color-swatch-main');
    await window.waitForSelector('[data-color-popover]');
    await window.screenshot({ path: 'screenshots/repro_B3_popover.png' });
    
    const hexInput = window.locator('input[data-hex-input]');
    if (await hexInput.isVisible()) {
        console.log('Hex input visible.');
        await hexInput.click();
        await hexInput.fill('#00ff00');
        await window.keyboard.press('Enter');
        
        await window.waitForTimeout(1000);
        const color = await window.locator('.ann-color-swatch-main').evaluate(el => el.style.backgroundColor);
        console.log(`Swatch color: ${color}`);
        await window.screenshot({ path: 'screenshots/repro_B3_final.png' });
    } else {
        console.log('Hex input NOT FOUND.');
        // Dump DOM around popover
        const html = await window.locator('[data-color-popover]').innerHTML();
        console.log('Popover HTML:', html);
    }

    await hardClose(electronApp);
});
