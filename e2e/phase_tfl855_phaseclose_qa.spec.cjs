// TFL-1027 (TFL-855 phase-close QA) — representative live-app screenshots of
// the migrated interaction surfaces, light AND dark. Launches ONLY through the
// canonical launchApp helper. The surfaces captured are the ones the phase
// migrated onto the shared primitives:
//   * Welcome home-tools picker        -> CommandMenu  ([data-home-picker])
//   * File menu                        -> CommandMenu  ([data-menu-popover])
//   * Application menu                 -> CommandMenu  ([data-app-menu-popover])
//   * Dock More overflow               -> CommandMenu  ([data-dock-overflow-menu])
//   * Dock Add-a-tool picker           -> CommandMenu  ([data-dock-picker])
//   * Split / Extract dialog           -> TaskDialog   (#split-dialog-title)
//   * Stamp dialog                     -> PreviewTaskDialog ([data-stamp-dialog])
//   * Create-from-images dialog        -> PreviewTaskDialog (#create-images-dialog-title)
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, runTool } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase-tfl855-close');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(300000);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl855-close');
  app = null;
  win = null;
});

async function setTheme(theme) {
  // The borderless theme picker is retired; the application menu (present on
  // both the Welcome screen and the workspace) owns View > Toggle Theme, whose
  // CommandMenu row exposes data-menu-action="toggleTheme" and cycles
  // frosted -> dark -> light -> frosted.
  for (let i = 0; i < 4; i += 1) {
    const current = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (current === theme) break;
    await win.keyboard.press('Escape').catch(() => {});
    await win.waitForTimeout(150);
    await win.click('[data-app-menu]');
    await win.waitForSelector('[data-menu-action="toggleTheme"]', { state: 'visible', timeout: 8000 });
    await win.click('[data-menu-action="toggleTheme"]');
    await win.waitForTimeout(500);
  }
  await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function capture(selectors, name) {
  const sel = Array.isArray(selectors) ? selectors : [selectors];
  for (const s of sel) {
    await win.waitForSelector(s, { state: 'visible', timeout: 10000 });
  }
  // Let the TfMenu/TfDialog entrance animation settle before capture so the
  // evidence shows the resting surface, not a mid-fade frame.
  await win.waitForTimeout(700);
  const p = path.join(OUT, name);
  await win.screenshot({ path: p });
  console.log(`[TFL855] captured ${p}`);
  return p;
}

async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForTimeout(900);
}

for (const theme of ['light', 'dark']) {
  test(`TFL-855 phase-close migrated surfaces — ${theme}`, async () => {
    await setTheme(theme);

    // Welcome home-tools picker (CommandMenu).
    await win.click('[data-home-edit-toggle]');
    await win.click('[data-home-plus]');
    await capture('[data-home-picker]', `tfl855-welcome-picker-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    // Leave home edit mode so the sample opens cleanly.
    await win.locator('[data-home-edit-toggle]').first().click().catch(() => {});
    await win.waitForTimeout(200);

    await openReport();

    // File menu (CommandMenu).
    await win.click('[data-menu-button]');
    await capture('[data-menu-popover]', `tfl855-file-menu-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);

    // Application menu (CommandMenu).
    await win.click('[data-app-menu]');
    await capture('[data-app-menu-popover]', `tfl855-app-menu-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);

    // Dock More overflow (CommandMenu).
    await win.click('[data-dock-overflow]');
    await capture('[data-dock-overflow-menu]', `tfl855-dock-more-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);

    // Dock Add-a-tool picker (CommandMenu) — requires dock edit mode.
    await win.click('[data-dock-overflow]');
    await win.waitForSelector('[data-dock-menu-item="customize"]', { state: 'visible', timeout: 8000 });
    await win.click('[data-dock-menu-item="customize"]');
    await win.waitForFunction(() => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-edit') === 'true', null, { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.click('[data-dock-plus]');
    await capture('[data-dock-picker]', `tfl855-dock-add-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    // Leave dock edit mode.
    await win.click('[data-dock-overflow]').catch(() => {});
    await win.waitForTimeout(250);
    await win.locator('[data-dock-menu-item="customize"]').first().click().catch(() => {});
    await win.waitForTimeout(300);

    // Split / Extract (TaskDialog).
    await runTool(win, 'split');
    await capture('#split-dialog-title', `tfl855-split-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // Stamp (PreviewTaskDialog).
    await runTool(win, 'stamp');
    await capture('[data-stamp-dialog]', `tfl855-stamp-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // Create-from-images (PreviewTaskDialog).
    await runTool(win, 'createFromImages');
    await capture('#create-images-dialog-title', `tfl855-create-images-${theme}.png`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    expect(true).toBe(true);
  });
}
