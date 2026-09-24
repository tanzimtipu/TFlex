// DEF-210 retest (qa). The Pen tool (freehand ink) threw an engine-error toast
// on every stroke because normalizeAnnotationPayload had no branch for
// points-only ink payloads. backend-dev's fix:
//   1. derives /Rect from the points' min/max extent when a payload has
//      `points` but no rect/rects/at/from/to,
//   2. rejects unknown kinds at create time via an ANN_KINDS allowlist.
// This spec re-runs the original repro end to end on the rebuilt dev bundle:
// arm Pen, draw one stroke, no engine-error toast, stroke commits + renders,
// annotations panel row appears, diagnostics show the ink annotation, disarm
// (Escape AND clicking another tool) keeps the line, and a Save As -> close ->
// reopen round-trip preserves the ink (verified by pdf-lib re-parse of the
// saved file, /Rect == InkList extent, which is exactly what the fix derives).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFDict, PDFNumber } = require('pdf-lib');
const { launchDev, diag, getSamplePath, hardClose, armAnnotationTool, openAnnotationFlyout, gotoStage } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) });

let electronApp = null;
let win = null;
let pageErrors = [];
const toastsSeen = []; // { cls, text } captured at checkpoints across the run

test.beforeEach(async () => {
  pageErrors = [];
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(240000);

async function launch() {
  ({ electronApp, window: win } = await launchDev());
  win.on('pageerror', (e) => {
    const m = e && e.message ? e.message : String(e);
    pageErrors.push(m);
    process.stdout.write(`[DEF210-PAGEERROR] ${m}\n`);
  });
}

async function openDoc(sample, waitMs = 2200) {
  const p = getSamplePath(sample);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
  return p;
}

async function collectToasts(label) {
  const seen = await win.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => ({
      cls: t.className,
      text: (t.textContent || '').trim(),
    })),
  );
  seen.forEach((t) => {
    if (!toastsSeen.some((x) => x.text === t.text && x.cls === t.cls)) toastsSeen.push(t);
  });
  console.log(`[DEF210] toasts at ${label}: ${JSON.stringify(seen)}`);
  return seen;
}

function toastErrors(seen) {
  return seen.filter(
    (t) => /toast-error/.test(t.cls) || /annotation requires|engine.error|requires at least one rect/i.test(t.text),
  );
}

async function slotBox(page = 1) {
  return win.evaluate((want) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const slot = pane && pane.querySelector(`.page-slot[data-page="${want}"]`);
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, page);
}

async function committedInk() {
  return win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const slot = pane && pane.querySelector('.page-slot[data-page="1"]');
    const els = slot ? [...slot.querySelectorAll('.ann-ink.ann-content')] : [];
    return els.map((g) => {
      const visible = g.querySelector('path:not(.ann-ink-hit)');
      return {
        id: g.getAttribute('data-annotation-id'),
        d: (visible && visible.getAttribute('d')) || null,
        stroke: (visible && visible.getAttribute('stroke')) || null,
        strokeWidth: (visible && visible.getAttribute('stroke-width')) || null,
      };
    });
  });
}

