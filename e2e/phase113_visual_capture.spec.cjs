// Phase 113 (TFL-839 / chunk G, TFL-1052) - AFTER screenshot capture for the
// Quiet Actions visual verdict. Owner qa. Launched via the canonical launcher.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  clickDockVerb,
  openSample,
} = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase113');
const USER_DATA = path.join(os.tmpdir(), `tflex-p113-shot-${Date.now()}`);

test.setTimeout(600000);

let app;
let win;

async function shot(name) {
  const p = path.join(OUT, `after-${name}.png`);
  await win.screenshot({ path: p });
  console.log(`[P113SHOT] ${p}`);
}

async function setTheme(theme) {
  const trigger = win.locator('[data-theme-toggle]');
  if ((await trigger.count()) > 0) {
    try {
      await win.keyboard.press('Escape').catch(() => {});
      await trigger.first().click({ timeout: 2500 });
      await win.locator(`[data-theme-option="${theme}"]`).first().click({ timeout: 2500 });
    } catch (_) {
      await win.keyboard.press('Escape').catch(() => {});
      await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    }
  } else {
    await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  }
  await win.waitForTimeout(500);
}

test('Phase 113 AFTER visual capture', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(600);

  await setTheme('light');
  await shot('home-light');
  await setTheme('dark');
  await shot('home-dark');
  await setTheme('light');

  await openSample(win, app, 'report.pdf');
  await win.waitForTimeout(900);

  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  await setTheme('light');
  await shot('titlebar-light');
  await setTheme('dark');
  await shot('titlebar-dark');
  await setTheme('light');
  await shot('dock-light');
  await setTheme('dark');
  await shot('dock-dark');
  await setTheme('light');
  await shot('inspector-light');
  await setTheme('dark');
  await shot('inspector-dark');
  await setTheme('light');

  // High-contrast sample (Windows forced-colors emulation).
  await win.emulateMedia({ forcedColors: 'active' });
  await win.waitForTimeout(500);
  await shot('high-contrast');
  await win.emulateMedia({ forcedColors: 'none' });
  await win.waitForTimeout(400);

  // 200% DPI sample (equivalent device scale via renderer zoom).
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2);
  });
  await win.waitForTimeout(800);
  await shot('dpi200');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
  });
  await win.waitForTimeout(500);

  // Representative dialog (Stamp) - the proven in-app dialog path.
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[aria-labelledby="stamp-dialog-title"]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(400);
  await setTheme('light');
  await shot('dialog-light');
  await setTheme('dark');
  await shot('dialog-dark');
  await setTheme('light');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // Context menu on a page thumbnail.
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: 'visible', timeout: 10000 });
  await thumb.click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 10000 });
  await shot('menu-light');
  await setTheme('dark');
  await shot('menu-dark');

  await hardClose(app, 'p113-shots');
  expect(true).toBe(true);
});
