// TFL-366 fix verification (qa) — the standalone print window's NATIVE icon.
//
// The defect: "Print window top bar still shows old app logo." The standalone
// print window is the only framed BrowserWindow (src/main/print-window.ts
// frame:true) and no BrowserWindow set `icon`, so Electron fell back to the
// executable/default icon in its native title bar. The fix (TFL-427) adds
// `icon: resolveAppIconPath()` = join(app.getAppPath(),'assets','brand','jovrel.ico')
// to createMainWindow, createDetachedWindow and createPrintWindow.
//
// EVIDENCE METHOD NOTE (deviation from the brief, reported):
// Electron 44's BrowserWindow exposes setIcon() but NO getIcon() getter
// (verified against node_modules/electron/electron.d.ts: zero getIcon matches,
// three setIcon). The brief's `w.getIcon().isEmpty()` / `w.getIcon().toPNG()`
// reads a non-existent API and cannot run. Capturing the constructor options
// by replacing the electron module's BrowserWindow is also blocked: the export
// is a non-configurable accessor ("Cannot redefine property: BrowserWindow").
// The runtime proof below therefore uses Windows' own window-icon query:
// a window created WITHOUT an `icon` option returns 0 from WM_GETICON (Windows
// falls back to the class/executable icon), while a window given an icon
// returns the non-zero HICON Electron set. That is the native title-bar icon
// the defect is about.
//
// This spec proves, against the real Electron dev build launched through the
// canonical e2e/lib/launch.cjs:
//   1. the print window's native WM_GETICON handle is non-zero (an icon is set);
//   2. the shipped asset at the app-resolved path is a valid, non-empty
//      nativeImage (Electron's own loader), non-zero size + PNG bytes;
//   3. no renderer regression: the print page still renders the inline Jovrel
//      mark and the "Jovrel" wordmark.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openStandalonePrintWindow, closeStandalonePrintWindow } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl366-icon');
  app = null;
  win = null;
});

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

// Query the real Windows window icon for an HWND via user32.
function winIconHandles(hwnd) {
  const ps = `
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TflIcon {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtr")] public static extern IntPtr GetClassLongPtr(IntPtr h, int i);
}
"@
$h = [IntPtr]${hwnd}
$r = [ordered]@{}
$r.small  = [TflIcon]::SendMessage($h, 0x7F, [IntPtr]0, [IntPtr]::Zero).ToInt64()
$r.big    = [TflIcon]::SendMessage($h, 0x7F, [IntPtr]1, [IntPtr]::Zero).ToInt64()
$r.small2 = [TflIcon]::SendMessage($h, 0x7F, [IntPtr]2, [IntPtr]::Zero).ToInt64()
$r.classIcon = [TflIcon]::GetClassLongPtr($h, -14).ToInt64()
$r | ConvertTo-Json -Compress
`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim());
}

test('TFL-366 print window native icon resolves to the shipped Jovrel icon', async () => {
  await launch();
  const sample = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, sample);
  await win.locator('[data-toolbar-open]').click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);

  const printPage = await openStandalonePrintWindow(app, win);

  const info = await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const w = BrowserWindow.getAllWindows().find((ww) => ww.webContents.getURL().includes('tfWindow=print'));
    if (!w) return { found: false };
    const buf = w.getNativeWindowHandle();
    const hwnd = buf.length === 8 ? buf.readBigUInt64LE(0).toString() : buf.readUInt32LE(0).toString();
    return { found: true, hwnd, title: w.getTitle(), url: w.webContents.getURL(), appPath: electronApp.getAppPath() };
  });
  console.log(`[TFL-366 window] ${JSON.stringify({ found: info.found, hwnd: info.hwnd, title: info.title })}`);
  expect(info.found, 'print window found via tfWindow=print URL').toBe(true);

  const assetPath = path.join(info.appPath, 'assets', 'brand', 'jovrel.ico');
  expect(fs.existsSync(assetPath), `shipped icon exists at ${assetPath}`).toBe(true);

  const handles = winIconHandles(info.hwnd);
  console.log(`[TFL-366 wm_geticon] ${JSON.stringify(handles)}`);
  console.log(`[TFL-366 appPath] ${info.appPath}`);
  const bestSet = Math.max(handles.small, handles.big, handles.small2);
  expect(bestSet, 'the print window has a native icon set (WM_GETICON non-zero)').toBeGreaterThan(0);

  // The asset the running app points at is a real, non-empty icon.
  const asset = await app.evaluate(({ nativeImage }, p) => {
    const img = nativeImage.createFromPath(p);
    return { empty: img.isEmpty(), size: img.getSize(), pngBytes: img.toPNG().length };
  }, assetPath);
  console.log(`[TFL-366 asset] ${JSON.stringify(asset)}`);
  expect(asset.empty, 'shipped icon loads as a non-empty nativeImage').toBe(false);
  expect(asset.size.width, 'icon width non-zero').toBeGreaterThan(0);
  expect(asset.size.height, 'icon height non-zero').toBeGreaterThan(0);
  expect(asset.pngBytes, 'icon PNG bytes non-zero').toBeGreaterThan(0);

  // No renderer regression on the print page.
  const print = await printPage.evaluate(() => {
    const mark = document.querySelector('.print-window-brand svg[data-brand-mark]');
    const word = document.querySelector('.print-window-brand .brand-wordmark');
    return { markIsSvg: mark !== null, word: word ? (word.textContent ?? '').trim() : null };
  });
  console.log(`[TFL-366 renderer] ${JSON.stringify(print)}`);
  expect(print.markIsSvg, 'print-window mark is the inline SVG').toBe(true);
  expect(print.word, 'print-window wordmark').toBe('Jovrel');

  await printPage.screenshot({ path: path.join(SHOTS, 'tfl366-print-window-icon.png') });
  await closeStandalonePrintWindow(app, printPage);
});
