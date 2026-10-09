// Phase 30 focused verification (qa): the print dialog's annotations toggle
// must visibly change the rastered preview.
//
// Contract: "printing includes/excludes annotations". The wiring is unit-tested
// (printRaster.test.ts asserts annotationMode ENABLE_STORAGE vs DISABLE), but no
// real render has proven an annotation actually appears/disappears. The dialog
// preview shows the rastered first selected page, so the toggle's effect is
// directly observable on screen.
//
// Fixture: test-fixtures/squiggly-native.pdf - one Letter page, black Helvetica
// text plus a red native /Squiggly markup annotation over the text (baked with
// pdf-lib's low-level context API). It re-imports as kind "squiggly" and pdf.js
// paints the red squiggle onto the canvas (proven by
// e2e/retests/def_174_markup_regression.spec.cjs).
//
// NOT clicked: [data-print-confirm] - the real print hand-off can hang the run.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'squiggly-native.pdf');

function previewSrc(page) {
  return page.evaluate(() => {
    const img = document.querySelector('[data-print-preview] img');
    return img ? img.getAttribute('src') : null;
  });
}

test('Phase 30 print preview reflects the annotations toggle', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();

  try {
    // --- open the annotated fixture ---------------------------------------
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, FIXTURE);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(800);

    const anns = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return (d.engineState.annotations || []).map((a) => a.kind);
    });
    console.log(`[P30ann] fixture=${FIXTURE} annotations=${JSON.stringify(anns)}`);
    expect(anns, 'fixture imports its native /Squiggly annotation').toContain('squiggly');

    // --- open the print dialog --------------------------------------------
    const printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });

    const onByDefault = await printPage.isChecked('[data-print-annotations]');
    console.log(`[P30ann] annotations toggle ON by default=${onByDefault}`);
    expect(onByDefault, 'annotations toggle is ON by default').toBe(true);

    // --- wait for the preview raster (the <img>, not a DOM overlay) -------
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    await printPage.waitForTimeout(600);
    const srcOn = await previewSrc(printPage);
    console.log(`[P30ann] ON src present=${srcOn !== null} length=${srcOn ? srcOn.length : 0}`);
    expect(srcOn, 'preview raster present with annotations ON').toBeTruthy();

    await printPage.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-annot-on.png'),
    });

    // --- toggle annotations OFF and wait for the preview to re-raster -----
    await printPage.click('[data-print-annotations]');
    await printPage.waitForFunction(
      (prev) => {
        const img = document.querySelector('[data-print-preview] img');
        return img !== null && img.getAttribute('src') !== prev;
      },
      srcOn,
      { timeout: 20000 },
    );
    await printPage.waitForTimeout(600);
    const srcOff = await previewSrc(printPage);
    console.log(`[P30ann] OFF src present=${srcOff !== null} length=${srcOff ? srcOff.length : 0}`);
    expect(srcOff, 'preview raster present with annotations OFF').toBeTruthy();

    await printPage.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-annot-off.png'),
    });

    // --- the two preview rasters must differ ------------------------------
    console.log(`[P30ann] src identical=${srcOn === srcOff}`);
    expect(srcOn, 'preview raster must differ with annotations ON vs OFF').not.toBe(srcOff);
  } finally {
    await hardClose(app, 'p30ann');
  }
});