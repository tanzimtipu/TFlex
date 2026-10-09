// TFL-1393 (Part E) - retirement evidence screenshots.
//
// Proves the guided-form entry points are gone from the visible UI:
//   (1) the REVIEW dock renders no Forms verb;
//   (2) the Command Palette filtered on "form" lists no guided "Forms" row.
// Launches only through the canonical e2e/lib/launch.cjs helper.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('TFL-1393 retirement evidence: no Forms verb in REVIEW dock or palette', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(900);

    await gotoStage(win, 3); // REVIEW
    await win.waitForTimeout(500);
    // The dock may spill non-primary verbs into More; check both lanes.
    const dockForms = await win.locator('[data-dock-verb="forms"]').count();
    let moreForms = 0;
    if ((await win.locator('[data-dock-overflow]').count()) > 0) {
      await win.locator('[data-dock-overflow]').first().click();
      await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 }).catch(() => {});
      moreForms = await win.locator('[data-dock-overflow-item="forms"]').count();
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    }
    console.log(`[TFL-1393-E] REVIEW dock forms inline=${dockForms} more=${moreForms}`);
    expect(dockForms, 'no Forms verb inline in the REVIEW dock').toBe(0);
    expect(moreForms, 'no Forms row in the REVIEW More menu').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl1393-review-dock-no-forms.png') });

    // Command Palette filtered on "form".
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
    await win.locator('[data-command-palette-input]').fill('form');
    await win.waitForTimeout(400);
    const paletteForms = await win.locator('[data-palette-tool-id="forms"]').count();
    const paletteRows = await win.$$eval('[data-palette-tool-id]', (els) => els.map((e) => e.getAttribute('data-palette-tool-id')));
    console.log(`[TFL-1393-E] palette "form" rows=${JSON.stringify(paletteRows)} formsRow=${paletteForms}`);
    expect(paletteForms, 'no guided Forms row in the Command Palette').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl1393-palette-no-forms.png') });
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1393-evidence');
  }
});
