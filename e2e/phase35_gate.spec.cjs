// Phase 35 gate (qa) — the five success criteria, with raw evidence.
//
// Criterion 1 (window behaviour), 3 (PDF output inside TFlex), 4 (independent
// print window) are driven here. Criterion 2 (PDF handler) is a read-only
// registry/installer report. Criterion 5 (no regressions) is run separately.
// Launches only through the canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette, openStandalonePrintWindow } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const INSTALLED = process.env.TFLEX_PACKAGED_EXE || 'C:\\Program Files\\Jovrel\\Jovrel.exe';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-gate');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Enumerate OS top-level windows (title/class/pid/visible). Read-only probe;
// PowerShell is used only to call EnumWindows, never to launch or drive the app.
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

// ---------------------------------------------------------------------------
// Criterion 1 — standard Windows window behaviour
// ---------------------------------------------------------------------------
test('P35-G1 window behaviour: properties, work-area fit, caption hit-test', async () => {
  const state = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      bounds: w.getBounds(),
      workArea: screen.getPrimaryDisplay().workArea,
      resizable: w.isResizable(),
      maximizable: w.isMaximizable(),
      minimizable: w.isMinimizable(),
      maximized: w.isMaximized(),
      fullScreen: w.isFullScreen(),
      bg: w.getBackgroundColor(),
    };
  });
  console.log(`[P35-G1] window state=${JSON.stringify(state)}`);
  expect(state.resizable).toBe(true);
  expect(state.maximizable).toBe(true);
  expect(state.minimizable).toBe(true);
  // Opaque window (Phase 35 removed transparent: true). getBackgroundColor is
  // the opaque frosted ambient base, never a transparent value.
  console.log(`[P35-G1] getBackgroundColor=${state.bg}`);
  expect(String(state.bg).toLowerCase()).not.toBe('#00000000');
  expect(String(state.bg).toLowerCase()).toContain('eef1f5');
  // Default sizing respects the display work area.
  const wa = state.workArea;
  const b = state.bounds;
  console.log(`[P35-G1] bounds=${JSON.stringify(b)} workArea=${JSON.stringify(wa)}`);
  expect(b.x).toBeGreaterThanOrEqual(wa.x);
  expect(b.y).toBeGreaterThanOrEqual(wa.y);
  expect(b.x + b.width).toBeLessThanOrEqual(wa.x + wa.width);
  expect(b.y + b.height).toBeLessThanOrEqual(wa.y + wa.height);

  // Caption drag-region hit-test across the strip: every sampled point must be
  // either draggable or an interactive control — never a dead non-drag point.
  const hit = await win.evaluate(() => {
    const strip = document.querySelector('.titlebar');
    const r = strip.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const regionOf = (el) => {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cs = getComputedStyle(cur);
        const ar = cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region');
        if (ar && ar !== 'none') return ar;
        cur = cur.parentElement;
      }
      return 'none';
    };
    const isControl = (el) => {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        if (cur.matches && cur.matches("button, input, select, textarea, a, [role='button']")) return true;
        cur = cur.parentElement;
      }
      return false;
    };
    const pts = [];
    for (let i = 0; i <= 40; i += 1) {
      const x = Math.round(r.left + ((r.width - 1) * i) / 40);
      const el = document.elementFromPoint(x, y);
      const region = el ? regionOf(el) : 'none';
      const control = el ? isControl(el) : false;
      const kind = region === 'drag' ? 'drag' : control ? 'control' : 'other';
      pts.push({ x, region, control, kind, hit: el ? (el.className && el.className.toString ? el.className.toString().slice(0, 28) : el.tagName) : null });
    }
    const drag = pts.filter((p) => p.kind === 'drag').length;
    const control = pts.filter((p) => p.kind === 'control').length;
    const other = pts.filter((p) => p.kind === 'other').length;
    return { strip: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, y, pts, drag, control, other, total: pts.length };
  });
  const pct = Math.round((hit.drag / hit.total) * 1000) / 10;
  console.log(`[P35-G1] caption strip=${JSON.stringify(hit.strip)} y=${hit.y} draggable=${hit.drag}/${hit.total} (${pct}%) control=${hit.control} other=${hit.other}`);
  console.log(`[P35-G1] hit-test=${JSON.stringify(hit.pts)}`);
  expect(hit.other).toBe(0);
  expect(pct).toBeGreaterThanOrEqual(50);
});

