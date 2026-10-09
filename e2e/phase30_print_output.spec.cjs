// Phase 30 focused verification (qa): the PRINTED OUTPUT.
//
// Phase 30 success criteria 2, 3 and 7 require the produced document to be
// inspected, not just the preview. The real print call cannot be automated
// (silent printing to a virtual PDF driver fails: Electron exposes no
// output-path option, and the virtual-PDF path opens the OS dialog inside a
// hidden window). This spec closes that gap with a TEST-HARNESS SEAM, not a
// product change:
//
//   * The dialog's payload is captured by stubbing `window.tflex.printJob`
//     in the renderer (falling back to intercepting the main-process
//     `print:job` IPC handler if the contextBridge object is immutable).
//   * The app's REAL `printJob` is then run with the captured payload
//     against a bogus device name, with `WebContents.prototype.print`
//     overridden in the main process so it calls `printToPDF(options)` on
//     the SAME hidden webContents the app composed. The app's own composed
//     HTML is therefore what gets converted, and the produced PDF is
//     inspected with pdf-lib (page count + page size) and rendered with
//     pdfjs-dist + @napi-rs/canvas for a visual check.
//
// Fixture: test-fixtures/report.pdf (34 pages, portrait).
//
// Cases:
//   A  custom range 3-5            -> 3 images; produced PDF 3 pages, portrait
//   B  range 1-4 + N-up 2 + landscape -> 4 images; produced PDF 2 pages, landscape
//   C  range 3-5 + reverse         -> 3 images; first image differs from A
//   D  scaling fit then custom 50% -> settings carry fit, then custom/50
//
// NOT printed to any physical device: the override intercepts `print` before
// any driver is reached, and the device name is a bogus string.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');

const REPORT = path.resolve(__dirname, '..', 'test-fixtures', 'report.pdf');
const OUT_DIR = path.join(os.tmpdir(), 'opencode');
const OUT_A = path.join(OUT_DIR, 'phase30-caseA-range3-5.pdf');
const OUT_B = path.join(OUT_DIR, 'phase30-caseB-nup2-landscape.pdf');
const SHOT = path.resolve(__dirname, '..', 'screenshots', 'phase30-print-output.png');
const BOGUS_DEVICE = 'TFlex QA Bogus Printer';

// --- produced-PDF inspection (pdf-lib) -------------------------------------
async function inspectPdf(file) {
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => {
    const s = p.getSize();
    return { width: +s.width.toFixed(2), height: +s.height.toFixed(2) };
  });
  return { pageCount: doc.getPageCount(), sizes };
}

// --- open the produced PDF in the app and screenshot its first page --------
// The produced PDF embeds a large FlateDecode ICCBased bitmap that crashes the
// native @napi-rs/canvas decoder, so the visual check uses the app's own
// pdf.js viewer (the same engine that will show the document to a user).
async function openProducedInApp(app, win, pdfPath, outPng) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, pdfPath);
  await win.click('[data-toolbar-open]');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await win.locator('.tab-pane[aria-hidden="false"] .pdf-page').first().screenshot({ path: outPng });
}

// --- payload capture -------------------------------------------------------
// Prefer the renderer stub the task names. contextBridge objects are often
// immutable, so verify the assignment actually took effect before driving the
// dialog (a silent failure would let the REAL printJob run). If it did not,
// intercept the main-process `print:job` handler instead - same observable
// capture, no real print.
async function installCapture(app, win) {
  const mode = await win.evaluate(() => {
    window.__p30captured = [];
    try {
      const orig = window.tflex.printJob;
      window.tflex.printJob = async (payload) => {
        window.__p30captured.push(payload);
        return { ok: true };
      };
      if (window.tflex.printJob !== orig) {
        window.__p30origPrintJob = orig;
        return 'renderer';
      }
      window.tflex.printJob = orig;
      return 'none';
    } catch (_) {
      return 'none';
    }
  });
  if (mode === 'renderer') return mode;
  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (!map || typeof map.get !== 'function') {
      throw new Error('capture fallback unavailable: ipcMain._invokeHandlers missing');
    }
    global.__p30origHandler = map.get('print:job');
    global.__p30captured = [];
    map.set('print:job', async (_e, payload) => {
      global.__p30captured.push(payload);
      return { ok: true };
    });
  });
  return 'main';
}

async function restoreCapture(app, win, mode) {
  if (mode === 'renderer') {
    await win.evaluate(() => {
      window.tflex.printJob = window.__p30origPrintJob;
    });
  } else {
    await app.evaluate(({ ipcMain }) => {
      ipcMain._invokeHandlers.set('print:job', global.__p30origHandler);
    });
  }
}

