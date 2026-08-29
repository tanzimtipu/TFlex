const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test.describe('DEF-043 Retest: Custom color persistence on restart', () => {
  let electronApp;
  let page;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('custom colors added to light/dark themes persist after restart', async () => {
    // 1. Launch app
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const userDataDir = path.join(os.tmpdir(), `tflex-retest-def-043-${Date.now()}`);

    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });

    // 2. Open a PDF
    await page.locator('.samples-grid').getByText('report.pdf').click();
    await page.waitForSelector('.workspace');

    // 3. Select Highlight tool and open palette
    await page.click('[data-tool="highlight"]');
    const swatch = page.locator('.ann-color-swatch-main');
    await swatch.click();
    await expect(page.locator('.color-popover')).toBeVisible();

    // 4. Ensure we are in light theme for start
    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (initialTheme !== 'light') {
        await page.click('.theme-toggle');
        await page.waitForTimeout(500);
        // Re-open palette if closed after theme toggle
        if (!(await page.locator('.color-popover').isVisible())) {
            await swatch.click();
        }
    }

    // 5. Add a light theme color
    const pad = page.locator('[data-palette-pad]');
    const padBox = await pad.boundingBox();
    // Click at specific coordinates to get a predictable color
    await page.mouse.click(padBox.x + 20, padBox.y + 20);
    const lightHex = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log('Adding light hex:', lightHex);
    await page.click('[data-palette-add]');
    await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).toBeVisible();

    // 6. Switch to dark theme and add a color
    await page.click('.theme-toggle');
    await page.waitForTimeout(1000); // Wait for debounce and broadcast
    
    // Re-open palette if closed
    if (!(await page.locator('.color-popover').isVisible())) {
        await swatch.click();
    }
    
    // Click at different position for dark theme
    await page.mouse.click(padBox.x + padBox.width - 20, padBox.y + padBox.height - 20);
    const darkHex = (await page.locator('.color-palette-hex').textContent()).toLowerCase();
    console.log('Adding dark hex:', darkHex);
    await page.click('[data-palette-add]');
    await expect(page.locator(`[data-palette-custom="${darkHex}"]`)).toBeVisible();

    // 7. Verify light hex is NOT in dark theme
    await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).not.toBeVisible();

    // 8. Close app
    console.log('Closing app for restart...');
    await page.waitForTimeout(500); // Give IPC a chance to reach main
    await electronApp.close();
    electronApp = null;

    // 9. Restart app
    console.log('Restarting app...');
    electronApp = await launchApp([], userDataDir);
    page = await electronApp.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });

    // 10. Open PDF again
    await page.locator('.samples-grid').getByText('report.pdf').click();
    await page.waitForSelector('.workspace');
    await page.click('[data-tool="highlight"]');
    const swatch2 = page.locator('.ann-color-swatch-main');
    await swatch2.click();
    await expect(page.locator('.color-popover')).toBeVisible();

    // 11. Check persistence in current theme (which should be dark if it persisted from step 6)
    const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log('Current theme after restart:', currentTheme);
    
    if (currentTheme === 'dark') {
        await expect(page.locator(`[data-palette-custom="${darkHex}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).not.toBeVisible();
        
        // Switch to light and check
        await page.click('.theme-toggle');
        await page.waitForTimeout(500);
        // Re-open palette if closed
        if (!(await page.locator('.color-popover').isVisible())) {
            await swatch2.click();
        }
        await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${darkHex}"]`)).not.toBeVisible();
    } else {
        await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${darkHex}"]`)).not.toBeVisible();
        
        // Switch to dark and check
        await page.click('.theme-toggle');
        await page.waitForTimeout(500);
        // Re-open palette if closed
        if (!(await page.locator('.color-popover').isVisible())) {
            await swatch2.click();
        }
        await expect(page.locator(`[data-palette-custom="${darkHex}"]`)).toBeVisible();
        await expect(page.locator(`[data-palette-custom="${lightHex}"]`)).not.toBeVisible();
    }

    await page.screenshot({ path: 'screenshots/def-043-retest.png' });
    console.log('DEF-043 retest passed');
  });
});
