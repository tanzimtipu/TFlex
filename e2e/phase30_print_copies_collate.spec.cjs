// Phase 30 criterion 5 tightening (qa, run-close pass).
//
// Criterion 5 says "copies/collate reach the print call". The dialog unit
// tests prove `buildPrintSettings` maps the controls, and the print service
// unit tests prove `mapPrintSettings` maps the settings, but nothing has
// proven the two halves meet in the REAL running app: that a Copies=3 +
// Collate ON print actually calls `webContents.print` with `copies: 3` and
// `collate: true`.
//
// This spec reuses the printToPDF seam from phase30_print_output.spec.cjs:
// `WebContents.prototype.print` is overridden in the main process so the
// options object the app passes is captured verbatim. The override calls the
// callback directly (no driver is reached), and the printer list is stubbed
// to a bogus device name, so nothing is ever sent to a physical printer.
//
// Cases:
//   1  Copies=3 + Collate ON  -> captured options copies: 3, collate: true
//   2  Copies=1               -> captured options copies: 1, collate: false
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'squiggly-native.pdf');
const BOGUS_DEVICE = '__p30_copies_bogus__';

// Stub the OS printer list to a single bogus device so the dialog selects it
// and the real printJob runs with a device that cannot reach hardware. The
// print controls live in the standalone print window, whose renderer calls
// `print:listPrinters` -> `listPrinters(event.sender)` -> the invoking
// webContents `getPrintersAsync`; overriding the WebContents prototype covers
// the print window created later by openStandalonePrintWindow.
async function stubBogusPrinter(app) {
  await app.evaluate(({ BrowserWindow }, name) => {
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    globalThis.__p30ccPrinterProto = proto;
    globalThis.__p30ccOrigGetPrinters = proto.getPrintersAsync;
    proto.getPrintersAsync = async () => [
      { name, displayName: 'P30 Bogus Printer', isDefault: true },
    ];
  }, BOGUS_DEVICE);
}

async function restoreBogusPrinter(app) {
  await app.evaluate(() => {
    if (globalThis.__p30ccPrinterProto) {
      globalThis.__p30ccPrinterProto.getPrintersAsync = globalThis.__p30ccOrigGetPrinters;
      globalThis.__p30ccPrinterProto = null;
    }
  });
}

// The printToPDF seam: capture the options object `webContents.print` is
// called with, then settle the callback so printJob resolves.
async function installPrintCapture(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (global.__p30ccOrigPrint) return;
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    global.__p30ccProto = proto;
    global.__p30ccOrigPrint = proto.print;
    global.__p30ccOptions = [];
    proto.print = function (options, callback) {
      global.__p30ccOptions.push(options);
      callback(true, '');
    };
  });
}

async function restorePrintCapture(app) {
  await app.evaluate(() => {
    if (global.__p30ccOrigPrint && global.__p30ccProto) {
      global.__p30ccProto.print = global.__p30ccOrigPrint;
      global.__p30ccOrigPrint = null;
      global.__p30ccProto = null;
    }
  });
}

async function openDialog(app, win) {
  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await printPage.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      return sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
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

test('Phase 30 criterion 5: copies/collate reach the print call', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, FIXTURE);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);

    await stubBogusPrinter(app);
    await installPrintCapture(app);

    // Case 1 - Copies=3 + Collate ON.
    let printPage = await openDialog(app, win);
    await printPage.fill('[data-print-copies]', '3');
    await printPage.check('[data-print-collate]');
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 60000 });
    await closeDialog(printPage);

    // Case 2 - Copies=1 (collate is forced off by the settings mapping).
    printPage = await openDialog(app, win);
    await printPage.fill('[data-print-copies]', '1');
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 60000 });
    await closeDialog(printPage);

    const options = await app.evaluate(() => global.__p30ccOptions);
    console.log(`[P30cc] captured options=${JSON.stringify(options)}`);
    expect(options.length, 'two print calls captured').toBe(2);
    expect(options[0].copies, 'case 1 copies reaches print').toBe(3);
    expect(options[0].collate, 'case 1 collate reaches print').toBe(true);
    expect(options[1].copies, 'case 2 copies reaches print').toBe(1);
    expect(options[1].collate, 'case 2 collate is false').toBe(false);
  } finally {
    await restorePrintCapture(app).catch(() => {});
    await restoreBogusPrinter(app).catch(() => {});
    await hardClose(app, 'p30cc');
  }
});