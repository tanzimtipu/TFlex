const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

// IPC constants from src/shared/ipc.ts
const IPC = {
  updateStatusChangedEvent: "update:statusChanged",
  menuActionEvent: "menu:action",
};

test.describe('DEF-077: OTA UX Retest', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('Toolbar indicator and About dialog respond to update availability', async () => {
    // console.log('Waiting for initial update status (likely error due to no token)...');
    // skip wait

    console.log('--- Phase 1: Verify indicator appears on available status ---');
    const updateAvailable = {
      kind: 'available',
      version: '1.6.0',
      releaseDate: '2026-08-31'
    };

    // Inject state change from "Main"
    await electronApp.evaluate(({ BrowserWindow }, { channel, state }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send(channel, state);
    }, { channel: IPC.updateStatusChangedEvent, state: updateAvailable });

    // Check for toolbar indicator
    const indicator = window.locator('[data-update-indicator]');
    await expect(indicator).toBeVisible({ timeout: 20000 });
    await expect(indicator).toHaveAttribute('data-update-indicator-kind', 'available');
    console.log('Toolbar indicator is visible and correct.');
    
    // Check About dialog
    console.log('Opening About dialog via menu action...');
    await electronApp.evaluate(({ BrowserWindow }, channel) => {
      const wins = BrowserWindow.getAllWindows();
      console.log(`Found ${wins.length} windows`);
      const win = wins[0];
      if (win) {
        win.webContents.send(channel, { action: 'about' });
      }
    }, IPC.menuActionEvent);

    await window.waitForSelector('[data-about-dialog]:visible');
    const aboutUpdate = window.locator('[data-about-update]');
    
    // It might take a moment for AboutDialog to pick up the injected event if it was just opened
    await expect(aboutUpdate).toContainText('Update available: v1.6.0', { timeout: 10000 });
    console.log('About dialog shows update availability.');
    
    const downloadBtn = window.locator('button[data-update-download-btn]');
    // Wait, let's verify the selector for the download button.
    // I'll check UpdateIndicator.tsx or AboutDialog.tsx for the exact selector.
    // I'll use a text-based locator if unsure.
    const downloadBtnActual = window.locator('button:has-text("Download")');
    await expect(downloadBtnActual).toBeVisible();
    
    // 2. Click download and verify transition
    console.log('--- Phase 2: Click download and verify downloading state ---');
    await downloadBtnActual.click();
    
    // Simulate downloading state
    const downloadingState = {
        kind: 'downloading',
        progress: 50
    };
    await electronApp.evaluate(({ BrowserWindow }, { channel, state }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send(channel, state);
    }, { channel: IPC.updateStatusChangedEvent, state: downloadingState });
    
    await expect(indicator).toHaveAttribute('data-update-indicator-kind', 'downloading');
    await expect(indicator).toHaveAttribute('data-update-indicator-progress', '50');
    await expect(aboutUpdate).toContainText('Downloading… 50%');
    console.log('Downloading state reflected in UI.');
    
    // 3. Simulate downloaded state
    console.log('--- Phase 3: Verify downloaded state and restart button ---');
    const downloadedState = {
        kind: 'downloaded',
        version: '1.6.0'
    };
    await electronApp.evaluate(({ BrowserWindow }, { channel, state }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send(channel, state);
    }, { channel: IPC.updateStatusChangedEvent, state: downloadedState });
    
    await expect(indicator).toHaveAttribute('data-update-indicator-kind', 'downloaded');
    await expect(aboutUpdate).toContainText('Update ready: v1.6.0');
    
    const restartBtn = window.locator('button:has-text("Restart")');
    await expect(restartBtn).toBeVisible();
    console.log('Restart button is visible after download.');
    
    // 4. Click restart
    console.log('Clicking restart...');
    await restartBtn.click();
    // In a real app this would quit, but in our mock it just sends the IPC.
    console.log('Retest of OTA UX flow complete.');
  });
});
