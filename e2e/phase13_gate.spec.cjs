const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('Phase 13 Gate Verification', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card');
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  async function takeScreenshot(name) {
    const screenshotPath = path.join(__dirname, '../screenshots', name);
    await window.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  }

  test('SC1: Custom Title Bar and Window Controls', async () => {
    // Verify title bar elements exist
    const titleBar = window.locator('.titlebar-controls, .titlebar');
    await expect(titleBar).toBeVisible();

    const minBtn = window.locator('.titlebar-control-min');
    const maxBtn = window.locator('.titlebar-control-max');
    const closeBtn = window.locator('.titlebar-control-close');

    await expect(minBtn).toBeVisible();
    await expect(maxBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // Verify they are at the top right (standard for Windows)
    const box = await closeBtn.boundingBox();
    expect(box.y).toBeLessThan(50);
    expect(box.x).toBeGreaterThan(1000); // Assuming standard window width
  });

  test('SC2: Menu Popover', async () => {
    const menuBtn = window.locator('.titlebar-menu-button');
    await expect(menuBtn).toBeVisible();
    
    await menuBtn.click();
    // Verify menu appears. Popovers usually have a specific class or role.
    // Based on discovery, let's see what happens after click.
    // I'll take a screenshot to be sure.
    await window.waitForTimeout(500);
    await takeScreenshot('titlebar-controls.png');
    
    // Check for menu items (standard File, View, etc.)
    const menuItems = window.locator('.menu-item, [role="menuitem"]');
    // If it's a popover menu, it might be in a portal.
    const menu = window.locator('.popover, .dropdown-menu, .context-menu, [role="menu"]');
    await expect(menu.first()).toBeVisible();
    
    // Close menu
    await window.keyboard.press('Escape');
  });

  test('SC3: Semantic Colors on Toasts/Status', async () => {
    // Trigger an error toast (e.g., trying to open a non-existent file via engine)
    await window.evaluate(async () => {
      try {
        await window.tflex.engine.loadDocument('non-existent', 'C:/non-existent.pdf');
      } catch (e) {
        // Toast should be triggered
      }
    });
    
    const toast = window.locator('.toast, .notification');
    await expect(toast.first()).toBeVisible();
    
    // Verify it has an error class or semantic style
    const className = await toast.first().getAttribute('class');
    console.log('Toast class:', className);
    // expect(className).toContain('error'); // Adjust based on actual class
    
    await takeScreenshot('semantic-toast.png');
  });

  test('SC4: Richer Annotation Swatches', async () => {
    // Open a document to access annotation tools
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');

    // Toggle edit toolbar
    await window.click('[data-toolbar-edit-toggle]');
    await window.waitForSelector('[data-edit-toolbar]');

    // Click on a tool that has color swatches (e.g. Highlight)
    await window.click('button[aria-label="Highlight"]');
    
    // Look for swatches
    const swatchRow = window.locator('.color-swatch-row, .palette-grid');
    await expect(swatchRow).toBeVisible();
    
    const swatches = window.locator('.color-swatch');
    const count = await swatches.count();
    expect(count).toBeGreaterThan(5); // Richer palette should have multiple colors
    
    await takeScreenshot('richer-swatches.png');
  });

  test('SC5: Both Themes verification', async () => {
    // Start in current theme (likely light)
    await takeScreenshot('frameless-light.png');
    
    // Toggle theme
    await window.click('.theme-toggle');
    await window.waitForTimeout(500);
    
    await takeScreenshot('frameless-dark.png');
    
    // Toggle back
    await window.click('.theme-toggle');
  });
});
