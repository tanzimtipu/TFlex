// Phase 33 e2e (spec 1 of 4) — criterion 2: print page order must be real.
//
// At 2 pages per sheet the PREVIEW must be 2x1 for Horizontal (cells side by
// side) and 1x2 for Vertical (cells stacked), measured from the CELL GEOMETRY
// (getBoundingClientRect per cell + the sheet's computed grid template), not
// from class names. Repeated at 4-up (2x2, fill flow differs) and 6-up
// (3x2 vs 2x3). The reversed variants reverse the flow within the same grid.
// Then the composed PRINT DOCUMENTS for 2-up Horizontal and Vertical are
// produced through the Phase 30 printToPDF seam and asserted to differ in the
// expected way (page count + the arrangement measured from the PDF).
//
// Launches only through the canonical launchApp helper; never prints to a
// physical device (the override intercepts before any driver).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');
const { REPORT, SHOTS } = require('./lib/p33_common.cjs');
const P = require('./lib/p33_print.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p33-order');
  app = null;
  win = null;
});
test.setTimeout(300000);

test('C2 print page order: preview geometry + produced PDFs (2/4/6-up, all orders)', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
  const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[P33-order] fixture=report.pdf pageCount=${pageCount}`);
  expect(pageCount).toBe(34);

  await P.openDialog(win);

  // ---- preview geometry for every (nup, order) --------------------------
  const orders = ['horizontal', 'horizontalReversed', 'vertical', 'verticalReversed'];
  const geom = {};
  for (const nup of [2, 4, 6]) {
    for (const order of orders) {
      geom[`${nup}-${order}`] = await P.measurePreview(win, nup, order);
    }
  }
  for (const key of Object.keys(geom)) {
    const g = geom[key];
    console.log(
      `[P33-order] preview ${key}: cols="${g.gridTemplateColumns}" rows="${g.gridTemplateRows}" ` +
        `pages=${JSON.stringify(g.pages)} cells=${JSON.stringify(g.cells)}`,
    );
  }

  const cols = (k) => P.trackCount(geom[k].gridTemplateColumns);
  const rows = (k) => P.trackCount(geom[k].gridTemplateRows);
  const pages = (k) => geom[k].pages;

  // ---- 2-up: Horizontal 2x1 (side by side) vs Vertical 1x2 (stacked) ----
  expect(cols('2-horizontal'), '2-up Horizontal is 2 columns').toBe(2);
  expect(rows('2-horizontal'), '2-up Horizontal is 1 row').toBe(1);
  expect(cols('2-vertical'), '2-up Vertical is 1 column').toBe(1);
  expect(rows('2-vertical'), '2-up Vertical is 2 rows').toBe(2);
  const h2 = geom['2-horizontal'].cells;
  const v2 = geom['2-vertical'].cells;
  expect(h2[0].y, '2-up H cells share a row').toBe(h2[1].y);
  expect(h2[0].x, '2-up H cells differ in x (side by side)').not.toBe(h2[1].x);
  expect(v2[0].x, '2-up V cells share a column').toBe(v2[1].x);
  expect(v2[0].y, '2-up V cells differ in y (stacked)').not.toBe(v2[1].y);
  expect(pages('2-horizontal'), '2-up H places pages [1,2]').toEqual([1, 2]);
  expect(pages('2-vertical'), '2-up V places pages [1,2]').toEqual([1, 2]);
  // Reversed variants reverse the flow within the SAME grid.
  expect(cols('2-horizontalReversed'), '2-up HR keeps 2 columns').toBe(2);
  expect(rows('2-horizontalReversed'), '2-up HR keeps 1 row').toBe(1);
  expect(pages('2-horizontalReversed'), '2-up HR reverses to [2,1]').toEqual([2, 1]);
  expect(cols('2-verticalReversed'), '2-up VR keeps 1 column').toBe(1);
  expect(rows('2-verticalReversed'), '2-up VR keeps 2 rows').toBe(2);
  expect(pages('2-verticalReversed'), '2-up VR reverses to [2,1]').toEqual([2, 1]);

  // ---- 4-up: 2x2 in both, fill flow differs -----------------------------
  expect(cols('4-horizontal'), '4-up H is 2 columns').toBe(2);
  expect(rows('4-horizontal'), '4-up H is 2 rows').toBe(2);
  expect(cols('4-vertical'), '4-up V is 2 columns').toBe(2);
  expect(rows('4-vertical'), '4-up V is 2 rows').toBe(2);
  expect(pages('4-horizontal'), '4-up H fills row-major [1,2,3,4]').toEqual([1, 2, 3, 4]);
  expect(pages('4-vertical'), '4-up V fills column-major [1,3,2,4]').toEqual([1, 3, 2, 4]);
  expect(pages('4-horizontalReversed'), '4-up HR reverses each row [2,1,4,3]').toEqual([2, 1, 4, 3]);
  expect(pages('4-verticalReversed'), '4-up VR reverses each column [2,4,1,3]').toEqual([2, 4, 1, 3]);

  // ---- 6-up: Horizontal 3x2 vs Vertical 2x3 -----------------------------
  expect(cols('6-horizontal'), '6-up H is 3 columns').toBe(3);
  expect(rows('6-horizontal'), '6-up H is 2 rows').toBe(2);
  expect(cols('6-vertical'), '6-up V is 2 columns').toBe(2);
  expect(rows('6-vertical'), '6-up V is 3 rows').toBe(3);
  expect(pages('6-horizontal'), '6-up H fills row-major [1..6]').toEqual([1, 2, 3, 4, 5, 6]);
  expect(pages('6-vertical'), '6-up V fills column-major [1,4,2,5,3,6]').toEqual([1, 4, 2, 5, 3, 6]);
  expect(pages('6-horizontalReversed'), '6-up HR reverses each row [3,2,1,6,5,4]').toEqual([3, 2, 1, 6, 5, 4]);
  expect(pages('6-verticalReversed'), '6-up VR reverses each column [3,6,2,5,1,4]').toEqual([3, 6, 2, 5, 1, 4]);

  // ---- the visual record: 2-up Vertical (stacked) -----------------------
  await win.selectOption('[data-print-nup]', '2');
  await win.selectOption('[data-print-page-order]', 'vertical');
  await win.waitForTimeout(450);
  await win.screenshot({ path: path.join(SHOTS, 'phase33-print-order.png') });
  console.log('[P33-order] captured screenshots/phase33-print-order.png (2-up Vertical)');
  await P.closeDialog(win);

  // ---- produced PDFs: 2-up Horizontal vs Vertical -----------------------
  const mode = await P.installCapture(app, win);
  console.log(`[P33-order] capture mode=${mode}`);
  const cases = [
    [2, 'horizontal'],
    [2, 'vertical'],
  ];
  for (const [nup, order] of cases) {
    await P.openDialog(win);
    await win.selectOption('[data-print-nup]', String(nup));
    await win.selectOption('[data-print-page-order]', order);
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-4');
    await P.confirmAndWait(win);
    await P.closeDialog(win);
  }
  const payloads = await P.getCaptured(app, win, mode);
  console.log(`[P33-order] captured payloads=${payloads.length}`);
  expect(payloads.length, 'captured one payload per case').toBe(2);
  for (let i = 0; i < payloads.length; i += 1) {
    const s = payloads[i].settings || {};
    console.log(`[P33-order] payload ${i} images=${payloads[i].images.length} pagesPerSheet=${s.pagesPerSheet} pageOrder=${s.pageOrder}`);
  }

  await P.restoreCapture(app, win, mode);
  if (mode === 'main') {
    const captured = await app.evaluate(() => global.__p33captured);
    await win.evaluate((arr) => {
      window.__p33captured = arr;
    }, captured);
  }
  await P.installPrintOverride(app);
  const files = {};
  for (let i = 0; i < cases.length; i += 1) {
    const [nup, order] = cases[i];
    const outPath = path.join(P.OUT, `p33-spec1-${nup}up-${order}.pdf`);
    const prod = await P.produce(app, win, i, outPath);
    files[`${nup}-${order}`] = outPath;
    console.log(`[P33-order] produced ${nup}up ${order} -> ${outPath} options=${JSON.stringify(prod.options)}`);
  }
  await P.restorePrintOverride(app);

  const info = {};
  const sig = {};
  for (const key of Object.keys(files)) {
    info[key] = await P.inspectPdf(files[key]);
    sig[key] = await P.placementSignature(files[key]);
    console.log(`[P33-order] ${key} pageCount=${info[key].pageCount} sizes=${JSON.stringify(info[key].sizes)}`);
    console.log(`[P33-order] ${key} cellImages=${JSON.stringify(sig[key].cellImages.map((c) => ({ cm: c.cm, hash: c.hash })))}`);
  }

  expect(info['2-horizontal'].pageCount, '2-up H produced 2 sheets').toBe(2);
  expect(info['2-vertical'].pageCount, '2-up V produced 2 sheets').toBe(2);
  const ih = sig['2-horizontal'].cellImages;
  const iv = sig['2-vertical'].cellImages;
  expect(ih.length, '2-up H sheet has 2 image placements').toBe(2);
  expect(iv.length, '2-up V sheet has 2 image placements').toBe(2);
  // Horizontal: side by side (same y, different x). Vertical: stacked (same
  // x, different y). cm[4]=x translation, cm[5]=y translation.
  expect(ih[0].cm[5], '2-up H images share a row').toBe(ih[1].cm[5]);
  expect(ih[0].cm[4], '2-up H images differ in x (side by side)').not.toBe(ih[1].cm[4]);
  expect(iv[0].cm[4], '2-up V images share a column').toBe(iv[1].cm[4]);
  expect(iv[0].cm[5], '2-up V images differ in y (stacked)').not.toBe(iv[1].cm[5]);
  // The two produced documents are genuinely different arrangements.
  expect(
    JSON.stringify(ih.map((c) => c.cm)),
    '2-up produced PDFs place the pages differently',
  ).not.toBe(JSON.stringify(iv.map((c) => c.cm)));
});