// Phase 127 (TFL-1483 chunk B) — focused verification of the v1.50.0 top-bar
// chrome restore (TFL-1482 chunk A) in the REAL Electron app.
//
// Asserts, on a loaded document:
//   1. the File trigger [data-menu-button] opens ONE popover with the
//      FILE/EDIT/VIEW/TOOLS/HELP groups and the named rows (no command lost);
//   2. no [data-app-menu] / [data-app-menu-popover] / .app-menu remains;
//   3. the header utility controls render and Multi Mode flips its state;
//   4. the .theme-toggle pill shows the current label and a selection persists
//      across a reload (settings echo).
// Captures after-restore screenshots of the top bar at the default and the
// minimum supported (960x640) window size.

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const MENU_ACTIONS = ['open', 'undo', 'toggleTheme', 'showToolsPalette', 'recognizeText', 'checkForUpdate'];
const UTILITY = ['data-header-tool-search', 'data-header-find', 'data-header-multi-mode', 'data-print', 'data-open-preferences'];

test('Phase 127 — v1.50.0 top-bar chrome restored', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.workspace:visible').first()).toBeVisible({ timeout: 30000 });

    // (2) The Phase-105 application menu is gone.
    expect(await win.locator('[data-app-menu]').count()).toBe(0);
    expect(await win.locator('[data-app-menu-popover]').count()).toBe(0);
    expect(await win.locator('.app-menu').count()).toBe(0);

    // (1) The File trigger opens ONE full menu.
    await win.locator('[data-menu-button]').click();
    const popover = win.locator('[data-menu-popover]');
    await expect(popover).toHaveCount(1);
    await expect(popover).toBeVisible();
    const headings = await popover.locator('.titlebar-menu-heading').allInnerTexts();
    expect(headings.map((h) => h.trim())).toEqual(['FILE', 'EDIT', 'VIEW', 'TOOLS', 'HELP']);
    for (const action of MENU_ACTIONS) {
      await expect(popover.locator(`[data-menu-action="${action}"]`)).toHaveCount(1);
    }
    await win.screenshot({ path: path.join(SHOTS, 'tfl1483_after_menu_open.png') });
    await win.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // (3) The restored utility cluster renders.
    for (const hook of UTILITY) {
      await expect(win.locator(`[${hook}]`)).toBeVisible();
    }
    const multi = win.locator('[data-header-multi-mode]');
    expect(await multi.getAttribute('data-multi-mode-active')).toBe('false');
    await multi.click();
    await expect(multi).toHaveAttribute('data-multi-mode-active', 'true', { timeout: 8000 });
    await multi.click();
    await expect(multi).toHaveAttribute('data-multi-mode-active', 'false', { timeout: 8000 });

    // CONTROL-INDEX action checks in the real app: tool-search opens the
    // Command Palette; the gear opens Preferences.
    await win.locator('[data-header-tool-search]').click();
    await expect(win.locator('[data-command-palette-input]')).toBeVisible({ timeout: 8000 });
    await win.keyboard.press('Escape');
    await win.locator('[data-open-preferences]').click();
    await expect(win.locator('[data-prefs-dialog]')).toBeVisible({ timeout: 8000 });
    await win.keyboard.press('Escape');
    await expect(win.locator('[data-prefs-dialog]')).toBeHidden({ timeout: 8000 });


    // (4) The theme pill shows the current label and commits a selection.
    const pill = win.locator('[data-theme-toggle]');
    await expect(pill).toBeVisible();
    const labelBefore = (await pill.innerText()).trim();
    expect(labelBefore.length).toBeGreaterThan(0);
    const target = labelBefore.includes('Frosted') ? 'dark' : 'frosted';
    await pill.click();
    const option = win.locator(`[data-theme-option="${target}"]`);
    await expect(option).toBeVisible();
    await option.click();
    await expect.poll(() => win.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe(target === 'system' ? 'frosted' : target);

    // After-restore top-bar screenshots (default, then minimum supported size).
    await win.locator('.titlebar').screenshot({ path: path.join(SHOTS, 'tfl1483_after_default.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await win.waitForTimeout(600);
    await win.locator('.titlebar').screenshot({ path: path.join(SHOTS, 'tfl1483_after_min.png') });

    // Settings echo: the selection survives a reload.
    await win.reload();
    await win.waitForSelector('[data-theme-toggle]', { timeout: 30000 });
    await expect.poll(() => win.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(target);
    await expect.poll(async () => (await win.locator('[data-theme-toggle]').innerText()).trim())
      .toContain(target === 'dark' ? 'Dark' : target === 'light' ? 'Light' : 'Frosted');
  } finally {
    await hardClose(app, 'tfl1430-topbar-restore');
  }
});
