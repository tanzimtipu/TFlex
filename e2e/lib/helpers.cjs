// Shared driving helpers for the v1.7.11 deep sweep. Canonical under e2e/lib.
// Only qa writes here. launchDev() (dev build) is the DEFAULT for every
// standard/regression/sweep spec; launchInstalled() is ONLY for specs under
// e2e/installed/, when the orchestrator explicitly asks for installed-app runs.

const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./launch.cjs');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'tflex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

// Bound window so `shot(name)` works without threading `win` through every call.
let currentWin = null;

// DEV build launch - the standard for the whole e2e suite. Never pass an
// executablePath from a spec; the installed app is launched only from
// e2e/installed/* specs via launchInstalled().
async function launchDev(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, null);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  currentWin = window;
  return { electronApp, window };
}

// INSTALLED-app launch. e2e/installed/* ONLY - never from a standard spec.
async function launchInstalled(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, INSTALLED);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  currentWin = window;
  return { electronApp, window };
}

async function openSample(window, electronApp, name) {
  const samplePath = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
  return samplePath;
}

async function openSamplePath(window, electronApp, absolutePath) {
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absolutePath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
}

async function diag(window) {
  return window.evaluate(() => window.tflexDiagnostics());
}

// Step-scroll the (virtualized) document scroller until the requested page-slot
// is mounted, then nudge it near the top of the viewport so pointer gestures on
// it land on the page, not on the toolbar / window chrome.
async function scrollToPage(window, n) {
  for (let i = 0; i < 50; i += 1) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1200;
      return false;
    }, n);
    await window.waitForTimeout(250);
    if (done) break;
  }
  await window.waitForTimeout(900);
}

async function shot(windowOrName, name) {
  // Support both shot(win, 'name.png') and shot('name.png') (uses currentWin).
  const w = (name === undefined) ? currentWin : windowOrName;
  const n = (name === undefined) ? windowOrName : name;
  const p = path.join(SHOTS, n);
  await w.screenshot({ path: p });
  return p;
}

// Sample the page-1 canvas's pixels inside a PAGE-RELATIVE css rect
// { x, y, w, h } (css px measured from the .pdf-page[data-page="1"]
// element's top-left). Returns the dominant rgb colors with counts and the
// dark-glyph pixel count. Used by the DEF-173/174 reopen specs to prove the
// canvas-rendered annotation color (pale translucent wash vs full-opacity
// block) without trusting screenshots alone.
async function sampleCanvasPageRect(window, relRect, pageNo = 1) {
  return window.evaluate(({ rel, want }) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${want}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!page || !canvas) return null;
    const pb = page.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const sx = canvas.width / cb.width;
    const sy = canvas.height / cb.height;
    const x0 = Math.max(0, Math.round((rel.x + (pb.left - cb.left)) * sx));
    const y0 = Math.max(0, Math.round((rel.y + (pb.top - cb.top)) * sy));
    const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rel.w * sx)));
    const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rel.h * sy)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(x0, y0, w, h);
    const counts = {};
    let darkGlyphs = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const key = `${r},${g},${b}`;
      counts[key] = (counts[key] || 0) + 1;
      if (r < 100 && g < 100 && b < 100) darkGlyphs += 1;
    }
    const topColors = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([rgb, n]) => {
        const [r, g, b] = rgb.split(',').map(Number);
        return { rgb: [r, g, b], n };
      });
    return { bboxCanvasPx: [x0, y0, w, h], topColors, darkGlyphs };
  }, { rel: relRect, want: pageNo });
}

// Dump key engine-state pieces for diagnosis.
async function dumpEngine(window, label) {
  const out = await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    const res = {
      pageCount: d.pageCount,
      currentPage: d.currentPage,
      modified: d.modified,
      tabModified: d.tabModified,
      canUndo: d.canUndo,
      canRedo: d.canRedo,
      activeTool: d.activeTool,
      theme: d.theme,
      annotations: e.annotations || [],
      pageOrder: e.pageOrder && e.pageOrder.slice(0, 12),
      rotations: e.rotations && e.rotations.slice(0, 12),
      pageOrderLen: e.pageOrder ? e.pageOrder.length : null,
    };
    return res;
  });
  console.log(`[${label}] ${JSON.stringify(out)}`);
  return out;
}

// Force-destroy the window(s) so the DEF-142 close gate (which would prompt on
// a modified doc and hang electronApp.close) cannot block teardown. Only qa
// may edit this helper.
async function hardClose(electronApp) {
  if (!electronApp) return;
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) { /* ignore */ } });
  }).catch(() => {});
  await electronApp.close().catch(() => {});
}

module.exports = { launchDev, launchInstalled, openSample, openSamplePath, diag, shot, dumpEngine, getSamplePath, scrollToPage, sampleCanvasPageRect, hardClose };
