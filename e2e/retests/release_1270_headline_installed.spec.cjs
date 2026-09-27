// Release 1.27.0 gate 5 (qa) - the release's headline features on the
// INSTALLED build.
//
//   (a) the standalone print window opens from the in-app dialog's detach
//       control, is titled "Print - Jovrel", renders ONLY the print UI, and is
//       a top-level window that can be moved outside the app window; ONE
//       screenshot: screenshots/release-1270-print-window.png.
//   (b) with the "Microsoft Print to PDF" virtual destination, printing
//       produces the PDF with NO Windows/Chromium print window appearing.
//   (c) Multi View shows ONE composite tab naming both documents, both pane
//       names flanking the divider, and no duplicate thumbnail-strip header.
//
// One-off release gate (e2e/retests/, not the canonical installed suite).
// Launches only through the canonical e2e/lib/launch.cjs launchApp, with an
// explicit installed executablePath.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, openStandalonePrintWindow } = require('../lib/helpers.cjs');
const { SHOTS, openFile, tmpCopy, twoPaneSetup } = require('../lib/p33_common.cjs');

const EXPECTED = require('../../package.json').version;
const INSTALLED =
  process.env.TFLEX_PACKAGED_EXE ||
  'C:\\Program Files\\Jovrel\\Jovrel.exe';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp([], null, INSTALLED);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'release-1270-headline');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Top-level OS windows (title/class/pid/visible). Read-only probe; PowerShell
// only calls EnumWindows, it never launches or drives the app.
function listOsWindows(filterPid) {
  const ps = `
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Proc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      uint p; GetWindowThreadProcessId(h, out p);
      r.Add(p + "|" + IsWindowVisible(h) + "|" + c.ToString() + "|" + t.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
Add-Type -TypeDefinition $src
[WinEnum]::List()
`;
  try {
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    const out = require('node:child_process').execSync(
      `powershell -NoProfile -EncodedCommand ${b64}`,
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    return [`enum failed: ${e.message}`];
  }
}

async function openDetachedPrintWindow() {
  await openFile(app, win, tmpCopy(require('../lib/p33_common.cjs').REPORT, 'p3305-print.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  // Phase 37 item 17 — the title-bar Print icon opens the standalone window
  // directly (the in-app modal and its detach control were removed).
  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForTimeout(600);
  return printPage;
}

// ---------------------------------------------------------------------------
// (a) standalone print window: title, print-only UI, movable outside
// ---------------------------------------------------------------------------
test('1.27.0 (a): detach opens "Print - Jovrel", print-only UI, movable outside the app', async () => {
  const printPage = await openDetachedPrintWindow();

  const info = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    return {
      title: pw.getTitle(),
      parent: pw.getParentWindow() !== null,
      resizable: pw.isResizable(),
      minimizable: pw.isMinimizable(),
      maximizable: pw.isMaximizable(),
      printBounds: pw.getBounds(),
      mainBounds: main.getBounds(),
      count: all.length,
    };
  });
  console.log(`[release-1270-g5a] window info=${JSON.stringify(info)}`);
  expect(info.title, 'print window OS title').toBe('Print - Jovrel');
  expect(info.parent, 'print window is top-level (not a child of the app window)').toBe(false);
  expect(info.resizable).toBe(true);
  expect(info.count).toBe(2);

  const chrome = await printPage.evaluate(() => ({
    printWindow: !!document.querySelector('[data-print-window]'),
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    toolbar: document.querySelectorAll('.action-dock').length,
    titlebar: document.querySelectorAll('.titlebar').length,
    appChrome: document.querySelectorAll('.app').length,
    printer: !!document.querySelector('[data-print-printer]'),
    preview: !!document.querySelector('[data-print-preview]'),
    docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
  }));
  console.log(`[release-1270-g5a] print DOM=${JSON.stringify(chrome)}`);
  expect(chrome.printWindow).toBe(true);
  expect(chrome.tabs, 'no app tabs in the print window').toBe(0);
  expect(chrome.toolbar, 'no app toolbar in the print window').toBe(0);
  expect(chrome.titlebar, 'no app titlebar in the print window').toBe(0);
  expect(chrome.appChrome, 'no app chrome in the print window').toBe(0);
  expect(chrome.printer, 'printer control present').toBe(true);
  expect(chrome.preview, 'preview present').toBe(true);

  await printPage.screenshot({ path: path.join(SHOTS, 'release-1270-print-window.png') });
  console.log('[release-1270-g5a] captured screenshots/release-1270-print-window.png');

  const moved = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    const mb = main.getBounds();
    pw.setBounds({ x: mb.x + mb.width + 200, y: mb.y + 120, width: 820, height: 860 });
    return { print: pw.getBounds(), main: mb };
  });
  console.log(`[release-1270-g5a] moved bounds=${JSON.stringify(moved)}`);
  expect(moved.print.x, 'print window moved fully outside the app window').toBeGreaterThan(
    moved.main.x + moved.main.width,
  );
});