// ---------------------------------------------------------------------------
// Criterion 2 — PDF handler (read-only registry / installer report)
// ---------------------------------------------------------------------------
test('P35-G2 PDF handler: read-only registry + installer state', async () => {
  const installedExists = fs.existsSync(INSTALLED);
  let version = null;
  if (installedExists) {
    try {
      const { execSync } = require('node:child_process');
      version = execSync(`powershell -NoProfile -Command "(Get-Item -LiteralPath '${INSTALLED}').VersionInfo.FileVersion"`, { encoding: 'utf8' }).trim();
    } catch (_) { /* ignore */ }
  }
  console.log(`[P35-G2] installed exe=${INSTALLED} exists=${installedExists} version=${version}`);

  const regQuery = (key) => {
    try {
      const { execSync } = require('node:child_process');
      return execSync(`reg query "${key}" /s`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      return `NOT FOUND (${String(e.message).split('\n')[0]})`;
    }
  };
  const progId = regQuery('HKCU\\Software\\Classes\\Jovrel.pdf');
  const hkcuPdf = regQuery('HKCU\\Software\\Classes\\.pdf');
  const hkcrPdf = regQuery('HKCR\\.pdf');
  console.log(`[P35-G2] HKCU\\Software\\Classes\\Jovrel.pdf => ${progId}`);
  console.log(`[P35-G2] HKCU\\Software\\Classes\\.pdf => ${hkcuPdf}`);
  console.log(`[P35-G2] HKCR\\.pdf => ${hkcrPdf}`);

  // The config that WILL register the association is present and unit-guarded.
  const yml = fs.readFileSync(path.resolve(__dirname, '..', 'electron-builder.yml'), 'utf8');
  expect(yml).toMatch(/fileAssociations:[\s\S]*?ext:\s*pdf/);
  expect(yml).toMatch(/name:\s*Jovrel\.pdf/);
  console.log('[P35-G2] electron-builder.yml declares the .pdf association (Jovrel.pdf ProgID)');
});
// ---------------------------------------------------------------------------
// Criterion 3 � PDF output produced inside TFlex (item 7)
// ---------------------------------------------------------------------------
test('P35-G3 virtual-PDF destination produces the file inside TFlex, no print window', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35g3-print.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const printPage = await openStandalonePrintWindow(app, win);
  const options = await printPage.$$eval('[data-print-printer] option', (opts) => opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })));
  console.log(`[P35-G3] printers=${JSON.stringify(options)}`);
  const pdfOption = options.find((o) => /pdf/i.test(o.text) || /pdf/i.test(o.value));
  expect(pdfOption).toBeTruthy();
  await printPage.selectOption('[data-print-printer]', pdfOption.value);
  await printPage.waitForTimeout(400);

  // A 2-page landscape selection so the produced file's count + orientation
  // are checkable against the preview.
  await printPage.click('[data-print-range-custom]');
  await printPage.fill('[data-print-range-input]', '1-2');
  await printPage.click('[data-print-orientation-landscape]');
  await printPage.waitForTimeout(500);
  const previewMeta = await printPage.locator('[data-print-preview-meta]').innerText();
  console.log(`[P35-G3] preview meta=${JSON.stringify(previewMeta)}`);

  // Stub the app's own Save-As seam (the native dialog cannot be automated).
  const outPath = path.join(os.tmpdir(), `tflex-p35-g3-${Date.now()}.pdf`);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);

  const mainPid = await app.evaluate(() => process.pid);
  const before = listOsWindows(mainPid);
  console.log(`[P35-G3] OS windows before confirm=${JSON.stringify(before)}`);

  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { timeout: 60000 });
  const success = await printPage.locator('[data-print-success]').innerText();
  console.log(`[P35-G3] success=${JSON.stringify(success)}`);
  await win.waitForTimeout(1500);

  const after = listOsWindows(mainPid);
  console.log(`[P35-G3] OS windows after confirm=${JSON.stringify(after)}`);
  const visiblePrintWindows = after
    .map((line) => { const [pid, vis, cls, ...rest] = line.split('|'); return { pid, vis, cls, title: rest.join('|') }; })
    .filter((w) => w.vis === 'True' && (/electron.*print/i.test(w.title) || w.cls === '#32770'));
  console.log(`[P35-G3] visible Windows/Chromium print windows=${JSON.stringify(visiblePrintWindows)}`);
  expect(visiblePrintWindows).toEqual([]);

  // Inspect the produced file: valid PDF, page count and orientation.
  expect(fs.existsSync(outPath)).toBe(true);
  const bytes = fs.readFileSync(outPath);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  const pageCount = pdf.getPageCount();
  const sizes = pdf.getPages().map((p) => p.getSize());
  console.log(`[P35-G3] produced PDF: bytes=${bytes.length} pages=${pageCount} sizes=${JSON.stringify(sizes)}`);
  expect(pageCount).toBe(2);
  for (const s of sizes) expect(s.width).toBeGreaterThan(s.height);
  console.log(`[P35-G3] produced file=${outPath}`);
});

