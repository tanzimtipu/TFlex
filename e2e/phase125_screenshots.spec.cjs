// Phase 125 (TFL-1419) chunk C - AFTER screenshots of the major surfaces in every
// theme, matching chunk-B's `before-<surface>-<theme>.png` set (window maximized;
// chunk B captured at 2560x1392). Captures:
//   after-home-<theme>.png      Home hero
//   after-dialog-<theme>.png    About dialog (a modal dialog surface)
//   after-settings-<theme>.png  Preferences (settings) dialog
//   after-workspace-<theme>.png workspace chrome: title bar + document tabs
//   after-panel-<theme>.png     workspace with the PAGES panel / inspector expanded

const path = require('node:path');
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { setTheme, openSamplePath, openPreferences, ensurePanelExpanded, hardClose } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase125');
const THEMES = ['light', 'dark', 'frosted'];

test('Phase 125: capture AFTER screenshots of every major surface in every theme', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w && !w.isMaximized()) w.maximize();
    });
    await win.waitForTimeout(700);

    for (const theme of THEMES) {
      await setTheme(win, theme);
      await win.screenshot({ path: path.join(OUT, `after-home-${theme}.png`) });

      // Dialog surface: About (File menu > Help > About Jovrel).
      await win.locator('[data-menu-button]').first().click();
      await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
      await win.locator('[data-menu-popover] [data-menu-action="about"]').first().click();
      await win.waitForSelector('[data-menu-popover]', { state: 'detached', timeout: 8000 }).catch(() => {});
      await win.waitForSelector('[data-about-dialog]', { state: 'visible', timeout: 8000 });
      await win.waitForTimeout(700);
      await win.screenshot({ path: path.join(OUT, `after-dialog-${theme}.png`) });
      await win.keyboard.press('Escape');
      await win.waitForSelector('[data-about-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});

      // Settings surface: Preferences.
      await openPreferences(win);
      await win.waitForTimeout(400);
      await win.screenshot({ path: path.join(OUT, `after-settings-${theme}.png`) });
      await win.keyboard.press('Escape');
      await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
    }

    // Workspace chrome + panel/inspector, once a document is open.
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await ensurePanelExpanded(win);
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await win.screenshot({ path: path.join(OUT, `after-workspace-${theme}.png`) });
      await win.screenshot({ path: path.join(OUT, `after-panel-${theme}.png`) });
    }
  } finally {
    await hardClose(app, 'phase125-screenshots');
  }
});
