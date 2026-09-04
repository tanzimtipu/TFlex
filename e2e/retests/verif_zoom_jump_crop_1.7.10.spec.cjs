// QA verification — post-crop zoom-jump fix (v1.7.10, installed app).
//
// The defect: when page 1 of a multi-page doc is cropped, the fit-to-page /
// fit-to-width scale used to be recomputed from the cropped (smaller) page-1
// size (because `firstPageSize` is re-fetched from the fresh proxy after
// `refreshDocProxyFor` swaps the doc), so every OTHER uncropped page rendered
// at a bigger absolute pixel size — a visible zoom jump after every crop, and
// the reverse jump on crop undo.
//
// The fix (src/renderer/components/DocumentView.tsx, `fitAnchor` split):
//   - `firstPageSize` stays LIVE (slots / rail / wrappers track the new bytes);
//   - `fitAnchor` (what fit-width / fit-page scale against) only moves on first
//     resolution, an explicit user fit action, or a refresh whose page-1 size is
//     NOT an inset of the anchor (genuine page identity change).
//   - an explicit fit-width / fit-page button click re-anchors to the LIVE
//     (post-crop) page-1 size, restoring "fit now to the current page".
//
// Launch only via e2e/lib/launch.cjs against the packaged installed exe. Never a
// .cmd/.ps1 shim; never a hand-concatenated file:// URL.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(600);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

test.setTimeout(300000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openSample(name) {
  const card = win.locator(`.sample-card:has-text("${name}")`);
  if (await card.count()) {
    await card.click();
  } else {
    const p = path.resolve(__dirname, '..', '..', 'assets', 'samples', name);
    await electronApp.evaluate(async ({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, p);
    await win.click('button:has-text("Open PDF")');
  }
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(1500);
}

async function openTools() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(300);
}

async function openPaletteTool(toolId) {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) await openTools();
  await win.click(`[data-tool-id="${toolId}"]`);
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
}

// Measure the main page canvases keyed by data-page (the page-slot wrapper,
// which is rendered for the virtualized page window).
async function measurePages() {
  return win.evaluate(() => {
    const out = {};
    document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
      const c = p.querySelector('canvas');
      const n = Number(p.getAttribute('data-page'));
      if (!c) { out[n] = null; return; }
      const r = c.getBoundingClientRect();
      out[n] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  });
}

// The scroller's content width; the fit scale anchors to (clientWidth - 2*pad).
async function scrollerWidth() {
  return win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    return sc ? sc.clientWidth : null;
  });
}

// Scroll the document scroller so pages 1..3 (the measurement window) render.
async function scrollToRevealPages(pages) {
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    if (!sc) return;
    const band = want - 2 < 1 ? 1 : want - 2;
    sc.scrollTop = 1500 * band;
  }, pages);
  await win.waitForTimeout(800);
}

// Apply a per-page crop to page 1 by dragging the SE handle inward.
async function cropPage1(dragPx) {
  await openPaletteTool('cropPages');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);
  const se = win.locator('[data-crop-handle="se"]');
  await se.waitFor({ timeout: 10000 });
  const sb = await se.boundingBox();
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.down();
  await win.mouse.move(sb.x + sb.width / 2 - dragPx, sb.y + sb.height / 2 - dragPx, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2200);
}

const FULL_ASPECT = 612 / 792; // 0.7727 — every report.pdf page before any crop