async function getCaptured(app, win, mode) {
  if (mode === 'renderer') return win.evaluate(() => window.__p30captured);
  return app.evaluate(() => global.__p30captured);
}

// --- print override (test-harness seam) ------------------------------------
async function installPrintOverride(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (global.__p30origPrint) return;
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    global.__p30printProto = proto;
    global.__p30origPrint = proto.print;
    global.__p30printResults = [];
    proto.print = function (options, callback) {
      this.printToPDF(options)
        .then((buf) => {
          global.__p30printResults.push({ options, base64: buf.toString('base64') });
          callback(true, '');
        })
        .catch((err) => {
          const msg = String((err && err.message) || err);
          global.__p30printResults.push({ options, error: msg });
          callback(false, msg);
        });
    };
  });
}

async function restorePrintOverride(app) {
  await app.evaluate(() => {
    if (global.__p30origPrint && global.__p30printProto) {
      global.__p30printProto.print = global.__p30origPrint;
      global.__p30origPrint = null;
      global.__p30printProto = null;
    }
  });
}

// Run the app's REAL printJob with a captured payload and save the produced PDF.
async function produce(app, win, index, outPath) {
  await app.evaluate(() => {
    global.__p30printResults = [];
  });
  const res = await win.evaluate(
    async ({ i, device }) => {
      const p = JSON.parse(JSON.stringify(window.__p30captured[i]));
      p.settings.deviceName = device;
      return await window.tflex.printJob(p);
    },
    { i: index, device: BOGUS_DEVICE },
  );
  const results = await app.evaluate(() => global.__p30printResults);
  if (!results || results.length === 0) {
    throw new Error(`no printToPDF result captured for case ${index}: ${JSON.stringify(res)}`);
  }
  const r = results[0];
  if (r.error) throw new Error(`printToPDF failed for case ${index}: ${r.error}`);
  fs.writeFileSync(outPath, Buffer.from(r.base64, 'base64'));
  return { res, options: r.options };
}

// --- dialog driving --------------------------------------------------------
async function openDialog(app, win) {
  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await printPage.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      if (sel === null) return false;
      const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      const settled =
        document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
      return hasReal || settled;
    },
    null,
    { timeout: 20000 },
  );
  return printPage;
}

async function closeDialog(printPage) {
  if (printPage.isClosed()) return;
  const closed = printPage.waitForEvent('close', { timeout: 8000 }).catch(() => {});
  await printPage.click('[data-print-cancel]').catch(() => {});
  await closed;
}

async function confirmAndWait(printPage) {
  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 120000 });
}

