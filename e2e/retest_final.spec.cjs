const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test.describe('Phase 6 Final Verification Walkthrough', () => {
  let electronApp;
  let window;
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  const userDataDir = path.join(os.tmpdir(), `tflex-p6-walkthrough-${Date.now()}`);

  test.beforeAll(async () => {
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('Full Phase 6 Success Criteria Loop', async () => {
    // --- Launch & DEF-035 ---
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1280, height: 800 });
    
    const title = await window.title();
    expect(title).toBe('TFlex');
    console.log('App launched. DEF-035 fixed.');

    // --- Tab UX & DEF-034 ---
    const reportPath = getSamplePath('report.pdf');
    const formPath = getSamplePath('form.pdf');
    
    // Open report.pdf
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    // Create empty tab
    await window.click('button[aria-label="New empty tab"]');
    await window.waitForSelector('.welcome');
    
    let activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('Empty tab');

    // Open form.pdf fills the empty tab
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForFunction(() => {
        const t = document.querySelector('.tab-active')?.textContent;
        return t && t.includes('form.pdf');
    }, { timeout: 15000 });
    await window.waitForSelector('.workspace:visible');
    
    activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('form.pdf');

    // DEF-034: Tab switching on padding/gap clicks
    const tabs = window.locator('.tab');
    await expect(tabs).toHaveCount(2);

    const firstTab = tabs.nth(0);
    const box = await firstTab.boundingBox();
    await window.mouse.click(box.x + 5, box.y + 5); // Padding
    await window.waitForSelector('.workspace:visible');
    activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('report.pdf');

    const secondTab = tabs.nth(1);
    const box2 = await secondTab.boundingBox();
    await window.mouse.click(box2.x + box2.width - 40, box2.y + box2.height / 2); // Gap
    await window.waitForSelector('.workspace:visible');
    activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('form.pdf');

    // Theme churn clicks
    await window.keyboard.press('Control+T');
    await window.mouse.click(box.x + 5, box.y + 5);
    await window.waitForSelector('.workspace:visible');
    activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('report.pdf');
    console.log('DEF-034 verified.');

    // SC 1: Close falls back to previous
    await window.locator('.tab:has-text("report.pdf")').locator('.tab-close').click();
    await window.waitForSelector('.workspace:visible');
    activeTitle = await window.evaluate(() => document.querySelector('.tab-active .tab-title')?.textContent?.trim());
    expect(activeTitle).toContain('form.pdf');
    console.log('SC 1 (Empty tabs & fallback) verified.');

    // --- Tools Palette ---
    await window.click('button[aria-label="Tools palette"]:visible');
    await window.waitForSelector('.tools-palette');
    
    // Toggle to Grid
    await window.click('button[aria-label="Grid layout"]');
    await expect(window.locator('.tools-palette')).toHaveClass(/tools-palette-grid/);
    await window.screenshot({ path: path.join(screenshotsDir, 'sc-tools-palette.png') });
    console.log('SC 2 (Tools palette) verified.');

    // --- Menu & About & Preferences ---
    // About
    await window.evaluate(() => {
        window.dispatchEvent(new CustomEvent('menu:action', { detail: { action: 'about' } }));
    });
    await window.waitForSelector('.sheet-about');
    const versionBadge = await window.locator('[data-about-version]').textContent();
    const appInfo = await window.evaluate(() => window.tflex.app.getInfo());
    expect(versionBadge).toBe(appInfo.version);
    await window.screenshot({ path: path.join(screenshotsDir, 'sc-about.png') });
    await window.click('.sheet-about .sheet-close');

    // Preferences
    await window.evaluate(() => {
        window.dispatchEvent(new CustomEvent('menu:action', { detail: { action: 'preferences' } }));
    });
    await window.waitForSelector('.preferences-dialog');
    await window.fill('.preferences-dialog input[name="recentsLimit"]', '12');
    await window.click('.preferences-dialog button:has-text("Save")');
    console.log('SC 3 & 5 (Menu/About/Prefs) verified.');

    // --- Color Picker ---
    await window.click('button[aria-label="Highlight"]:visible');
    const swatch = window.locator('.ann-color-swatch-main:visible');
    await swatch.click();
    await window.waitForSelector('.color-palette');
    await window.fill('input[aria-label="Custom color hex"]', '#0000ff'); // Blue
    await window.keyboard.press('Enter');
    const color = await swatch.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(color).toBe('rgb(0, 0, 255)');
    console.log('SC 4 (Color picker) verified.');

    // --- OTA Surface ---
    const updateStatus = await window.evaluate(() => window.tflex.update.getStatus());
    expect(updateStatus.kind).toBeDefined();
    console.log('SC 5 (OTA Surface) verified.');

    // --- Performance: Tab Switch ---
    // Open another doc to test switch
    await window.click('button[aria-label="New empty tab"]');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');

    const start = Date.now();
    await window.locator('.tab').first().click();
    await window.waitForSelector('.workspace:visible');
    const end = Date.now();
    console.log(`Tab switch duration: ${end - start}ms`);
    expect(end - start).toBeLessThan(300);

    // --- Persistence & Portable ---
    await electronApp.close();
    
    // Restart to verify persistence
    electronApp = await launchApp([], userDataDir);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome');

    await window.evaluate(() => {
        window.dispatchEvent(new CustomEvent('menu:action', { detail: { action: 'preferences' } }));
    });
    await window.waitForSelector('.preferences-dialog');
    const limit = await window.locator('.preferences-dialog input[name="recentsLimit"]').inputValue();
    expect(limit).toBe('12');
    await window.click('.preferences-dialog button:has-text("Close")');

    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace:visible');
    await window.click('button[aria-label="Tools palette"]:visible');
    await expect(window.locator('.tools-palette')).toHaveClass(/tools-palette-grid/);

    await window.click('button[aria-label="Highlight"]:visible');
    const colorRestart = await window.locator('.ann-color-swatch-main:visible').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(colorRestart).toBe('rgb(0, 0, 255)');
    
    await electronApp.close();

    // Portable Check
    const { _electron: electron } = require('@playwright/test');
    const projectRoot = path.resolve(__dirname, '..');
    const portableApp = await electron.launch({
      args: [projectRoot, `--user-data-dir=${userDataDir}-portable`],
      env: {
        ...process.env,
        PORTABLE_EXECUTABLE_DIR: 'C:\\FakePath',
        ELECTRON_RENDERER_URL: require('node:url').pathToFileURL(path.join(projectRoot, 'dist', 'renderer', 'index.html')).href,
      }
    });
    const portableWin = await portableApp.firstWindow();
    await portableWin.waitForSelector('.welcome');
    const portableStatus = await portableWin.evaluate(() => window.tflex.update.getStatus());
    expect(portableStatus.kind).toBe('unsupported');
    await portableApp.close();
    console.log('Persistence & Portable verified.');
  });
});
