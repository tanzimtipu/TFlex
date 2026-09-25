// Phase 36 (chunk 1) gate (qa) — the Stage Rail in the RUNNING app.
// Launches only through the canonical launchApp helper. Captures exactly ONE
// screenshot: screenshots/phase36-chunk1-rail.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const RAIL_SHOT = path.join(SHOTS, 'phase36-chunk1-rail.png');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-chunk1-rail');
  app = null;
  win = null;
});

test.setTimeout(240000);

test('P36-C1 rail: four stages, indicator, Ctrl+1..4, compact, gear, screenshot', async () => {
  // Phase 37 — the Stage Rail is document-scoped: it is NOT on the welcome
  // screen. Open a sample first, then assert the rail.
  expect(await win.locator('[data-stage-rail]').count(), 'no rail on the welcome screen').toBe(0);
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(800);

  const rail = win.locator('[data-stage-rail]');
  await expect(rail).toBeVisible();

  // 1. Four buttons, rail order, their data-stage and a11y labels.
  const stages = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
    els.map((e) => e.getAttribute('data-stage')));
  expect(stages).toEqual(['pages', 'edit', 'review', 'deliver']);
  const labels = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
    els.map((e) => e.getAttribute('aria-label')));
  expect(labels).toEqual(['Pages stage', 'Edit stage', 'Review stage', 'Deliver stage']);
  expect(await rail.getAttribute('aria-label')).toBe('Work stages');
  expect(await rail.getAttribute('data-active-stage')).toBe('pages');

  // 2. Clicking follows the active indicator.
  await win.click('[data-stage="review"]');
  expect(await rail.getAttribute('data-active-stage')).toBe('review');
  expect(await win.locator('[data-stage="review"]').getAttribute('aria-pressed')).toBe('true');
  expect(await win.locator('[data-stage="pages"]').getAttribute('aria-pressed')).toBe('false');

  // 3. Ctrl+1..4 drive the REAL keyboard.
  await win.keyboard.press('Control+1');
  expect(await rail.getAttribute('data-active-stage')).toBe('pages');
  await win.keyboard.press('Control+3');
  expect(await rail.getAttribute('data-active-stage')).toBe('review');
  await win.keyboard.press('Control+4');
  expect(await rail.getAttribute('data-active-stage')).toBe('deliver');

  // 4. The chord must NOT fire while a text field is focused.
  const pageInput = win.locator('input.page-input');
  await pageInput.waitFor({ state: 'visible', timeout: 10000 });
  await pageInput.click();
  await win.keyboard.press('Control+3');
  expect(await rail.getAttribute('data-active-stage'), 'focused input must keep Ctrl+3').toBe('deliver');
  await pageInput.blur();
  await win.keyboard.press('Control+2');
  expect(await rail.getAttribute('data-active-stage')).toBe('edit');

  // 5. The rail gear opens the same Preferences sheet.
  await win.click('[data-stage-rail-gear]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });

  // 6. Compact collapse below 1100px; labelled again at/above.
  const setSize = (w, h) =>
    app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
    }, [w, h]);
  await setSize(1000, 800);
  await win.waitForFunction(
    () => document.querySelector('[data-stage-rail]')?.getAttribute('data-stage-rail-compact') === 'true',
    null, { timeout: 10000 });
  await setSize(1440, 900);
  await win.waitForFunction(
    () => document.querySelector('[data-stage-rail]')?.getAttribute('data-stage-rail-compact') === 'false',
    null, { timeout: 10000 });

  // 7. ONE screenshot at 1440x900 with a document open and the Review stage
  //    active (shows the indicator and the left-rail overlap).
  await win.click('[data-stage="review"]');
  await win.waitForTimeout(500);
  await win.screenshot({ path: RAIL_SHOT });
  console.log(`[p36-c1] screenshot: ${RAIL_SHOT}`);
});
