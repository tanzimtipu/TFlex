// Phase 35 run-close re-confirmation (qa) — the two most consequential
// behaviours, re-proven on the CURRENT build with fresh raw evidence and NO
// screenshots:
//
//   E-a  a virtual-PDF destination produces the file INSIDE TFlex with NO
//        Windows/Chromium print window, and the produced file matches the
//        preview/settings (page count + orientation) through the Save-As seam.
//   E-b  the standalone print window, moved OUTSIDE the app window's bounds,
//        still updates its preview and completes the print/save there, and
//        closing it leaves the app usable.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-reconfirm');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Read-only EnumWindows probe (same approach as phase35_gate): prove no
// Windows/Chromium print window appeared. Never touches the registry.
function listOsWindows(filterPid) {
  const ps = `
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WinEnumR {
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
[WinEnumR]::List()
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

function visiblePrintWindows(lines) {
  return lines
    .map((line) => { const [pid, vis, cls, ...rest] = line.split('|'); return { pid, vis, cls, title: rest.join('|') }; })
    .filter((w) => w.vis === 'True' && (/electron.*print/i.test(w.title) || w.cls === '#32770'));
}

// The virtual-PDF destination + a 2-page landscape selection, on whichever
// print surface is passed (the in-app dialog or the detached print window).
async function chooseVirtualPdf(page) {
  await page.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const sel = document.querySelector('[data-print-printer]');
    if (sel === null) return false;
    const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
    return hasReal || document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
  }, null, { timeout: 20000 });
  const options = await page.$$eval('[data-print-printer] option', (opts) => opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })));
  const pdfOption = options.find((o) => /pdf/i.test(o.text) || /pdf/i.test(o.value));
  expect(pdfOption, 'a virtual-PDF destination is offered').toBeTruthy();
  await page.selectOption('[data-print-printer]', pdfOption.value);
  await page.waitForTimeout(400);
  await page.click('[data-print-range-custom]');
  await page.fill('[data-print-range-input]', '1-2');
  await page.click('[data-print-orientation-landscape]');
  await page.waitForTimeout(500);
  return pdfOption;
}

// Reparse the produced file: a real PDF whose page count/orientation match the
// preview+settings (2 pages, landscape). Returns a compact evidence object.
async function assertProducedPdf(outPath) {
  expect(fs.existsSync(outPath), 'produced file exists').toBe(true);
  const bytes = fs.readFileSync(outPath);
  expect(bytes.subarray(0, 5).toString('latin1'), 'produced file is a PDF').toBe('%PDF-');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount(), 'produced page count matches the 1-2 range').toBe(2);
  for (const p of pdf.getPages()) {
    const s = p.getSize();
    expect(s.width, 'produced page is landscape').toBeGreaterThan(s.height);
  }
  return { bytes: bytes.length, pages: pdf.getPageCount(), sizes: pdf.getPages().map((p) => p.getSize()) };
}

// ---------------------------------------------------------------------------
// E-a: virtual-PDF destination -> file produced inside TFlex, no print window.
// ---------------------------------------------------------------------------
test('E-a virtual-PDF print produces the file inside TFlex, no print window', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35e-a.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const printPage = await openStandalonePrintWindow(app, win);
  await chooseVirtualPdf(printPage);
  const previewMeta = await printPage.locator('[data-print-preview-meta]').innerText();

  const outPath = path.join(os.tmpdir(), `tflex-p35-ea-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);

  const mainPid = await app.evaluate(() => process.pid);
  const before = listOsWindows(mainPid);
  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { timeout: 60000 });
  const success = await printPage.locator('[data-print-success]').innerText();
  await win.waitForTimeout(1500);
  const after = listOsWindows(mainPid);
  const printWindows = visiblePrintWindows(after);
  const produced = await assertProducedPdf(outPath);

  console.log(`[E-a] preview meta=${JSON.stringify(previewMeta)}`);
  console.log(`[E-a] success=${JSON.stringify(success)}`);
  console.log(`[E-a] OS windows before=${JSON.stringify(before)}`);
  console.log(`[E-a] OS windows after=${JSON.stringify(after)}`);
  console.log(`[E-a] visible Windows/Chromium print windows=${JSON.stringify(printWindows)}`);
  console.log(`[E-a] produced=${JSON.stringify(produced)} file=${outPath}`);

  expect(previewMeta, 'preview shows the 2-page selection').toContain('2 pages');
  expect(success, 'the success region names the saved file').toContain('Saved to');
  expect(success).toContain(outPath);
  expect(printWindows, 'no Windows/Chromium print window appeared').toEqual([]);
});