// ---------------------------------------------------------------------------
// (b) virtual PDF destination: produced inside TFlex, no OS print window
// ---------------------------------------------------------------------------
test('1.27.0 (b): virtual PDF destination produces the PDF with no Windows/Chromium print window', async () => {
  await openFile(app, win, tmpCopy(require('../lib/p33_common.cjs').REPORT, 'p3305-pdfout.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const printPage = await openStandalonePrintWindow(app, win);
  const options = await printPage.$$eval('[data-print-printer] option', (opts) => opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })));
  console.log(`[release-1270-g5b] printers=${JSON.stringify(options)}`);
  const pdfOption = options.find((o) => /pdf/i.test(o.text) || /pdf/i.test(o.value));
  expect(pdfOption, 'a virtual PDF printer is offered').toBeTruthy();
  await printPage.selectOption('[data-print-printer]', pdfOption.value);
  await printPage.waitForTimeout(400);

  // Stub the app's own Save-As seam (the native dialog cannot be automated).
  const outPath = path.join(os.tmpdir(), `tflex-release1270-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);

  const mainPid = await app.evaluate(() => process.pid);
  const before = listOsWindows(mainPid);
  console.log(`[release-1270-g5b] OS windows before confirm=${JSON.stringify(before)}`);

  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { timeout: 60000 });
  const success = await printPage.locator('[data-print-success]').innerText();
  console.log(`[release-1270-g5b] success=${JSON.stringify(success)}`);
  await win.waitForTimeout(1500);
  const after = listOsWindows(mainPid);
  console.log(`[release-1270-g5b] OS windows after confirm=${JSON.stringify(after)}`);
  const visiblePrintWindows = after
    .map((line) => { const [pid, vis, cls, ...rest] = line.split('|'); return { pid, vis, cls, title: rest.join('|') }; })
    .filter((w) => w.vis === 'True' && (w.cls === '#32770' || /\bprint\b/i.test(w.title)) && !/^Print - Jovrel$/i.test(w.title));
  console.log(`[release-1270-g5b] visible Windows/Chromium print windows=${JSON.stringify(visiblePrintWindows)}`);
  expect(visiblePrintWindows).toEqual([]);

  expect(fs.existsSync(outPath), 'the produced PDF exists').toBe(true);
  const bytes = fs.readFileSync(outPath);
  expect(bytes.subarray(0, 5).toString('latin1'), 'produced file is a PDF').toBe('%PDF-');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  console.log(`[release-1270-g5b] produced PDF bytes=${bytes.length} pages=${pdf.getPageCount()} -> ${outPath}`);
  expect(pdf.getPageCount()).toBeGreaterThan(0);

  const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log(`[release-1270-g5b] app windows after=${windowsAfter}`);
  // Phase 37 item 17 — the standalone print window stays open after the print,
  // so there are exactly TWO app windows (the app + the print window) and no
  // extra OS print window (asserted above).
  expect(windowsAfter, 'no extra app/print window beyond the app + the standalone print window').toBe(2);
});

// ---------------------------------------------------------------------------
// (c) Multi View: one composite tab, names flank the divider, no strip header
// ---------------------------------------------------------------------------
test('1.27.0 (c): Multi View one composite tab, names flank the divider, no strip header', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(1400);

  const tabs = win.locator('.tab[data-tab-id]');
  const tabCount = await tabs.count();
  const tabId = await tabs.first().getAttribute('data-tab-id');
  const label = (await win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-title').innerText())
    .replace(/\s+/g, ' ').trim();
  console.log(`[release-1270-g5c] tabs=${tabCount} id=${tabId} label="${label}"`);
  expect(tabCount, 'exactly ONE composite tab in Multi View').toBe(1);
  expect(tabId).toBe('tf-multi-workspace');
  expect(label, 'label names doc A').toContain('p33-alpha');
  expect(label, 'label names doc B').toContain('p33-beta');
  expect(label, 'pipe separator').toContain(' | ');

  const geo = await win.evaluate(() => {
    const d = document.querySelector('[data-multi-divider]');
    const a = document.querySelector('.multi-pane-header[data-pane="A"] .multi-pane-title');
    const b = document.querySelector('.multi-pane-header[data-pane="B"] .multi-pane-title');
    if (!d || !a || !b) return { missing: true };
    const dr = d.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return {
      divider: { left: Math.round(dr.left), right: Math.round(dr.right) },
      aText: a.textContent.trim(), aRight: Math.round(ar.right),
      bText: b.textContent.trim(), bLeft: Math.round(br.left),
      stripHeaders: document.querySelectorAll('[data-pane-strip-header]').length,
    };
  });
  console.log(`[release-1270-g5c] geometry=${JSON.stringify(geo)}`);
  expect(geo.missing, 'pane headers + divider present').toBeFalsy();
  expect(geo.aText, 'pane A names doc A').toContain('p33-alpha');
  expect(geo.bText, 'pane B names doc B').toContain('p33-beta');
  expect(geo.aRight, 'doc A name sits LEFT of the divider').toBeLessThanOrEqual(geo.divider.left + 2);
  expect(geo.bLeft, 'doc B name sits RIGHT of the divider').toBeGreaterThanOrEqual(geo.divider.right - 2);
  expect(geo.stripHeaders, 'no duplicate thumbnail-strip header').toBe(0);
});