const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test('Retest DEF-038: App Menu Functionality', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // To test the menu:action bridge without needing native menu clicks, 
  // we simulate the IPC message that the Main process sends to the Renderer.
  // In Electron, we can send a message to a WebContents.
  
  console.log('Verifying About dialog opens via simulated menu:action...');
  
  // Wait for app to be ready
  await window.waitForSelector('.welcome');

  // Trigger the 'menu:action' IPC from the main process
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('menu:action', { action: 'about' });
  });

  // Verify About dialog appears
  const aboutDialog = window.locator('.about-dialog');
  await expect(aboutDialog).toBeVisible({ timeout: 5000 });
  await window.click('.about-dialog .btn-close');
  await expect(aboutDialog).not.toBeVisible();

  console.log('Verifying Open PDF via simulated menu:action...');
  // Mock open dialog
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);

  await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('menu:action', { action: 'open' });
  });

  await window.waitForSelector('.workspace', { timeout: 10000 });
  await expect(window.locator('.tab-item.active')).toContainText('report.pdf');

  await electronApp.close();
});

test('Retest DEF-037: Color Palette Persistence', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // 1. Open PDF
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  // 2. Select Highlight tool
  await window.click('[data-tool="highlight"]');
  
  // Ensure we are in Light mode (default)
  const isDark = await window.evaluate(() => document.documentElement.classList.contains('dark'));
  if (isDark) {
    await window.keyboard.press('Control+Shift+T');
    await window.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  }

  // 3. Add custom color to Light theme
  await window.click('.active-tool-swatch');
  await window.click('button:has-text("Custom...")');
  
  // Use the visual picker (assuming it's implemented now)
  // The visual picker has a HEX input too usually, or we can just click the gradient.
  // Let's try to set a specific HEX if available.
  const lightColor = '#ff5555';
  await window.fill('.color-picker-hex', lightColor);
  await window.keyboard.press('Enter');
  
  // Verify it appeared in "Your colors"
  await expect(window.locator(`.swatch-item[data-color="${lightColor}"]`)).toBeVisible();

  // 4. Toggle to Dark theme
  await window.keyboard.press('Control+Shift+T');
  await window.waitForFunction(() => document.documentElement.classList.contains('dark'));
  
  // 5. Add custom color to Dark theme
  await window.click('.active-tool-swatch');
  await window.click('button:has-text("Custom...")');
  const darkColor = '#55ff55';
  await window.fill('.color-picker-hex', darkColor);
  await window.keyboard.press('Enter');
  
  await expect(window.locator(`.swatch-item[data-color="${darkColor}"]`)).toBeVisible();

  // 6. Toggle back to Light theme
  await window.keyboard.press('Control+Shift+T');
  await window.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  
  // 7. Check Light theme color still exists
  await window.click('.active-tool-swatch');
  await expect(window.locator(`.swatch-item[data-color="${lightColor}"]`)).toBeVisible();
  
  // 8. Restart app and verify persistence
  await electronApp.close();
  
  const electronApp2 = await launchApp();
  const window2 = await electronApp2.firstWindow();
  await window2.waitForSelector('.welcome');
  
  // Open same PDF to see toolbar
  await window2.click('.recent-item'); // report.pdf should be first
  await window2.waitForSelector('.workspace');
  await window2.click('[data-tool="highlight"]');
  await window2.click('.active-tool-swatch');
  
  // Check Light theme color
  await expect(window2.locator(`.swatch-item[data-color="${lightColor}"]`)).toBeVisible();
  
  // Toggle to Dark and check
  await window2.keyboard.press('Control+Shift+T');
  await window2.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await window2.click('.active-tool-swatch');
  await expect(window2.locator(`.swatch-item[data-color="${darkColor}"]`)).toBeVisible();

  await electronApp2.close();
});