// ---------------------------------------------------------------------------
// E-b: the standalone print window, moved outside the app, still prints.
// ---------------------------------------------------------------------------
test('E-b detached print window prints while moved outside the app window', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35e-b.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForTimeout(600);

  // Print-only UI: no app chrome/tabs, printer list + preview present.
  const chrome = await printPage.evaluate(() => ({
    printWindow: !!document.querySelector('[data-print-window]'),
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    toolbar: document.querySelectorAll('.action-dock').length,
    titlebar: document.querySelectorAll('.titlebar').length,
    printer: !!document.querySelector('[data-print-printer]'),
    preview: !!document.querySelector('[data-print-preview]'),
    docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
  }));
  console.log(`[E-b] print window DOM=${JSON.stringify(chrome)}`);
  expect(chrome.printWindow).toBe(true);
  expect(chrome.tabs).toBe(0);
  expect(chrome.toolbar).toBe(0);
  expect(chrome.titlebar).toBe(0);
  expect(chrome.printer).toBe(true);
  expect(chrome.preview).toBe(true);

  // Move the print window OUTSIDE the app window's bounds.
  const moved = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    const mb = main.getBounds();
    pw.setBounds({ x: mb.x + mb.width + 200, y: mb.y + 120, width: 820, height: 860 });
    return { print: pw.getBounds(), main: mb };
  });
  console.log(`[E-b] moved bounds=${JSON.stringify(moved)}`);
  expect(moved.print.x, 'print window sits beyond the app window').toBeGreaterThan(moved.main.x + moved.main.width);

  // Change a setting IN the moved window: the preview must update.
  const beforeMeta = await printPage.locator('[data-print-preview-meta]').innerText();
  await printPage.click('[data-print-range-custom]');
  await printPage.fill('[data-print-range-input]', '1-2');
  await printPage.click('[data-print-orientation-landscape]');
  await printPage.waitForTimeout(700);
  const previewMeta = await printPage.locator('[data-print-preview-meta]').innerText();
  console.log(`[E-b] preview meta before=${JSON.stringify(beforeMeta)} after=${JSON.stringify(previewMeta)}`);
  expect(previewMeta, 'the moved window preview reflects the 2-page selection').toContain('2 pages');

  await chooseVirtualPdf(printPage);
  const outPath = path.join(os.tmpdir(), `tflex-p35-eb-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);

  // Confirm the window is STILL outside the app bounds at print time.
  const atConfirm = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    return { print: pw.getBounds(), main: main.getBounds() };
  });
  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { timeout: 60000 });
  const success = await printPage.locator('[data-print-success]').innerText();
  const produced = await assertProducedPdf(outPath);
  console.log(`[E-b] at-confirm bounds=${JSON.stringify(atConfirm)}`);
  console.log(`[E-b] success=${JSON.stringify(success)}`);
  console.log(`[E-b] produced=${JSON.stringify(produced)} file=${outPath}`);

  expect(atConfirm.print.x, 'still outside the app window when printing').toBeGreaterThan(atConfirm.main.x + atConfirm.main.width);
  expect(success, 'the moved window saved the file').toContain('Saved to');
  expect(success).toContain(outPath);
  expect(produced.pages, 'produced 2-page PDF from the moved window').toBe(2);

  // Closing the print window leaves the app usable.
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    pw.close();
  });
  await win.waitForTimeout(900);
  const afterClose = await app.evaluate(({ BrowserWindow }) => ({
    printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
    mainAlive: BrowserWindow.getAllWindows().some((w) => !w.webContents.getURL().includes('tfWindow=print')),
  }));
  const usable = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
  console.log(`[E-b] after print-window close=${JSON.stringify(afterClose)} app tabs=${usable}`);
  expect(afterClose.printWindows).toBe(0);
  expect(afterClose.mainAlive).toBe(true);
  expect(usable).toBeGreaterThanOrEqual(1);
});
