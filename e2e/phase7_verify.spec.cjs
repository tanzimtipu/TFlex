const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test.describe('Phase 7 Verification', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    electronApp = await launchApp();
    page = await electronApp.firstWindow();
    // Wait for the app to settle
    await page.waitForSelector('.welcome', { timeout: 20000 });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('visual color picker works and persists per theme', async () => {
    // 1. Open a PDF from samples
    await page.locator('.samples-grid').getByText('report.pdf').click();
    await page.waitForSelector('.workspace');

    // 2. Select Highlight tool
    await page.click('[data-tool="highlight"]');
    
    // 3. Open palette
    const swatch = page.locator('.ann-color-swatch-main');
    await swatch.click();
    await expect(page.locator('.color-popover')).toBeVisible();

    // 4. Verify visual picker elements
    await expect(page.locator('[data-palette-pad]')).toBeVisible();
    await expect(page.locator('[data-palette-hue]')).toBeVisible();

    // 5. Change color using the pad
    const pad = page.locator('[data-palette-pad]');
    const padBox = await pad.boundingBox();
    // Click middle of pad
    await page.mouse.click(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
    
    const previewHex = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log('Preview Hex (Light):', previewHex);

    // 6. Add to palette
    await page.click('[data-palette-add]');
    
    // 7. Verify it appears in "Your colors"
    await expect(page.locator(`[data-palette-custom="${previewHex}"]`)).toBeVisible();

    // 8. Capture screenshot
    await page.screenshot({ path: 'screenshots/p7-verify-color-picker-light.png' });

    // 9. Change theme
    await page.click('.theme-toggle');
    // Wait for theme transition and settings broadcast
    await page.waitForTimeout(1000);

    const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    const presetsCount = await page.locator('[data-palette-custom]').count();
    console.log(`Theme after toggle: ${currentTheme}, Custom colors count: ${presetsCount}`);

    // 10. Re-open palette in dark theme
    if (!(await page.locator('.color-popover').isVisible())) {
      await swatch.click();
    }
    await expect(page.locator('.color-popover')).toBeVisible();
    
    // 11. In dark theme, "Your colors" should NOT have the light-theme color
    await expect(page.locator(`[data-palette-custom="${previewHex}"]`)).not.toBeVisible();
    
    // 12. Add a different color in dark theme
    const hueSlider = page.locator('[data-palette-hue]');
    const hueBox = await hueSlider.boundingBox();
    // Click at a different position on the hue slider
    await page.mouse.click(hueBox.x + 50, hueBox.y + 5); 
    
    const darkPreviewHex = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log('Preview Hex (Dark):', darkPreviewHex);
    await page.click('[data-palette-add]');
    await expect(page.locator(`[data-palette-custom="${darkPreviewHex}"]`)).toBeVisible();

    await page.screenshot({ path: 'screenshots/p7-verify-color-picker-dark.png' });

    // 13. Switch back to light theme and verify persistence
    await page.click('.theme-toggle');
    await page.waitForTimeout(1000);
    
    if (!(await page.locator('.color-popover').isVisible())) {
      await swatch.click();
    }
    await expect(page.locator('.color-popover')).toBeVisible();
    
    // Verify light color exists
    const lightCustom = page.locator(`[data-palette-custom="${previewHex}"]`);
    if (!(await lightCustom.isVisible())) {
        console.log('FAIL: Light color lost. Found instead:', await page.locator('[data-palette-custom]').allTextContents());
    }
    await expect(lightCustom).toBeVisible();
    await expect(page.locator(`[data-palette-custom="${darkPreviewHex}"]`)).not.toBeVisible();
  });

  test('"+" tab control DOM order', async () => {
    // 1. Open a few tabs
    await page.click('[data-new-tab]');
    await page.click('[data-new-tab]');

    // 2. Verify "+" is after the last tab in the list
    const tabListItems = page.locator('.tab-list > li');
    const count = await tabListItems.count();
    expect(count).toBeGreaterThan(1);
    
    const lastItem = tabListItems.nth(count - 1);
    await expect(lastItem.locator('button[data-new-tab]')).toBeVisible();
    
    await page.screenshot({ path: 'screenshots/p7-verify-tabs-order.png' });
  });

  test('App menu items exist and render', async () => {
    // Check if the application menu is set
    const menuItems = await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return null;
      return menu.items.map(item => ({
        label: item.label,
        visible: item.visible,
        enabled: item.enabled
      }));
    });

    console.log('App Menu Items:', menuItems);
    expect(menuItems).not.toBeNull();
    
    // Trigger "About"
    await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const helpMenu = menu.items.find(i => i.label === 'Help');
      const aboutItem = helpMenu.submenu.items.find(i => i.label === 'About TFlex');
      aboutItem.click();
    });
    
    // Use data attribute and wait longer
    const aboutDialog = page.locator('[data-about-dialog]');
    await expect(aboutDialog).toBeVisible({ timeout: 10000 });
    await expect(aboutDialog.locator('h2')).toContainText('About TFlex');
    
    await page.click('button[aria-label="Close about dialog"]');
    await expect(aboutDialog).not.toBeVisible();
    
    await page.screenshot({ path: 'screenshots/p7-verify-menu-about.png' });
  });
});
