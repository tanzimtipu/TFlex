// Phase 71 — Preferences category panels wrapped in a TfResize height frame.
//
// The assigned behaviour (TFL-192 item A):
//   - the PREFS_CATEGORIES.map panels inside .prefs-content are wrapped by a
//     single <TfResize axes="height"> frame;
//   - the frame holds all four [data-prefs-panel] elements;
//   - the frame's real height tracks the active category, so switching between
//     two categories whose content differs produces a DIFFERENT frame height
//     (the size change is real, not a no-op wrapper).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p71-prefs-resize');
  app = null;
  win = null;
});

async function frameHeightFor(category) {
  await win.locator(`[data-prefs-category="${category}"]`).click();
  // The size tween runs on the standard token (250ms); allow it to settle.
  await win.waitForTimeout(800);
  return win.evaluate(() => {
    const f = document.querySelector('[data-prefs-dialog] [data-tf-resize="height"]');
    return f === null ? -1 : f.offsetHeight;
  });
}

test('Phase 71: prefs panels live in a TfResize height frame whose height differs per category', async () => {
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);

  const frame = win.locator('[data-prefs-dialog] [data-tf-resize="height"]');
  await expect(frame, 'the prefs sheet has exactly one height-resize frame').toHaveCount(1);
  await expect(frame.locator('[data-prefs-panel]'), 'all four panels live inside the frame').toHaveCount(4);

  const generalH = await frameHeightFor('general');
  await win.screenshot({ path: path.join(SHOTS, 'p71-prefs-general.png') });
  const importH = await frameHeightFor('import');
  await win.screenshot({ path: path.join(SHOTS, 'p71-prefs-import.png') });

  console.log(`[P71-prefs] general frame height=${generalH} import frame height=${importH}`);

  expect(generalH, 'general frame has a real height').toBeGreaterThan(0);
  expect(importH, 'import frame has a real height').toBeGreaterThan(0);
  expect(generalH, 'the frame height changes between General and Import').not.toBe(importH);
});
