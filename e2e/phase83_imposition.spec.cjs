// Phase 83 phase-validation e2e (qa) - booklet + poster imposition layouts.
//
// Drives the REAL standalone print window (?tfWindow=print) opened through the
// canonical openStandalonePrintWindow helper (e2e/lib/helpers.cjs), which
// itself launches the dev app through e2e/lib/launch.cjs launchApp. Covers:
//   1. Booklet preview: saddle-stitch sides [8,1],[2,7],[6,3],[4,5] for an
//      8-page selection; gutter/creep/subset visibly change the preview.
//   2. Poster preview: rows x cols tile grid + cut marks; rows/cols change the
//      tile count.
//   3. Fail-loud: invalid overlap/scale/grid shows [data-print-layout-error]
//      and Print is disabled (nothing is sent).
//   4. PRINT-PATH PROOF: drive the app's real printJob to a virtual-PDF
//      destination (device name contains "pdf") with the Save-As dialog stubbed
//      and WebContents.printToPDF captured so BOTH the produced PDF and the
//      composed sheet document are inspected. Proves the composed output is in
//      saddle-stitch order and a Poster run produces rows*cols tile sheets.
//   5. CONTROL-INDEX sweep: every Phase 83 selector is exercised.
//
// Fixture: test-fixtures/report.pdf (34 pages, portrait).
//
// PHASE-GATE PROCEDURE (DEF-487 from ADV-161): this spec drives the built
// renderer, so the phase gate MUST rebuild dist/ BEFORE the e2e run, or the
// suite can silently pass against a stale bundle (the adversary observed
// `scaleAffectsOutput:false` on a stale dist/ that became true after a build).
// Run the gate as:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase83_imposition.spec.cjs
// The `scaleAffectsOutput` assertion in the print-path test is now a hard
// assertion, so a stale build fails loudly instead of passing.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
  hardClose,
} = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'opencode');
const OUT_BOOKLET = path.join(TMP, 'phase83-booklet.pdf');
const OUT_POSTER = path.join(TMP, 'phase83-poster.pdf');
const OUT_POSTER_500 = path.join(TMP, 'phase83-poster-scale500.pdf');
const VIRTUAL_DEVICE = 'TFlex QA PDF Printer';

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const log = (label, obj) => console.log(`[p83|${label}] ${JSON.stringify(obj)}`);

// --- preview inspection ----------------------------------------------------
async function readSides(printPage) {
  return printPage.evaluate(() =>
    [...document.querySelectorAll('[data-print-preview-side]')].map((el) => ({
      index: Number(el.getAttribute('data-print-preview-side')),
      cells: [...el.querySelectorAll('[data-print-preview-cell]')].map((c) => {
        const p = c.getAttribute('data-print-preview-page');
        return {
          page: p === null ? null : Number(p),
          paddingLeft: c.style.paddingLeft,
          paddingRight: c.style.paddingRight,
        };
      }),
    })),
  );
}

async function sidePages(printPage) {
  const sides = await readSides(printPage);
  return sides.map((s) => s.cells.map((c) => c.page));
}

async function waitForBooklet(printPage) {
  await printPage.waitForSelector('[data-print-preview-side]', { timeout: 15000 });
  await printPage.waitForTimeout(400);
}

// --- print-path seams (virtual-PDF destination) ----------------------------
// Capture the payload the UI sends: stub the main-process `print:job` invoke
// handler (the print window's contextBridge object is immutable, so the
// renderer stub the Phase 30 seam prefers is not reachable here; the main
// handler is the SAME observable seam).
async function installMainCapture(app) {
  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (!map || typeof map.get !== 'function') {
      throw new Error('print:job capture unavailable: ipcMain._invokeHandlers missing');
    }
    global.__p83origHandler = map.get('print:job');
    global.__p83captured = [];
    map.set('print:job', async (_e, payload) => {
      global.__p83captured.push(payload);
      return { ok: true };
    });
  });
}

