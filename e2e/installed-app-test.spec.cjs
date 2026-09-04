const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test.describe('Installed App Verification', () => {
  let electronApp;
  let firstWindow;
  const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

  test.beforeAll(async () => {
    console.log(`Launching installed app at: ${installedPath}`);
    if (!fs.existsSync(installedPath)) {
      throw new Error(`Installed app not found at ${installedPath}`);
    }
    // Launch WITHOUT the sample path argument for now, we'll click it.
    electronApp = await launchApp([], null, installedPath);
    firstWindow = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('Issue reproduction steps', async () => {
    const samplePath = getSamplePath('report.pdf');
    
    // Override the open dialog in the main process
    await electronApp.evaluate(async ({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, samplePath);

    await firstWindow.screenshot({ path: 'screenshots/installed_initial.png' });
    
    // 1. Open a sample PDF
    await firstWindow.click('button:has-text("Open PDF")');
    console.log('Clicked Open PDF button');
    
    // Wait for either workspace or an error toast
    await Promise.race([
      firstWindow.waitForSelector('.workspace', { timeout: 20000 }),
      firstWindow.waitForSelector('.toast-error', { timeout: 20000 })
    ]);

    const hasErrorToast = await firstWindow.evaluate(() => {
      const toast = document.querySelector('.toast-error');
      return toast ? toast.innerText : null;
    });
    if (hasErrorToast) {
        console.log('Error toast found:', hasErrorToast);
    }
    await firstWindow.screenshot({ path: 'screenshots/installed_1_open.png' });

    // 2. Go to Sign tool -> choose a saved signature (or draw one) -> place on page.
    await firstWindow.click('button[aria-label="Sign tool"]');
    await firstWindow.waitForSelector('.sig-manager');
    
    // Switch to Type tab to create one quickly
    await firstWindow.click('.sig-tab:has-text("Type")');
    await firstWindow.fill('input[aria-label="Type your signature"]', 'QA Test');
    await firstWindow.click('.sig-manager button:text-is("Save")');
    
    // Pick the one we just saved
    await firstWindow.click('.sig-saved-pick');
    
    // Now it should be armed. 
    // 3. When ghost follows cursor: screenshot what the ghost ACTUALLY shows.
    // Move to the middle of the document
    const docView = firstWindow.locator('.workspace');
    const box = await docView.boundingBox();
    // Move to roughly center of first page
    await firstWindow.mouse.move(box.x + 400, box.y + 400);
    
    // Wait a bit for rendering
    await firstWindow.waitForTimeout(1000);
    await firstWindow.screenshot({ path: 'screenshots/installed_2_ghost.png' });
    
    // Place it
    await firstWindow.mouse.click(box.x + 400, box.y + 400);
    
    // 4. Click Confirm/Cancel on the pending action bar: do they respond? Screenshot the state.
    await firstWindow.waitForSelector('[data-sig-action-bar]');
    await firstWindow.screenshot({ path: 'screenshots/installed_3_action_bar.png' });
    
    const confirmBtn = firstWindow.locator('[data-sig-action="confirm"]');
    await confirmBtn.click();
    
    // Verify it's committed (pending bar gone)
    await expect(firstWindow.locator('[data-sig-action-bar]')).not.toBeVisible();
    await firstWindow.screenshot({ path: 'screenshots/installed_4_confirmed.png' });
    
    // 5. Arm a stamp: click Theme toggle — does it work or swallowed?
    // Open tools palette
    await firstWindow.click('[data-tools-toggle]');
    await firstWindow.waitForSelector('[data-tools-palette]');
    
    // Click Stamp tool
    await firstWindow.click('[data-tool-id="stamp"]');
    
    // Stamp dialog should open
    await firstWindow.waitForSelector('.modal-dialog');
    // Pick APPROVED
    await firstWindow.click('.dialog button:text-is("APPROVED")');
    await firstWindow.click('.dialog button:text-is("Confirm")');
    
    // Now stamp is armed. Move mouse to see ghost.
    await firstWindow.mouse.move(box.x + 300, box.y + 300);
    
    // Click Theme toggle
    const themeToggle = firstWindow.locator('.theme-toggle');
    await themeToggle.click();
    
    // Check if theme changed
    await firstWindow.waitForTimeout(1000);
    await firstWindow.screenshot({ path: 'screenshots/installed_5_theme_toggle.png' });
  });
});