// ---------------------------------------------------------------------------
// 1) fit-width: crop page 1 keeps uncropped pages at their render size;
//    undo shows no reverse jump
// ---------------------------------------------------------------------------
test('fit-width: crop page 1 does NOT jump the zoom of uncropped pages; undo has no reverse jump', async () => {
  await openSample('report.pdf');

  // Ensure fit-width mode (deterministic start).
  await win.click('button[title="Fit width"]');
  await win.waitForTimeout(500);
  let d = await diag();
  expect(d.mode, 'the app must be in fit-width mode').toBe('fit-width');
  console.log(`[ZOOMJMP] mode=${d.mode} zoom=${d.zoom}`);

  await scrollToRevealPages(1);
  const wBefore = await scrollerWidth();
  const before = await measurePages();
  const b1 = before[1]; const b2 = before[2]; const b3 = before[3];
  expect(b1 && b2 && b3, 'pages 1-3 must be measurable before the crop').toBeTruthy();
  console.log(`[ZOOMJMP] before crop scrollerW=${wBefore} pages=${JSON.stringify(before)}`);

  // Crop page 1 (per-page).
  await cropPage1(40);

  // The toast must confirm exactly one cropped page.
  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : null;
  });
  console.log(`[ZOOMJMP] toast="${toast}"`);
  expect(String(toast).toLowerCase(), 'the toast must report exactly one cropped page').toContain('cropped 1 page');

  await scrollToRevealPages(1);
  const wAfter = await scrollerWidth();
  const after = await measurePages();
  const a1 = after[1]; const a2 = after[2]; const a3 = after[3];
  console.log(`[ZOOMJMP] after crop scrollerW=${wAfter} pages=${JSON.stringify(after)}`);
  // The scroller must be the same size across the crop so the scale comparison
  // is apples-to-apples (a modal overlay must not reflow the document area).
  expect(Math.abs(wAfter - wBefore), 'the document scroller width must be stable across the crop').toBeLessThanOrEqual(2);

  // THE FIX: uncropped pages 2 and 3 keep their previous absolute px.
  expect(Math.abs(a2.w - b2.w), 'page 2 width must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a2.h - b2.h), 'page 2 height must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.w - b3.w), 'page 3 width must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.h - b3.h), 'page 3 height must NOT jump after the crop').toBeLessThanOrEqual(3);
  // Pages 2/3 keep the full-page aspect (uncropped).
  expect(Math.abs(a2.w / a2.h - FULL_ASPECT), 'page 2 must stay full-aspect (uncropped)').toBeLessThan(0.01);
  expect(Math.abs(a3.w / a3.h - FULL_ASPECT), 'page 3 must stay full-aspect (uncropped)').toBeLessThan(0.01);
  // Page 1 must have been cropped (renders narrower than before).
  expect(a1.w, 'page 1 must render narrower after the crop').toBeLessThan(b1.w);
  await shot('verif-zoom-jump-fit-width-after-crop.png');

  // Undo the crop -> page 1 restores to full size AND no reverse jump.
  await win.click('[aria-label="Undo last change"]');
  await win.waitForTimeout(1800);
  await scrollToRevealPages(1);
  const undoPages = await measurePages();
  const u1 = undoPages[1]; const u2 = undoPages[2]; const u3 = undoPages[3];
  console.log(`[ZOOMJMP] after undo pages=${JSON.stringify(undoPages)}`);
  expect(Math.abs(u2.w - b2.w), 'page 2 width must NOT jump on undo').toBeLessThanOrEqual(3);
  expect(Math.abs(u3.w - b3.w), 'page 3 width must NOT jump on undo').toBeLessThanOrEqual(3);
  expect(Math.abs(u1.w - b1.w), 'page 1 must restore to its full render width on undo').toBeLessThanOrEqual(3);
  expect(Math.abs(u1.h - b1.h), 'page 1 must restore to its full render height on undo').toBeLessThanOrEqual(3);
  await shot('verif-zoom-jump-fit-width-after-undo.png');

  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request/.test(m));
  expect(hooks, 'no React hook / page-request errors across crop + undo').toHaveLength(0);
  console.log('[ZOOMJMP] fit-width crop/undo: PASS');
});

// ---------------------------------------------------------------------------
// 2) fit-page: crop page 1 keeps uncropped pages at their render size
// ---------------------------------------------------------------------------
test('fit-page: crop page 1 does NOT jump the zoom of uncropped pages', async () => {
  await openSample('report.pdf');
  await win.click('button[title="Fit page"]');
  await win.waitForTimeout(500);
  let d = await diag();
  expect(d.mode, 'the app must be in fit-page mode').toBe('fit-page');
  console.log(`[ZOOMJMP] mode=${d.mode} zoom=${d.zoom}`);

  await scrollToRevealPages(1);
  const before = await measurePages();
  const b2 = before[2]; const b3 = before[3];
  expect(b2 && b3, 'pages 2-3 must be measurable before the crop').toBeTruthy();
  console.log(`[ZOOMJMP] fit-page before crop pages=${JSON.stringify(before)}`);

  await cropPage1(40);
  await scrollToRevealPages(1);
  const after = await measurePages();
  const a2 = after[2]; const a3 = after[3];
  console.log(`[ZOOMJMP] fit-page after crop pages=${JSON.stringify(after)}`);

  expect(Math.abs(a2.w - b2.w), 'fit-page: page 2 width must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a2.h - b2.h), 'fit-page: page 2 height must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.w - b3.w), 'fit-page: page 3 width must NOT jump after the crop').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.h - b3.h), 'fit-page: page 3 height must NOT jump after the crop').toBeLessThanOrEqual(3);
  await shot('verif-zoom-jump-fit-page-after-crop.png');

  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request/.test(m));
  expect(hooks, 'no React hook / page-request errors (fit-page crop)').toHaveLength(0);
  console.log('[ZOOMJMP] fit-page crop: PASS');
});