// ---------------------------------------------------------------------------
// Criterion 4 � the print window can live outside the app window (item 8)
// ---------------------------------------------------------------------------
async function openDetachedPrintWindow() {
  await openFile(app, win, tmpCopy(REPORT, 'p35g4-print.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  // Phase 37 item 17 — the title-bar Print icon opens the standalone window
  // directly (the in-app modal and its detach control were removed).
  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForTimeout(600);
  return printPage;
}

test('P35-G4 standalone print window: own window, print-only UI, movable, lifecycle', async () => {
  const printPage = await openDetachedPrintWindow();

  const info = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    return {
      print: pw ? { id: pw.id, title: pw.getTitle(), url: pw.webContents.getURL().slice(0, 80), bounds: pw.getBounds(), resizable: pw.isResizable(), minimizable: pw.isMinimizable(), maximizable: pw.isMaximizable(), parent: pw.getParentWindow() !== null } : null,
      main: main ? { id: main.id, title: main.getTitle(), bounds: main.getBounds() } : null,
      count: all.length,
    };
  });
  console.log(`[P35-G4] windows=${JSON.stringify(info)}`);
  expect(info.print).not.toBeNull();
  expect(info.print.parent).toBe(false);
  expect(info.print.resizable).toBe(true);
  expect(info.print.minimizable).toBe(true);
  expect(info.print.maximizable).toBe(true);

  // Renders ONLY the print UI: no app chrome / tabs.
  const chrome = await printPage.evaluate(() => ({
    printWindow: !!document.querySelector('[data-print-window]'),
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    toolbar: document.querySelectorAll('.action-dock').length,
    titlebar: document.querySelectorAll('.titlebar').length,
    app: document.querySelectorAll('.app').length,
    printer: !!document.querySelector('[data-print-printer]'),
    preview: !!document.querySelector('[data-print-preview]'),
    docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
  }));
  console.log(`[P35-G4] print window DOM=${JSON.stringify(chrome)}`);
  expect(chrome.printWindow).toBe(true);
  expect(chrome.tabs).toBe(0);
  expect(chrome.toolbar).toBe(0);
  expect(chrome.titlebar).toBe(0);
  expect(chrome.app).toBe(0);
  expect(chrome.printer).toBe(true);
  expect(chrome.preview).toBe(true);

  await printPage.screenshot({ path: path.join(SHOTS, 'phase35-print-window.png') });

  // Move it OUTSIDE the app window's bounds.
  const moved = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    const mb = main.getBounds();
    pw.setBounds({ x: mb.x + mb.width + 200, y: mb.y + 120, width: 820, height: 860 });
    return { print: pw.getBounds(), main: mb };
  });
  console.log(`[P35-G4] moved bounds=${JSON.stringify(moved)}`);
  expect(moved.print.x).toBeGreaterThan(moved.main.x + moved.main.width);

  // Closing the print window leaves the app usable.
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    pw.close();
  });
  await win.waitForTimeout(800);
  const afterClose = await app.evaluate(({ BrowserWindow }) => ({
    printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
    mainAlive: BrowserWindow.getAllWindows().some((w) => !w.webContents.getURL().includes('tfWindow=print')),
  }));
  console.log(`[P35-G4] after print-window close=${JSON.stringify(afterClose)}`);
  expect(afterClose.printWindows).toBe(0);
  expect(afterClose.mainAlive).toBe(true);
  // The app is still usable: the main window still answers.
  const usable = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
  console.log(`[P35-G4] app tabs after close=${usable}`);
  expect(usable).toBeGreaterThanOrEqual(1);
});

