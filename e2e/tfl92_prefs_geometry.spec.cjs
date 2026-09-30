// TFL-92 independent geometry check for the TFL-51/TFL-87 Preferences row layout.
//
// QA-owned evidence, not a product test: measure, in the running app, the right
// edge of every row's TEXT cell and HINT against the left edge of the row's
// control. The operator complaint is that a description line floated between the
// control boxes; the contract is hintRight <= controlLeft for every row with a
// control in every category, at the sheet's normal width and at 640px.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const CATEGORIES = ['general', 'documents', 'import', 'storage'];
const CONTROL = '.prefs-select, .prefs-input, .prefs-check, .prefs-action';

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl92-prefs-geom');
  app = null;
  win = null;
});

async function measure() {
  return win.evaluate((controlSel) => {
    const panel = document.querySelector('[data-prefs-panel][data-active="true"]');
    if (panel === null) return null;
    return Array.from(panel.querySelectorAll('.prefs-row'))
      .map((row) => {
        const control = row.querySelector(controlSel);
        if (control === null) return null;
        const cell = row.querySelector('.prefs-row-text');
        const hint = row.querySelector('.prefs-hint');
        const cr = control.getBoundingClientRect();
        const cellR = cell ? cell.getBoundingClientRect() : null;
        const hintR = hint ? hint.getBoundingClientRect() : null;
        return {
          label: (row.querySelector('.prefs-row-label') || row.querySelector('.prefs-hint') || { textContent: '(none)' }).textContent.trim().slice(0, 34),
          hintRight: hintR ? +hintR.right.toFixed(2) : null,
          cellRight: cellR ? +cellR.right.toFixed(2) : null,
          controlLeft: +cr.left.toFixed(2),
          hintGap: hintR ? +(cr.left - hintR.right).toFixed(2) : null,
          cellGap: cellR ? +(cr.left - cellR.right).toFixed(2) : null,
        };
      })
      .filter((r) => r !== null);
  }, CONTROL);
}

async function setWindowWidth(width) {
  await app.evaluate(async ({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) { win.unmaximize(); await new Promise((r) => setTimeout(r, 400)); }
    win.setBounds({ x: 0, y: 0, width: w, height: 800 });
    await new Promise((r) => setTimeout(r, 400));
    win.setSize(w, 800);
    await new Promise((r) => setTimeout(r, 400));
  }, width);
  await win.waitForTimeout(900);
  return win.evaluate(() => window.innerWidth);
}

async function sweep(tag) {
  const all = [];
  for (const cat of CATEGORIES) {
    await win.locator(`[data-prefs-category="${cat}"]`).click();
    await win.waitForTimeout(300);
    const rows = (await measure()) ?? [];
    console.log(`[TFL92-geom] ${tag} ${cat} rows=${JSON.stringify(rows)}`);
    for (const r of rows) all.push({ cat, ...r });
  }
  return all;
}

test('TFL-92: hint/cell right edge never crosses the control column left edge', async () => {
  const normal = await sweep('normal');
  const badNormal = normal.filter((r) => (r.hintRight ?? -Infinity) > r.controlLeft || (r.cellRight ?? -Infinity) > r.controlLeft);
  console.log(`[TFL92-geom] normal rows=${normal.length} minHintGap=${Math.min(...normal.map((r) => r.hintGap).filter((g) => typeof g === 'number'))}`);
  expect(badNormal, `overlap at normal width: ${JSON.stringify(badNormal)}`).toEqual([]);
  expect(normal.length, 'rows measured at normal width').toBeGreaterThanOrEqual(10);

  const inner = await setWindowWidth(640);
  expect(inner, 'window actually shrank').toBeLessThanOrEqual(700);
  const narrow = await sweep('640px');
  const badNarrow = narrow.filter((r) => (r.hintRight ?? -Infinity) > r.controlLeft || (r.cellRight ?? -Infinity) > r.controlLeft);
  console.log(`[TFL92-geom] 640px rows=${narrow.length} minHintGap=${Math.min(...narrow.map((r) => r.hintGap).filter((g) => typeof g === 'number'))}`);
  expect(badNarrow, `overlap at 640px: ${JSON.stringify(badNarrow)}`).toEqual([]);
});
