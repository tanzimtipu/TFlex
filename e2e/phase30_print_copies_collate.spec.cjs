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
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'squiggly-native.pdf');
const BOGUS_DEVICE = '__p30_copies_bogus__';

// Stub the OS printer list to a single bogus device so the dialog selects it
// and the real printJob runs with a device that cannot reach hardware.
async function stubBogusPrinter(app) {
  await app.evaluate(({ BrowserWindow }, name) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.getPrintersAsync = async () => [
      { name, displayName: 'P30 Bogus Printer', isDefault: true },
    ];
  }, BOGUS_DEVICE);
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

async function openDialog(win) {
  await win.click('[data-print]');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await win.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      return sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
    },
    null,
    { timeout: 20000 },
  );
}

async function closeDialog(win) {
  await win.click('[data-print-cancel]');
  await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
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
    await openDialog(win);
    await win.fill('[data-print-copies]', '3');
    await win.check('[data-print-collate]');
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { state: 'visible', timeout: 60000 });
    await closeDialog(win);

    // Case 2 - Copies=1 (collate is forced off by the settings mapping).
    await openDialog(win);
    await win.fill('[data-print-copies]', '1');
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { state: 'visible', timeout: 60000 });
    await closeDialog(win);

    const options = await app.evaluate(() => global.__p30ccOptions);
    console.log(`[P30cc] captured options=${JSON.stringify(options)}`);
    expect(options.length, 'two print calls captured').toBe(2);
    expect(options[0].copies, 'case 1 copies reaches print').toBe(3);
    expect(options[0].collate, 'case 1 collate reaches print').toBe(true);
    expect(options[1].copies, 'case 2 copies reaches print').toBe(1);
    expect(options[1].collate, 'case 2 collate is false').toBe(false);
  } finally {
    await restorePrintCapture(app).catch(() => {});
    await hardClose(app, 'p30cc');
  }
});