// ---------------------------------------------------------------------------
// 3) explicit fit-width click AFTER a crop re-fits to the current (cropped)
//    page 1.
// ---------------------------------------------------------------------------
test('fit-width: an explicit fit-width click after a crop re-fits to the current page', async () => {
  await openSample('report.pdf');
  await win.click('button[title="Fit width"]');
  await win.waitForTimeout(500);

  await scrollToRevealPages(1);
  const before = await measurePages();
  const b1 = before[1]; const b2 = before[2];
  console.log(`[ZOOMJMP] pre-fitclick pages=${JSON.stringify(before)}`);

  await cropPage1(40);
  await scrollToRevealPages(1);
  const afterCrop = await measurePages();
  const p1AfterCrop = afterCrop[1]; const p2AfterCrop = afterCrop[2];
  const zoomAfterCrop = (await diag()).zoom;
  console.log(`[ZOOMJMP] after crop pages=${JSON.stringify(afterCrop)} zoom=${zoomAfterCrop}`);

  // Explicit fit-width -> must re-anchor to the live (post-crop) page-1 width.
  await win.click('button[title="Fit width"]');
  await win.waitForTimeout(1200);
  await scrollToRevealPages(1);
  const afterFit = await measurePages();
  const p1AfterFit = afterFit[1]; const p2AfterFit = afterFit[2];
  const zoomAfterFit = (await diag()).zoom;
  const availW = (await scrollerWidth()) - 56; // CONTENT_PADDING_PX * 2
  console.log(`[ZOOMJMP] after explicit fit-width pages=${JSON.stringify(afterFit)} zoom=${zoomAfterFit} availW=${availW}`);
  // Page 1 (the cropped page) now fills the available content width.
  expect(Math.abs(p1AfterFit.w - availW), 'page 1 must re-fit to the available content width').toBeLessThanOrEqual(6);
  // And it grew relative to just-after-crop (the anchor moved to the smaller page-1).
  expect(p1AfterFit.w, 'page 1 must be wider after the explicit fit-width click').toBeGreaterThan(p1AfterCrop.w + 20);
  // The explicit re-fit legitimately re-scales the other pages (this is the
  // intentional "fit now" behaviour), so p2 changed scale — record it but do
  // NOT require equality here; the decisive no-jump assertion is test 1.
  console.log(`[ZOOMJMP] p2 after-crop=${p2AfterCrop.w} p2 after-fit=${p2AfterFit.w}`);
  await shot('verif-zoom-jump-fit-width-explicit-refit.png');
  console.log('[ZOOMJMP] explicit fit-width re-fit: PASS');
});

// ---------------------------------------------------------------------------
// 4) manual zoom stays EXACT across a crop
// ---------------------------------------------------------------------------
test('manual zoom stays exact across a crop', async () => {
  await openSample('report.pdf');

  // Switch to manual zoom by stepping down the ladder (Zoom out x2).
  await win.click('button[title="Zoom out"]');
  await win.waitForTimeout(250);
  await win.click('button[title="Zoom out"]');
  await win.waitForTimeout(500);
  let d = await diag();
  expect(d.mode, 'the app must be in manual mode after zooming out').toBe('manual');
  const manualZoom = d.zoom;
  console.log(`[ZOOMJMP] manual zoom=${manualZoom} mode=${d.mode}`);

  await scrollToRevealPages(1);
  const before = await measurePages();
  const b2 = before[2]; const b3 = before[3];
  console.log(`[ZOOMJMP] manual before crop pages=${JSON.stringify(before)}`);

  await cropPage1(40);
  await scrollToRevealPages(1);
  const after = await measurePages();
  const a2 = after[2]; const a3 = after[3];
  d = await diag();
  console.log(`[ZOOMJMP] manual after crop pages=${JSON.stringify(after)} zoom=${d.zoom} mode=${d.mode}`);

  expect(d.mode, 'mode must stay manual across the crop').toBe('manual');
  expect(d.zoom, 'manual zoom must stay exact across the crop').toBeCloseTo(manualZoom, 2);
  expect(Math.abs(a2.w - b2.w), 'page 2 width must not change under manual zoom').toBeLessThanOrEqual(3);
  expect(Math.abs(a2.h - b2.h), 'page 2 height must not change under manual zoom').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.w - b3.w), 'page 3 width must not change under manual zoom').toBeLessThanOrEqual(3);
  expect(Math.abs(a3.h - b3.h), 'page 3 height must not change under manual zoom').toBeLessThanOrEqual(3);
  await shot('verif-zoom-jump-manual-crop.png');

  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request/.test(m));
  expect(hooks, 'no React hook / page-request errors (manual crop)').toHaveLength(0);
  console.log('[ZOOMJMP] manual zoom across crop: PASS');
});
