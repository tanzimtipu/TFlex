// Phase 103 batch QA (TFL-837) — visual evidence capture for the icon/colour
// discipline criteria. Captures, per theme (light / dark): the welcome screen,
// the title bar, the four workspace stages (Pages / Edit / Review / Deliver) as
// full-window shots (dock + stage rail + title bar), and the dock "add a tool"
// menu (a menu whose glyphs are absent from the supplied Phase 103 references).
//
// Launches ONCE per theme through the canonical launchApp helper. Output dir:
// screenshots/phase103-qa/.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase103-qa');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(180000);

const STAGES = ['pages', 'edit', 'review', 'deliver'];

async function setTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(500);
}

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-stage-rail]', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForTimeout(900);
}

for (const theme of ['light', 'dark']) {
  test(`Phase 103 QA visual evidence — ${theme}`, async () => {
    const app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    await setTheme(win, theme);
    await win.screenshot({ path: path.join(OUT, `welcome-${theme}.png`) });

    await openReport(win);
    await win.locator('[data-titlebar]').screenshot({ path: path.join(OUT, `titlebar-${theme}.png`) });

    for (const stage of STAGES) {
      await win.click(`[data-stage="${stage}"]`);
      await win.waitForFunction(
        (s) => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') === s,
        stage,
        { timeout: 5000 },
      );
      await win.waitForTimeout(700);
      await win.screenshot({ path: path.join(OUT, `stage-${stage}-${theme}.png`) });
    }

    // The dock "add a tool" picker — revealed by the dock's own Customize dock
    // item in the More popover (Phase 104 retired the `[data-dock-edit-toggle]`
    // pen); its glyphs are absent from the supplied refs.
    await win.click('[data-dock-overflow]');
    await win.waitForSelector('[data-dock-menu-item="customize"]', { state: 'visible', timeout: 5000 });
    await win.click('[data-dock-menu-item="customize"]');
    await win.waitForFunction(
      () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-edit') === 'true',
      null,
      { timeout: 5000 },
    );
    await win.waitForTimeout(500);
    await win.click('[data-dock-plus]');
    await win.waitForSelector('[data-dock-picker]', { timeout: 5000 });
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(OUT, `menu-dock-plus-${theme}.png`) });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    await hardClose(app, `p103-qa-${theme}`);
  });
}