test('Phase 30 print output: captured payload + real produced PDFs', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  let mode = null;
  let overrideInstalled = false;
  try {
    // --- open the 34-page fixture ----------------------------------------
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P30out] fixture=report.pdf pageCount=${pageCount}`);
    expect(pageCount, 'fixture has at least 5 pages').toBeGreaterThanOrEqual(5);

    // --- capture the dialog payloads -------------------------------------
    mode = await installCapture(app, win);
    console.log(`[P30out] capture mode=${mode}`);

    // Case A - custom range 3-5 (defaults: fit, portrait, 1-up)
    let printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '3-5');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    // Case B - range 1-4 + N-up 2 + landscape
    printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-4');
    await printPage.selectOption('[data-print-nup]', '2');
    await printPage.click('[data-print-orientation-landscape]');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    // Case C - range 3-5 + reverse
    printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '3-5');
    await printPage.click('[data-print-reverse]');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    // Case D - range 3-5 + custom scaling 50%
    printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '3-5');
    await printPage.click('[data-print-scale-custom]');
    await printPage.fill('[data-print-scale-percent]', '50');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    // Supplementary reverse proof. report.pdf pages 3 and 5 are byte-identical
    // (same content stream), so Case C's range 3-5 cannot show a reorder by
    // comparing first images. Range 2-4 has distinct endpoints (page 2 != 4),
    // so capture it both ways and prove the order actually reverses.
    printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '2-4');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    printPage = await openDialog(app, win);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '2-4');
    await printPage.click('[data-print-reverse]');
    await confirmAndWait(printPage);
    await closeDialog(printPage);

    const payloads = await getCaptured(app, win, mode);
    console.log(`[P30out] captured payloads=${payloads.length}`);
    expect(payloads.length, 'six payloads captured').toBe(6);
    for (let i = 0; i < payloads.length; i += 1) {
      const s = payloads[i].settings || {};
      console.log(
        `[P30out] payload ${i} images=${payloads[i].images.length} ` +
          `scaling=${s.scaling} scalePercent=${s.scalePercent} ` +
          `pagesPerSheet=${s.pagesPerSheet} landscape=${s.landscape} reverse=${s.reverse}`,
      );
    }

    const [A, B, C, D, C0, C2] = payloads;
    // Case A
    expect(A.images.length, 'Case A range 3-5 -> 3 images').toBe(3);
    expect(A.settings.scaling, 'Case A default scaling is fit').toBe('fit');
    // Case B
    expect(B.images.length, 'Case B range 1-4 -> 4 images').toBe(4);
    expect(B.settings.pagesPerSheet, 'Case B pagesPerSheet is 2').toBe(2);
    expect(B.settings.landscape, 'Case B landscape is true').toBe(true);
    // Case C (task-specified range 3-5 + reverse)
    expect(C.images.length, 'Case C range 3-5 -> 3 images').toBe(3);
    expect(C.settings.reverse, 'Case C reverse is on').toBe(true);
    // Case D
    expect(D.settings.scaling, 'Case D scaling is custom').toBe('custom');
    expect(D.settings.scalePercent, 'Case D scalePercent is 50').toBe(50);
    // Supplementary reverse proof (range 2-4, distinct endpoints)
    expect(C0.images.length, 'reverse proof base range 2-4 -> 3 images').toBe(3);
    expect(C0.settings.reverse, 'reverse proof base has reverse off').toBe(false);
    expect(C2.images.length, 'reverse proof reversed range 2-4 -> 3 images').toBe(3);
    expect(C2.settings.reverse, 'reverse proof reversed has reverse on').toBe(true);
    const reversedMatches = C2.images.every((img, i) => img === C0.images[C0.images.length - 1 - i]);
    console.log(
      `[P30out] reverse proof: C2 equals C0 reversed=${reversedMatches}; ` +
        `C2[0]===C0[0]=${C2.images[0] === C0.images[0]}; ` +
        `C2[0]===A[0]=${C2.images[0] === A.images[0]}; ` +
        `C[0]===A[0]=${C.images[0] === A.images[0]} (pages 3 and 5 are identical)`,
    );
    expect(reversedMatches, 'reverse reorders the image list (C2 == C0 reversed)').toBe(true);
    expect(C2.images[0] === C0.images[0], 'reverse changes the first image').toBe(false);
    expect(C2.images[0] === A.images[0], 'reversed first image differs from Case A first image').toBe(
      false,
    );

    // --- produce real PDFs through the app's own printJob -----------------
    await restoreCapture(app, win, mode);
    if (mode === 'main') {
      const captured = await app.evaluate(() => global.__p30captured);
      await win.evaluate((arr) => {
        window.__p30captured = arr;
      }, captured);
    }
    await installPrintOverride(app);
    overrideInstalled = true;

    const prodA = await produce(app, win, 0, OUT_A);
    console.log(`[P30out] Case A produced=${OUT_A} options=${JSON.stringify(prodA.options)}`);
    const prodB = await produce(app, win, 1, OUT_B);
    console.log(`[P30out] Case B produced=${OUT_B} options=${JSON.stringify(prodB.options)}`);

    await restorePrintOverride(app);
    overrideInstalled = false;

    // --- inspect the produced PDFs ---------------------------------------
    const infoA = await inspectPdf(OUT_A);
    const infoB = await inspectPdf(OUT_B);
    console.log(`[P30out] Case A pageCount=${infoA.pageCount} sizes=${JSON.stringify(infoA.sizes)}`);
    console.log(`[P30out] Case B pageCount=${infoB.pageCount} sizes=${JSON.stringify(infoB.sizes)}`);

    expect(infoA.pageCount, 'Case A produced PDF has exactly 3 pages').toBe(3);
    expect(infoA.sizes[0].width, 'Case A page is portrait (width < height)').toBeLessThan(
      infoA.sizes[0].height,
    );
    expect(infoB.pageCount, 'Case B produced PDF has exactly 2 pages (4 images at 2-up)').toBe(2);
    expect(infoB.sizes[0].width, 'Case B page is landscape (width > height)').toBeGreaterThan(
      infoB.sizes[0].height,
    );

    // --- visual: open produced Case A in the app and screenshot page 1 ----
    await openProducedInApp(app, win, OUT_A, SHOT);
    console.log(`[P30out] screenshot of produced Case A page 1 -> ${SHOT}`);
  } finally {
    if (overrideInstalled) {
      await restorePrintOverride(app).catch(() => {});
    }
    if (mode !== null) {
      await restoreCapture(app, win, mode).catch(() => {});
    }
    await hardClose(app, 'p30out');
  }
});