test('P35-G4-title standalone print window OS title is "Print - Jovrel"', async () => {
  await openDetachedPrintWindow();
  const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
    id: w.id,
    title: w.getTitle(),
    isPrint: w.webContents.getURL().includes('tfWindow=print'),
  })));
  console.log(`[P35-G4-title] window titles=${JSON.stringify(titles)}`);
  const printWin = titles.find((t) => t.isPrint);
  expect(printWin).toBeTruthy();
  expect(printWin.title).toBe('Print - Jovrel');
});

test('P35-G4b app closing closes the print window', async () => {
  const printPage = await openDetachedPrintWindow();
  const printId = await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return pw ? pw.id : null;
  });
  console.log(`[P35-G4b] print window id=${printId}`);
  expect(printId).not.toBeNull();
  // Close the MAIN window (the document is unmodified, so no close prompt).
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    main.close();
  });
  // The main page is gone; wait on the Node side, then check the print page.
  await new Promise((r) => setTimeout(r, 2500));
  const closed = printPage.isClosed();
  console.log(`[P35-G4b] print page closed=${closed}`);
  expect(closed).toBe(true);
});

test('P35-G4c document-gone path disables the print action', async () => {
  const printPage = await openDetachedPrintWindow();
  // Phase 37 item 17 — the print window is a separate OS window, so it never
  // blocks the app; the document tab is directly closable.
  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(1500);
  const gone = await printPage.evaluate(() => ({
    banner: !!document.querySelector('[data-print-document-gone]'),
    confirmDisabled: (() => { const b = document.querySelector('[data-print-confirm]'); return b ? b.disabled : null; })(),
  }));
  console.log(`[P35-G4c] document-gone state=${JSON.stringify(gone)}`);
  expect(gone.banner).toBe(true);
  expect(gone.confirmDisabled).toBe(true);
});

// ---------------------------------------------------------------------------
// Required screenshots: single mode (opaque window + top-bar glass) and
// Multi Mode (no duplicate header, flatter strip).
// ---------------------------------------------------------------------------
test('P35-shots single mode and Multi Mode strip', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35shot-alpha.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(SHOTS, 'phase35-single-mode.png') });

  await openFile(app, win, tmpCopy(REPORT, 'p35shot-beta.pdf'));
  await win.waitForTimeout(1200);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p35shot-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p35shot-beta' }).first().click();
  await win.waitForTimeout(1800);
  await win.screenshot({ path: path.join(SHOTS, 'phase35-multi-strip.png') });
});
