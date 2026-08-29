const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const os = require('node:os');

test('DEF-036: Opening PDF into empty tab fills workspace', async () => {
  const userDataDir = path.join(os.tmpdir(), `tflex-def-036-${Date.now()}`);
  const electronApp = await launchApp([], userDataDir);
  const window = await electronApp.firstWindow();
  
  window.on('console', msg => console.log('RENDERER:', msg.text()));
  
  await window.screenshot({ path: 'screenshots/debug-launch.png' });

  // 1. Launch the app (already done)
  // 2. Click the "New empty tab" button (+) in the header.
  console.log('Clicking + button...');
  const plusBtn = window.locator('button[aria-label="New empty tab"]');
  await expect(plusBtn).toBeVisible();
  await plusBtn.click();
  
  await window.screenshot({ path: 'screenshots/def-036-after-plus.png' });

  // 3. Observe the "Empty tab" placeholder appears and the Welcome screen is shown.
  console.log('Checking for tab bar and welcome screen...');
  
  await expect(window.locator('.tab.tab-active')).toContainText('Empty tab');
  
  const welcomeContent = await window.locator('.welcome').innerHTML();
  console.log('Welcome Content length:', welcomeContent.length);
  if (welcomeContent.length < 100) {
      console.log('Welcome Content is suspicious:', welcomeContent);
  }
  await expect(window.locator('.welcome')).toBeVisible();

  // 4. From the Welcome screen in the empty tab, click "Open PDF" and select any valid PDF (e.g., report.pdf).
  console.log('Opening report.pdf into empty tab...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  // There are two "Open PDF" buttons in the welcome screen potentially, or one.
  // In the screenshot it says "Open PDF".
  await window.click('.welcome button:has-text("Open PDF")');

  // 5. Observe the tab is renamed to the PDF's filename.
  await expect(window.locator('.tab.tab-active')).toContainText('report.pdf');

  // Expected: The Welcome screen should be replaced by the DocumentView (workspace) showing the PDF content.
  await expect(window.locator('.welcome')).not.toBeVisible();
  await expect(window.locator('.workspace')).toBeVisible();
  
  // Take screenshot as evidence
  await window.screenshot({ path: 'screenshots/def-036-retest.png' });

  await electronApp.close();
});
