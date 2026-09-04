const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('path');

test.describe('DEF-085 Retest: Header Alignment', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('Header actions are right-aligned', async () => {
    const headerActions = window.locator('.header-actions');
    await expect(headerActions).toBeVisible();

    const titlebar = window.locator('.titlebar');
    const controls = window.locator('.titlebar-controls'); // Window min/max/close

    const headerBox = await headerActions.boundingBox();
    const titlebarBox = await titlebar.boundingBox();
    const controlsBox = await controls.boundingBox();

    console.log('Header Actions Box:', headerBox);
    console.log('Titlebar Box:', titlebarBox);
    console.log('Controls Box:', controlsBox);

    // If right-aligned, headerActions.x + headerActions.width should be close to controls.x
    // Or at least much further right than the left side.
    
    const rightEdge = headerBox.x + headerBox.width;
    const controlsLeftEdge = controlsBox.x;
    
    console.log(`Right Edge of Actions: ${rightEdge}`);
    console.log(`Left Edge of Controls: ${controlsLeftEdge}`);

    // Take screenshot for visual confirmation BEFORE assertions
    const screenshotPath = path.join(__dirname, '../../screenshots/def-085-retest.png');
    await window.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // Allow some margin but they should be adjacent or very close
    expect(rightEdge).toBeGreaterThan(titlebarBox.width / 2); // Should be in the right half
    expect(controlsLeftEdge - rightEdge).toBeLessThan(20); // Should be near the controls
  });
});