// ---- the retest ------------------------------------------------------------
test('DEF-210 retest: pen stroke commits, disarms, and survives save/reopen', async () => {
  await launch();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Step 2: open report.pdf.
  const srcPath = await openDoc('report.pdf');
  const d0 = await diag(win);
  console.log(`[DEF210] opened report.pdf pageCount=${d0.pageCount} engineAnns=${(d0.engineState.annotations || []).length}`);
  expect(await slotBox(1), 'page slot 1 mounted').not.toBeNull();

  // Step 3: arm the Pen tool. The retest names it "the Pen icon, labeled Pen".
  // Phase 36 — the toolbar lives in the REVIEW Annotate flyout; the Pen may sit
  // in the visible five or in the toolbar's own dropdown.
  await openAnnotationFlyout(win);
  let penBtn = win.locator('[data-ann-tools-visible] button[data-tool="ink"]');
  let penInDropdown = false;
  if ((await penBtn.count()) === 0) {
    penInDropdown = true;
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    penBtn = win.locator('[data-ann-dropdown-menu] button[data-tool="ink"]');
  }
  await expect(penBtn).toBeVisible();
  expect(await penBtn.getAttribute('aria-label'), 'Pen button label').toBe('Pen');
  console.log(`[DEF210] Pen located in ${penInDropdown ? 'dropdown' : 'visible five'}`);
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(400);
  const d1 = await diag(win);
  console.log(`[DEF210] pen armed: activeTool=${d1.activeTool}`);
  expect(d1.activeTool, 'pen armed').toBe('ink');
  await shot(win, 'def-210-pen-armed.png');

  // Step 4: draw a short stroke on page 1 and release.
  const box = await slotBox(1);
  await win.mouse.move(box.x + box.w * 0.35, box.y + box.h * 0.3);
  await win.mouse.down();
  await win.mouse.move(box.x + box.w * 0.55, box.y + box.h * 0.42, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(700);

  // Step 5a: no engine-error toast appears.
  const t1 = await collectToasts('after stroke');
  expect(toastErrors(t1), 'no engine-error toast after the stroke').toHaveLength(0);

  // Step 5b: the stroke commits and renders as an ink line on the page.
  const d2 = await diag(win);
  const anns = (d2.engineState.annotations || []);
  const inkAnns = anns.filter((a) => a.kind === 'ink');
  console.log(`[DEF210] engine annotations after stroke: ${JSON.stringify(anns.map((a) => ({ id: a.id, kind: a.kind, page: a.page, width: a.width, rects: a.rects, points: (a.points || []).length })))}`);
  expect(inkAnns, 'exactly one ink annotation committed').toHaveLength(1);
  const ink = inkAnns[0];
  expect(ink.page, 'ink annotation on page 1').toBe(1);
  expect((ink.points || []).length, 'ink stroke has >= 2 points').toBeGreaterThanOrEqual(2);

  // The fix's core promise: /Rect (rects[0]) is derived from the points' extent.
  const xs = ink.points.map((p) => p.x);
  const ys = ink.points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const r = (ink.rects || [])[0];
  expect(r, 'ink annotation has a derived rects[0]').toBeTruthy();
  console.log(`[DEF210] points extent=(${minX.toFixed(2)},${minY.toFixed(2)})..(${maxX.toFixed(2)},${maxY.toFixed(2)}) rects[0]=${JSON.stringify(r)}`);
  expect(Math.abs(r.x - minX)).toBeLessThan(0.5);
  expect(Math.abs(r.y - minY)).toBeLessThan(0.5);
  expect(Math.abs(r.width - (maxX - minX))).toBeLessThan(0.5);
  expect(Math.abs(r.height - (maxY - minY))).toBeLessThan(0.5);

  const strokes = await committedInk();
  console.log(`[DEF210] committed overlay strokes: ${JSON.stringify(strokes)}`);
  expect(strokes, 'committed ink renders in the page overlay').toHaveLength(1);
  expect(strokes[0].d, 'ink path has geometry').toBeTruthy();
  expect(strokes[0].stroke, 'ink path has a real stroke color').toBeTruthy();
  const inkBox = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const g = pane && pane.querySelector('.page-slot[data-page="1"] .ann-ink.ann-content');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, opacity: getComputedStyle(g).opacity };
  });
  expect(inkBox && inkBox.w > 5 && inkBox.h > 5, 'committed ink paints with a real on-page size').toBe(true);
  await shot(win, 'def-210-stroke-committed.png');

  // Step 5c: the annotation appears in the annotations panel. Phase 36 — the
  // annotations list lives in the REVIEW ContextPanel (the legacy rail tab is
  // retired).
  await gotoStage(win, 3);
  await win.waitForSelector('[data-context-panel="review"] [data-annotation-panel]', { timeout: 8000 });
  const row = win.locator('[data-context-panel="review"] .ann-panel-row').first();
  await expect(row).toBeVisible();
  const rowKind = (await row.locator('.ann-panel-row-kind').textContent() || '').trim();
  const rowPage = (await row.locator('.ann-panel-row-page').textContent() || '').trim();
  console.log(`[DEF210] panel row: kind="${rowKind}" page="${rowPage}"`);
  expect(rowKind, 'panel row kind is the ink label').toBe('Pen stroke');
  expect(rowPage, 'panel row page').toBe('Page 1');
  await shot(win, 'def-210-annotations-panel.png');

  // Step 5d: window.tflexDiagnostics() shows the ink annotation in the state.
  const dDiag = await win.evaluate(() => window.tflexDiagnostics());
  const diagInk = (dDiag.engineState.annotations || []).filter((a) => a.kind === 'ink');
  expect(diagInk, 'tflexDiagnostics() exposes the ink annotation').toHaveLength(1);
  console.log(`[DEF210] diagnostics ink: id=${diagInk[0].id} points=${diagInk[0].points.length} rect=${JSON.stringify(diagInk[0].rects[0])} width=${diagInk[0].width}`);

  // Step 6: disarm via Escape - the tool disarms, the ink line stays visible.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(450);
  const dEsc = await diag(win);
  console.log(`[DEF210] after Escape: activeTool=${dEsc.activeTool}`);
  expect(dEsc.activeTool, 'pen disarmed by Escape').not.toBe('ink');
  expect((await committedInk()), 'ink line stays visible after Escape disarm').toHaveLength(1);
  await shot(win, 'def-210-disarm-escape.png');

  // Step 6b: disarm via clicking another tool - ink line still visible.
  await armAnnotationTool(win, 'highlight');
  await win.waitForTimeout(400);
  const dHl = await diag(win);
  console.log(`[DEF210] after clicking Highlight: activeTool=${dHl.activeTool}`);
  expect(dHl.activeTool, 'highlight armed (pen disarmed by tool switch)').toBe('highlight');
  expect((await committedInk()), 'ink line stays visible after tool switch').toHaveLength(1);
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(300);

  // Step 7: save round-trip. Save As -> close tab -> reopen the saved file.
  const savePath = path.join(os.tmpdir(), `def210-pen-retest-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await shot(win, 'def-210-save-as-dialog.png');
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  await win.waitForTimeout(800);
  expect(fs.existsSync(savePath), 'saved file exists on disk').toBe(true);
  const savedSize = fs.statSync(savePath).size;
  console.log(`[DEF210] saved-as ${savePath} (${savedSize} bytes)`);

  // Re-parse the saved file with pdf-lib: a real /Ink annotation must exist,
  // with /InkList points and a /Rect that equals the InkList min/max extent
  // (the exact derivation the fix added).
  const savedBytes = fs.readFileSync(savePath);
  const savedDoc = await PDFDocument.load(savedBytes);
  const page0 = savedDoc.getPage(0);
  const annots = page0.node.Annots();
  expect(annots, 'saved page 0 has an /Annots array').toBeTruthy();
  const parsed = [];
  for (let i = 0; i < annots.size(); i += 1) {
    const dict = annots.lookup(i, PDFDict);
    const subtype = dict.get(PDFName.of('Subtype'));
    const rect = dict.get(PDFName.of('Rect'));
    const inkList = dict.get(PDFName.of('InkList'));
    const rectVals = rect ? [0, 1, 2, 3].map((k) => rect.lookup(k, PDFNumber).asNumber()) : null;
    const inkPts = [];
    if (inkList) {
      for (let s = 0; s < inkList.size(); s += 1) {
        const stroke = inkList.lookup(s);
        for (let k = 0; k + 1 < stroke.size(); k += 2) {
          inkPts.push([stroke.lookup(k, PDFNumber).asNumber(), stroke.lookup(k + 1, PDFNumber).asNumber()]);
        }
      }
    }
    // The fix's promise: /Rect (corner pairs, PDF bottom-left space) equals the
    // InkList points' min/max extent.
    let rectMatchesExtent = null;
    if (rectVals && inkPts.length > 0) {
      const px = inkPts.map((p) => p[0]);
      const py = inkPts.map((p) => p[1]);
      const e = [Math.min(...px), Math.min(...py), Math.max(...px), Math.max(...py)];
      rectMatchesExtent = rectVals.every((v, k) => Math.abs(v - e[k]) < 0.05);
    }
    parsed.push({
      subtype: subtype && subtype.toString(),
      rect: rectVals,
      inkPoints: inkPts.length,
      rectMatchesInkListExtent: rectMatchesExtent,
    });
  }
  console.log(`[DEF210] pdf-lib re-parse of saved file: ${JSON.stringify(parsed)}`);
  const inkAnnots = parsed.filter((a) => a.subtype === '/Ink');
  expect(inkAnnots, 'saved PDF contains exactly one /Ink annotation').toHaveLength(1);
  expect(inkAnnots[0].inkPoints, '/InkList carries the stroke points').toBeGreaterThanOrEqual(2);
  expect(Array.isArray(inkAnnots[0].rect), '/Rect present').toBe(true);
  expect(inkAnnots[0].rectMatchesInkListExtent, '/Rect equals the InkList min/max extent (the fix)').toBe(true);

  // Close the tab and reopen the saved file in the app.
  await win.locator('.tab-active .tab-close').click();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.keyboard.press('Control+o');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2200);

  const dRe = await diag(win);
  const reAnns = (dRe.engineState.annotations || []).filter((a) => a.kind === 'ink');
  console.log(`[DEF210] reopened: engineAnns=${(dRe.engineState.annotations || []).length} ink=${reAnns.length} points=${reAnns[0] ? reAnns[0].points.length : 0}`);
  expect(reAnns, 'ink annotation survives close + reopen').toHaveLength(1);
  expect(reAnns[0].page, 'reopened ink annotation on page 1').toBe(1);
  expect(reAnns[0].points.length, 'reopened ink stroke point count preserved').toBe(ink.points.length);
  const reStrokes = await committedInk();
  expect(reStrokes, 'reopened ink renders in the page overlay').toHaveLength(1);
  const tRe = await collectToasts('after reopen');
  expect(toastErrors(tRe), 'no error toast after reopen').toHaveLength(0);
  await shot(win, 'def-210-reopened.png');

  // No renderer pageerrors anywhere in the run.
  expect(pageErrors, 'no renderer pageerrors in the whole retest').toHaveLength(0);

  // Global toast audit: nothing in the whole run was an engine-error toast.
  const badAll = toastErrors(toastsSeen);
  console.log(`[DEF210] all toasts seen: ${JSON.stringify(toastsSeen)}`);
  expect(badAll, 'no engine-error toast anywhere in the retest').toHaveLength(0);
});

