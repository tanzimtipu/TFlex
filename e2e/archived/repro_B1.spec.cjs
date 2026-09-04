const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('B1 targeted verification', async () => {
    const electronApp = await launchApp([], 'default');
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const samplePath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForSelector('.pdf-page');

    await window.click('[aria-label="Sign tool"]');
    await window.waitForSelector('.sig-manager');
    await window.click('.sig-tab:has-text("Type")');
    await window.fill('input[aria-label="Type your signature"]', 'QA B1');
    await window.click('.sig-manager button:text-is("Save")');
    await window.click('.sig-saved-pick');
    
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    
    // Move to place
    await window.mouse.click(box.x + 100, box.y + 100);
    await window.waitForSelector('[data-sig-action-bar]');
    await window.screenshot({ path: 'screenshots/repro_B1_bar_visible.png' });
    
    // Click Cancel
    console.log('Clicking Cancel...');
    await window.click('[data-sig-action="cancel"]');
    
    // Wait for bar to go away
    await window.waitForSelector('[data-sig-action-bar]', { state: 'hidden' });
    console.log('Bar hidden.');
    
    // Wait for state to potentially update
    await window.waitForTimeout(2000);
    
    const signBtn = window.locator('[aria-label="Sign tool"]');
    const isPressed = await signBtn.getAttribute('aria-pressed');
    console.log(`Sign tool aria-pressed: ${isPressed}`);
    
    await window.screenshot({ path: 'screenshots/repro_B1_after_cancel.png' });
    
    // Move mouse to see if ghost appears
    await window.mouse.move(box.x + 300, box.y + 300);
    await window.waitForTimeout(500);
    await window.screenshot({ path: 'screenshots/repro_B1_ghost_check.png' });

    await hardClose(electronApp);
    expect(isPressed).toBe('false');
});