async function restoreMainCapture(app) {
  await app.evaluate(({ ipcMain }) => {
    if (global.__p83origHandler) {
      ipcMain._invokeHandlers.set('print:job', global.__p83origHandler);
      global.__p83origHandler = null;
    }
  });
}

async function getCaptured(app) {
  return app.evaluate(() => global.__p83captured);
}

// Stub the app's single Save-As picker so the virtual-PDF path writes to a
// known temp file without opening the OS dialog.
async function stubSaveDialog(app, outPath) {
  await app.evaluate(({ dialog }, p) => {
    global.__p83origSave = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
}

async function restoreSaveDialog(app) {
  await app.evaluate(({ dialog }) => {
    if (global.__p83origSave) {
      dialog.showSaveDialog = global.__p83origSave;
      global.__p83origSave = null;
    }
  });
}

// Capture the composed sheet document by wrapping the hidden print window's
// printToPDF: read the mounted DOM BEFORE delegating to the real converter, so
// the produced PDF is still real and the exact composed HTML is observable.
async function installComposeCapture(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (global.__p83origPrintToPdf) return;
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    global.__p83pdfProto = proto;
    global.__p83origPrintToPdf = proto.printToPDF;
    global.__p83composedHtml = null;
    global.__p83composeError = null;
    proto.printToPDF = async function (options) {
      try {
        global.__p83composedHtml = await this.executeJavaScript(
          'document.documentElement.outerHTML',
        );
      } catch (e) {
        global.__p83composeError = String((e && e.message) || e);
      }
      return await global.__p83origPrintToPdf.call(this, options);
    };
  });
}

async function restoreComposeCapture(app) {
  await app.evaluate(() => {
    if (global.__p83origPrintToPdf && global.__p83pdfProto) {
      global.__p83pdfProto.printToPDF = global.__p83origPrintToPdf;
      global.__p83origPrintToPdf = null;
      global.__p83pdfProto = null;
    }
  });
}

// Run the app's REAL printJob with a captured payload against the virtual-PDF
// destination and save the produced PDF. Returns { result, composedHtml }.
async function produceReal(printPage, app, payload, outPath) {
  await app.evaluate(() => {
    global.__p83composedHtml = null;
    global.__p83composeError = null;
  });
  const result = await printPage.evaluate(
    async ({ p, device }) => {
      const copy = JSON.parse(JSON.stringify(p));
      copy.settings.deviceName = device;
      return await window.tflex.printJob(copy);
    },
    { p: payload, device: VIRTUAL_DEVICE },
  );
  const composedHtml = await app.evaluate(() => global.__p83composedHtml);
  const composeError = await app.evaluate(() => global.__p83composeError);
  if (composeError) throw new Error(`compose capture failed: ${composeError}`);
  if (!result || result.ok !== true) {
    throw new Error(`real printJob failed: ${JSON.stringify(result)}`);
  }
  expect(fs.existsSync(outPath), `produced PDF written to ${outPath}`).toBe(true);
  return { result, composedHtml };
}

async function inspectPdf(file) {
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => {
    const s = p.getSize();
    return { width: +s.width.toFixed(2), height: +s.height.toFixed(2) };
  });
  return { pageCount: doc.getPageCount(), sizes };
}

