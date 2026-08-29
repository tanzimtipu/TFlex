const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test.describe('DEF-037 Retest: Independent color palette persistence', () => {
  let electronApp;
  let page;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('light and dark custom colors persist independently through toggles and restart', async () => {
    // Phase 1: Initial setup and adding colors
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const userDataDir = path.join(os.tmpdir(), `tflex-retest-def-037-${Date.now()}`);

    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });

    // Open report.pdf
    await page.locator('.samples-grid').getByText('report.pdf').click();
    await page.waitForSelector('.workspace');

    let theme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Current theme:', theme);
    
    // Select Highlight tool to show palette
    await page.click('[data-tool="highlight"]');
    let swatch = page.locator('.ann-color-swatch-main');
    await swatch.click();
    await expect(page.locator('.color-popover')).toBeVisible();

    // 1. Add color in initial theme
    const pad = page.locator('[data-palette-pad]');
    const padBox = await pad.boundingBox();
    // Click top left for a specific color
    await page.mouse.click(padBox.x + 10, padBox.y + 10);
    const firstColor = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log(`Color chosen in ${theme}:`, firstColor);
    await page.click('[data-palette-add]');
    await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).toBeVisible();

    // 2. Switch theme
    await page.click('.theme-toggle');
    await page.waitForTimeout(1000); // Wait for transition and settings save
    
    const nextTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('New theme:', nextTheme);

    // Re-open palette if closed
    if (!(await page.locator('.color-popover').isVisible())) {
      await swatch.click();
    }
    
    // 3. Verify first color NOT visible in new theme
    await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).not.toBeVisible();

    // 4. Add color in next theme
    // Click bottom right for a different color
    await page.mouse.click(padBox.x + padBox.width - 10, padBox.y + padBox.height - 10);
    const secondColor = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log(`Color chosen in ${nextTheme}:`, secondColor);
    await page.click('[data-palette-add]');
    await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).toBeVisible();

    // 5. Toggle back to first theme and verify
    await page.click('.theme-toggle');
    await page.waitForTimeout(1000);
    if (!(await page.locator('.color-popover').isVisible())) {
      await swatch.click();
    }
    await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).toBeVisible();
    await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).not.toBeVisible();

    // 6. Toggle back to second theme and verify
    await page.click('.theme-toggle');
    await page.waitForTimeout(1000);
    if (!(await page.locator('.color-popover').isVisible())) {
      await swatch.click();
    }
    await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).toBeVisible();
    await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).not.toBeVisible();

    await page.screenshot({ path: 'screenshots/def-037-before-restart.png' });

    // Close app
    await electronApp.close();
    electronApp = null;

    // Phase 2: Restart and verify persistence
    console.log('Restarting app...');
    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });
    
    // Open document again
    await page.locator('.samples-grid').getByText('report.pdf').click();
    await page.waitForSelector('.workspace');
    
    // Check palette
    await page.click('[data-tool="highlight"]');
    const swatch2 = page.locator('.ann-color-swatch-main');
    await swatch2.click();
    await expect(page.locator('.color-popover')).toBeVisible();

    // We should be in the last theme we left it in
    const finalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Theme after restart:', finalTheme);
    
    if (finalTheme === nextTheme) {
        await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).not.toBeVisible();
        
        // Switch to first theme
        await page.click('.theme-toggle');
        await page.waitForTimeout(1000);
        if (!(await page.locator('.color-popover').isVisible())) {
            await swatch2.click();
        }
        await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).not.toBeVisible();
    } else {
        await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).not.toBeVisible();
        
        // Switch to second theme
        await page.click('.theme-toggle');
        await page.waitForTimeout(1000);
        if (!(await page.locator('.color-popover').isVisible())) {
            await swatch2.click();
        }
        await expect(page.locator(`[data-palette-custom="${secondColor}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${firstColor}"]`)).not.toBeVisible();
    }

    await page.screenshot({ path: 'screenshots/def-037-after-restart.png' });
  });
});
