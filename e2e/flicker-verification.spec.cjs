const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

// Modified launcher to ensure projectRoot is the first arg
async function launchAppCorrected(extraArgs = []) {
  const projectRoot = path.resolve(__dirname, '..');
  const mainPath = path.join(projectRoot, 'dist', 'main', 'index.js');
  
  const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const tempUserData = path.join(os.tmpdir(), `tflex-test-userData-${uniqueId}`);
  if (!fs.existsSync(tempUserData)) fs.mkdirSync(tempUserData, { recursive: true });

  // Correct order: projectRoot FIRST, then extraArgs, then switches
  const args = [projectRoot, ...extraArgs, `--user-data-dir=${tempUserData}`];
  
  const launchOptions = {
    args,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_RENDERER_URL: pathToFileURL(path.join(projectRoot, 'dist', 'renderer', 'index.html')).href
    },
  };

  return await electron.launch(launchOptions);
}

test('Verify Add Box Flicker', async () => {
  const fixturePath = path.resolve('assets/samples/report.pdf');
  const electronApp = await launchAppCorrected([fixturePath]);
  const page = await electronApp.firstWindow();
  
  console.log('App launched with PDF');

  // 3. Enter Edit mode
  const editBtn = page.locator('button:has-text("Edit")');
  await editBtn.waitFor({ state: 'visible', timeout: 30000 });
  await editBtn.click();
  console.log('Clicked Edit');
  
  // 4. Click "Add box" tool
  const addBoxBtn = page.locator('button:has-text("Add box")');
  await addBoxBtn.waitFor({ state: 'visible' });
  await addBoxBtn.click();
  console.log('Clicked Add box');
  
  // 5. Click on the page
  const pageContainer = page.locator('.page[data-page-number="1"]').first();
  await pageContainer.waitFor({ state: 'visible' });
  await pageContainer.click({ position: { x: 200, y: 200 } });
  console.log('Clicked on page to place box');
  
  // 6. Type text
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill('Flicker Test Ground Truth');
  console.log('Typed text');
  
  // 7. Click Confirm
  const confirmBtn = page.locator('button[aria-label="Confirm text box"], button:has-text("Confirm")').first();
  await confirmBtn.waitFor({ state: 'visible' });
  
  // Capture screenshot just BEFORE confirm
  await page.screenshot({ path: 'screenshots/pre-confirm.png' });
  
  console.log('Clicking Confirm...');
  await confirmBtn.click();
  
  // Immediate screenshot to catch the flicker
  await page.screenshot({ path: 'screenshots/add-box-flicker-ground-truth.png' });
  console.log('Captured ground truth screenshot');
  
  // Wait a bit and check if it stabilized
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/post-confirm.png' });

  await electronApp.close();
});