// parse the composed sheet document: sheet count, flattened <img> order, cuts.
function parseComposed(html) {
  const sheetCount = (html.match(/<div class="sheet/g) || []).length;
  const cutMarkCount = (html.match(/class="cut-mark/g) || []).length;
  const posterCutSheets = (html.match(/class="sheet poster-cut-marks"/g) || []).length;
  const imgs = [];
  const re = /<img src="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[1]);
  return { sheetCount, cutMarkCount, posterCutSheets, imgs };
}

const CONTROL_INDEX = [
  '[data-print-layout]',
  '[data-print-booklet-gutter]',
  '[data-print-booklet-creep]',
  '[data-print-booklet-subset]',
  '[data-print-poster-rows]',
  '[data-print-poster-cols]',
  '[data-print-poster-overlap]',
  '[data-print-poster-scale]',
  '[data-print-poster-cut-marks]',
  '[data-print-cut-mark]',
  '[data-print-layout-error]',
];

test('Phase 83: booklet + poster imposition (preview, fail-loud, print path, CONTROL-INDEX)', async () => {
  test.setTimeout(300000);
  const seen = new Set();
  const app = await launchApp();
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(`[app] ${String(e).slice(0, 300)}`));
  let printPage = null;
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    log('fixture', { pageCount });
    expect(pageCount, 'fixture report.pdf is multi-page').toBeGreaterThanOrEqual(8);

    printPage = await openStandalonePrintWindow(app, win);
    printPage.on('pageerror', (e) => pageErrors.push(`[print] ${String(e).slice(0, 300)}`));

    // ============ 1. BOOKLET ==============================================
    seen.add('[data-print-layout]');
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-8');
    await printPage.selectOption('[data-print-layout]', 'booklet');
    await waitForBooklet(printPage);
    for (const s of ['[data-print-booklet-gutter]', '[data-print-booklet-creep]', '[data-print-booklet-subset]']) seen.add(s);

    const orderBoth = await sidePages(printPage);
    log('booklet-order-both', orderBoth);
    expect(orderBoth, 'booklet both on 8 pages is the saddle-stitch order').toEqual([
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ]);

    // blast radius: booklet locks the Phase-30 ordering controls.
    await expect(printPage.locator('[data-print-nup]'), 'N-up disabled under booklet').toBeDisabled();
    await expect(printPage.locator('[data-print-page-order]'), 'page order disabled under booklet').toBeDisabled();
    await expect(printPage.locator('[data-print-odd-even]'), 'odd/even disabled under booklet').toBeDisabled();
    await expect(printPage.locator('[data-print-reverse]'), 'reverse disabled under booklet').toBeDisabled();
    // and switching back to Single restores them (no silent ignore).
    await printPage.selectOption('[data-print-layout]', 'single');
    await printPage.waitForTimeout(300);
    await expect(printPage.locator('[data-print-nup]'), 'N-up re-enabled under single').toBeEnabled();
    await expect(printPage.locator('[data-print-odd-even]'), 'odd/even re-enabled under single').toBeEnabled();
    await expect(printPage.locator('[data-print-reverse]'), 'reverse re-enabled under single').toBeEnabled();
    await printPage.selectOption('[data-print-layout]', 'booklet');
    await waitForBooklet(printPage);

    // gutter visibly changes the preview padding.
    await printPage.fill('[data-print-booklet-gutter]', '24');
    await printPage.waitForTimeout(300);
    const gutterSides = await readSides(printPage);
    log('booklet-gutter', gutterSides[0]);
    expect(gutterSides[0].cells[0].paddingLeft, 'gutter 24 -> 12pt inner margin').toBe('12pt');
    expect(gutterSides[0].cells[0].paddingRight, 'gutter 24 -> 12pt inner margin (right)').toBe('12pt');

    // creep visibly shifts the inner sheets (16 pages -> 4 sheets).
    await printPage.fill('[data-print-booklet-gutter]', '0');
    await printPage.fill('[data-print-range-input]', '1-16');
    await printPage.waitForTimeout(300);
    await printPage.fill('[data-print-booklet-creep]', '10');
    await printPage.waitForTimeout(400);
    const creepSides = await readSides(printPage);
    log('booklet-creep', creepSides.map((s) => s.cells[0].paddingLeft));
    expect(creepSides.length, '16-page booklet has 8 sides').toBe(8);
    expect(creepSides[0].cells[0].paddingLeft, 'outer sheet has no creep').toBe('0pt');
    expect(creepSides[2].cells[0].paddingLeft, 'inner sheet creep 10pt').toBe('10pt');

    // subset changes the sides emitted.
    await printPage.fill('[data-print-booklet-creep]', '0');
    await printPage.fill('[data-print-range-input]', '1-8');
    await printPage.waitForTimeout(300);
    await printPage.selectOption('[data-print-booklet-subset]', 'front');
    await waitForBooklet(printPage);
    const front = await sidePages(printPage);
    log('booklet-front', front);
    expect(front, 'front-only emits the front side of each sheet').toEqual([[8, 1], [6, 3]]);
    await printPage.selectOption('[data-print-booklet-subset]', 'back');
    await waitForBooklet(printPage);
    const back = await sidePages(printPage);
    log('booklet-back', back);
    expect(back, 'back-only emits the back side of each sheet').toEqual([[2, 7], [4, 5]]);
    await printPage.selectOption('[data-print-booklet-subset]', 'both');
    await waitForBooklet(printPage);
    await printPage.screenshot({ path: path.join(SHOTS, 'phase83-booklet-preview.png') });
    log('shot', { path: path.join(SHOTS, 'phase83-booklet-preview.png') });

    // ============ 2. POSTER ===============================================
    for (const s of ['[data-print-poster-rows]', '[data-print-poster-cols]', '[data-print-poster-overlap]', '[data-print-poster-scale]', '[data-print-poster-cut-marks]']) seen.add(s);
    await printPage.fill('[data-print-range-input]', '1');
    await printPage.selectOption('[data-print-layout]', 'poster');
    await printPage.waitForSelector('[data-print-preview-tile]', { timeout: 15000 });
    await printPage.waitForTimeout(400);
    const tileCount22 = await printPage.locator('[data-print-preview-tile]').count();
    log('poster-tiles', { tileCount22 });
    expect(tileCount22, 'poster 2x2 renders 4 tiles').toBe(4);

    await printPage.check('[data-print-poster-cut-marks]');
    await printPage.waitForTimeout(300);
    const cutMarks = await printPage.locator('[data-print-cut-mark]').count();
    seen.add('[data-print-cut-mark]');
    log('poster-cut-marks', { cutMarks });
    expect(cutMarks, 'cut marks render in the poster preview').toBeGreaterThan(0);

    await printPage.selectOption('[data-print-poster-rows]', '3');
    await printPage.selectOption('[data-print-poster-cols]', '2');
    await printPage.waitForTimeout(400);
    const tileCount32 = await printPage.locator('[data-print-preview-tile]').count();
    log('poster-tiles-after', { tileCount32 });
    expect(tileCount32, 'rows/cols change the tile count (3x2=6)').toBe(6);

    await printPage.fill('[data-print-poster-overlap]', '24');
    await printPage.waitForTimeout(300);
    expect(await printPage.locator('[data-print-preview-tile]').count(), 'overlap keeps the tile count').toBe(6);
    await printPage.screenshot({ path: path.join(SHOTS, 'phase83-poster-preview.png') });
    log('shot', { path: path.join(SHOTS, 'phase83-poster-preview.png') });

    // ============ 3. FAIL-LOUD ============================================
    seen.add('[data-print-layout-error]');
    await printPage.fill('[data-print-poster-overlap]', '999');
    await printPage.waitForTimeout(300);
    await expect(printPage.locator('[data-print-layout-error]'), 'out-of-range overlap shows the error').toBeVisible();
    await expect(printPage.locator('[data-print-confirm]'), 'Print disabled on invalid overlap').toBeDisabled();

    await printPage.fill('[data-print-poster-overlap]', '0');
    await printPage.fill('[data-print-poster-scale]', '5');
    await printPage.waitForTimeout(300);
    await expect(printPage.locator('[data-print-layout-error]'), 'out-of-range scale shows the error').toBeVisible();
    await expect(printPage.locator('[data-print-confirm]'), 'Print disabled on invalid scale').toBeDisabled();

    await printPage.fill('[data-print-poster-scale]', '100');
    await printPage.waitForTimeout(200);
    await expect(printPage.locator('[data-print-layout-error]'), 'error clears when the values are valid').toHaveCount(0);

    // invalid grid via the real control's change event (no 0/11 options).
    await installMainCapture(app);
    await printPage.evaluate(() => {
      const sel = document.querySelector('[data-print-poster-rows]');
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await printPage.waitForTimeout(300);
    const gridErrorVisible = await printPage.locator('[data-print-layout-error]').isVisible().catch(() => false);
    const confirmDisabled = await printPage.locator('[data-print-confirm]').isDisabled().catch(() => false);
    const capturedWhileInvalid = (await getCaptured(app)).length;
    log('fail-loud-grid', { gridErrorVisible, confirmDisabled, capturedWhileInvalid });
    await restoreMainCapture(app);
    expect(capturedWhileInvalid, 'nothing is sent while the layout is invalid').toBe(0);
    expect(gridErrorVisible || confirmDisabled, 'an invalid grid either errors or blocks Print').toBe(true);
    // reset the grid to a valid value for the print-path runs.
    await printPage.selectOption('[data-print-poster-rows]', '2');
    await printPage.waitForTimeout(300);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
    log('control-index-seen', { count: seen.size, selector: [...seen] });
    expect(seen.size, 'CONTROL-INDEX sweep exercised every Phase 83 selector').toBe(CONTROL_INDEX.length);
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'p83');
  }
});

// ============ 4. PRINT-PATH PROOF =========================================
// Drives the app's REAL printJob (via the print window's IPC) to a virtual-PDF
// destination. The Save-As dialog is stubbed and the hidden compose window's
// printToPDF is wrapped, so the PRODUCED PDF is inspected with pdf-lib and the
// exact COMPOSED SHEET DOCUMENT is parsed for page/tile order and cut marks.
test('Phase 83 print-path proof: composed output is saddle-stitch ordered; poster emits rows*cols sheets', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(`[app] ${String(e).slice(0, 300)}`));
  let printPage = null;
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    printPage = await openStandalonePrintWindow(app, win);
    printPage.on('pageerror', (e) => pageErrors.push(`[print] ${String(e).slice(0, 300)}`));

    // ---- Booklet real run -------------------------------------------------
    await installMainCapture(app);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-8');
    await printPage.selectOption('[data-print-layout]', 'booklet');
    await printPage.selectOption('[data-print-booklet-subset]', 'both');
    await printPage.fill('[data-print-booklet-gutter]', '0');
    await printPage.fill('[data-print-booklet-creep]', '0');
    await printPage.waitForTimeout(400);
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 120000 });
    const bookletPayload = (await getCaptured(app))[0];
    await restoreMainCapture(app);
    expect(bookletPayload, 'booklet payload captured').toBeTruthy();
    log('booklet-payload', {
      images: bookletPayload.images.length,
      layoutMode: bookletPayload.settings.layoutMode,
      pagesPerSheet: bookletPayload.settings.pagesPerSheet,
      landscape: bookletPayload.settings.landscape,
    });
    expect(bookletPayload.images.length, 'booklet 1-8 sends 8 saddle-stitch slots').toBe(8);
    expect(bookletPayload.settings.layoutMode).toBe('booklet');
    expect(bookletPayload.settings.pagesPerSheet).toBe(2);
    expect(bookletPayload.settings.landscape).toBe(true);

    await stubSaveDialog(app, OUT_BOOKLET);
    await installComposeCapture(app);
    const bookletRun = await produceReal(printPage, app, bookletPayload, OUT_BOOKLET);
    await restoreComposeCapture(app);
    await restoreSaveDialog(app);
    log('booklet-real', { result: bookletRun.result });
    expect(bookletRun.result.outcome, 'virtual-PDF run saved a file').toBe('saved');
    expect(bookletRun.result.path).toBe(OUT_BOOKLET);

    const bookletInfo = await inspectPdf(OUT_BOOKLET);
    log('booklet-pdf', bookletInfo);
    expect(bookletInfo.pageCount, '8 saddle-stitch slots compose 4 landscape sheets').toBe(4);
    expect(bookletInfo.sizes[0].width, 'booklet sheet is landscape').toBeGreaterThan(
      bookletInfo.sizes[0].height,
    );

    const bookletComposed = parseComposed(bookletRun.composedHtml);
    log('booklet-composed', { sheets: bookletComposed.sheetCount, imgs: bookletComposed.imgs.length });
    expect(bookletComposed.sheetCount, 'composed document has 4 booklet sheets').toBe(4);
    expect(bookletComposed.imgs.length, 'composed document embeds the 8 slot images in order').toBe(8);
    // The composed sheet document reproduces the renderer's saddle-stitch order
    // byte-for-byte: the print path did not reorder or drop a slot.
    expect(
      bookletComposed.imgs,
      'composed sheet document preserves the saddle-stitch image order',
    ).toEqual(bookletPayload.images);

    // ---- Poster real run --------------------------------------------------
    await installMainCapture(app);
    await printPage.fill('[data-print-range-input]', '1');
    await printPage.selectOption('[data-print-layout]', 'poster');
    await printPage.selectOption('[data-print-poster-rows]', '2');
    await printPage.selectOption('[data-print-poster-cols]', '2');
    await printPage.fill('[data-print-poster-overlap]', '0');
    await printPage.fill('[data-print-poster-scale]', '100');
    await printPage.check('[data-print-poster-cut-marks]');
    await printPage.waitForTimeout(500);
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 120000 });
    const posterPayload = (await getCaptured(app))[0];
    await restoreMainCapture(app);
    expect(posterPayload, 'poster payload captured').toBeTruthy();
    log('poster-payload', {
      images: posterPayload.images.length,
      layoutMode: posterPayload.settings.layoutMode,
      rows: posterPayload.settings.posterRows,
      cols: posterPayload.settings.posterCols,
      cutMarks: posterPayload.settings.posterCutMarks,
    });
    expect(posterPayload.images.length, 'poster 2x2 sends 4 tile sheets').toBe(4);
    expect(posterPayload.settings.layoutMode).toBe('poster');
    expect(posterPayload.settings.posterCutMarks).toBe(true);

    await stubSaveDialog(app, OUT_POSTER);
    await installComposeCapture(app);
    const posterRun = await produceReal(printPage, app, posterPayload, OUT_POSTER);
    await restoreComposeCapture(app);
    await restoreSaveDialog(app);
    const posterInfo = await inspectPdf(OUT_POSTER);
    log('poster-pdf', posterInfo);
    expect(posterInfo.pageCount, 'poster 2x2 produces 4 tile sheets').toBe(4);

    const posterComposed = parseComposed(posterRun.composedHtml);
    log('poster-composed', {
      sheets: posterComposed.sheetCount,
      posterCutSheets: posterComposed.posterCutSheets,
      cutMarks: posterComposed.cutMarkCount,
    });
    expect(posterComposed.sheetCount, 'composed poster document has 4 sheets').toBe(4);
    expect(posterComposed.posterCutSheets, 'every poster sheet carries cut marks').toBe(4);
    expect(posterComposed.cutMarkCount, '4 corner marks per sheet').toBe(16);

    // ---- CONTROL-INDEX probe: does [data-print-poster-scale] affect output? --
    await installMainCapture(app);
    await printPage.fill('[data-print-poster-scale]', '500');
    await printPage.waitForTimeout(400);
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 120000 });
    const scale500Payload = (await getCaptured(app))[0];
    await restoreMainCapture(app);
    await stubSaveDialog(app, OUT_POSTER_500);
    await installComposeCapture(app);
    const scale500Run = await produceReal(printPage, app, scale500Payload, OUT_POSTER_500);
    await restoreComposeCapture(app);
    await restoreSaveDialog(app);
    const composed500 = parseComposed(scale500Run.composedHtml);
    const scaleAffectsOutput = JSON.stringify(composed500.imgs) !== JSON.stringify(posterComposed.imgs);
    log('poster-scale-probe', {
      scale100: posterPayload.settings.posterScalePercent,
      scale500: scale500Payload.settings.posterScalePercent,
      scaleAffectsOutput,
    });
    // DEF-487 (from ADV-161): assert the DEF-483 criterion. Logging alone let a
    // stale `dist/` (or a regression of the scale fix) pass the suite silently.
    expect(
      scaleAffectsOutput,
      'DEF-483: poster Scale 100 vs 500 must change the composed output',
    ).toBe(true);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'p83-path');
  }
});
