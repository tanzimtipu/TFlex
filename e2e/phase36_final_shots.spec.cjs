// Phase 36 final gate — the visual evidence set.
//
// Captures the individual frames the gate needs; the composites
// (phase36-final-stages.png, phase36-final-themes.png) are stitched from these
// by the gate's image step. All launches go through the canonical launchApp
// helper (via launchDev).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');
const { switchTheme } = require('./lib/p33_common.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const LONG = path.join(ROOT, 'assets', 'samples', 'long.pdf');
const OUT = process.env.P36_SHOT_DIR || path.join(ROOT, 'screenshots');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-shots');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function openReport() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, REPORT);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
async function openLong() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, LONG);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1500);
}
const shot = async (name) => {
  fs.mkdirSync(OUT, { recursive: true });
  await win.screenshot({ path: path.join(OUT, name) });
  console.log(`[P36SHOT] ${name}`);
};

test('multi mode: two panes, centred strips, shared dock, rail and Inspector', async () => {
  await openReport();
  await openLong();
  expect(await win.locator('.tab[data-tab-id]').count(), 'two documents open').toBe(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(400);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(900);
  const emptyB = win.locator('.tab-pane[data-pane="B"][data-pane-empty]');
  if (await emptyB.count()) {
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
    await win.waitForTimeout(1500);
  }
  await win.waitForSelector('.tab-pane[data-pane="B"] .pdf-page', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await shot('phase36-final-multi.png');
});

test('the four stage panels', async () => {
  await openReport();
  for (const [n, name] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    await win.waitForTimeout(700);
    await shot(`phase36-final-stage-${n}-${name}.png`);
  }
});

test('the same view in light, dark and frosted', async () => {
  await openReport();
  await gotoStage(win, 1);
  await win.waitForTimeout(500);
  for (const theme of ['light', 'dark', 'frosted']) {
    await switchTheme(win, theme);
    await win.waitForTimeout(900);
    await shot(`phase36-final-theme-${theme}.png`);
  }
});
