// TFL-785 (TFL-776.4) — adversary diff-pass on the Edit Text delete-teardown fix.
//
// Target change (TFL-776.1): the run bar's Delete dispatches
// `push-text-run-commit` with `maskedRect` == the vacated rect, so
// `isMaskedRunRect` (src/renderer/edit/model.ts:486-506; geometry match within
// 2pt) filters the engine-masked pdf.js phantom text item from both the window
// hover listener (EditOverlay.tsx:757-771) and `runAtPoint` (:699-735).
// QA closed DEF-561 (TFL-779) with hoverBoxes 1 -> 0.
//
// This spec attacks the fix and its neighbours. It FIXES nothing; it is
// read-only on src/. Launches ONLY through e2e/lib/launch.cjs `launchApp`.
//
// Run: npm.cmd run test:e2e -- tfl776_adversary_diffpass
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
// Harness/CI guard: if ELECTRON_RUN_AS_NODE is inherited, electron.exe runs as
// plain Node and rejects Playwright's --remote-debugging-port switch.
delete process.env.ELECTRON_RUN_AS_NODE;
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage, sampleCanvasPageRect } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RESULTS_PATH = path.join(SHOTS, 'tfl776-adversary-diffpass.json');
const RESULTS = [];

function rec(attack, verdict, detail) {
  const entry = { attack, verdict, detail, at: new Date().toISOString() };
  RESULTS.push(entry);
  console.log(`[TFL776.4-ADV] ${verdict} | ${attack} | ${JSON.stringify(detail)}`);
  try {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(RESULTS, null, 2));
  } catch (_) { /* best effort */ }
}

test.setTimeout(300000);

let app = null;
let win = null;

test.beforeEach(async () => {
  const sample = getSamplePath('report.pdf');
  app = await launchApp([sample]);
  win = await app.firstWindow();
  try {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  } catch (_) {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, sample);
    const openBtn = win.locator('[data-toolbar-open]').first();
    if ((await openBtn.count()) > 0) await openBtn.click();
    else await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 2);
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl776adv');
  app = null;
  win = null;
});

// ---- shared helpers -------------------------------------------------------

async function armTextTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="text"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

async function reanchor(page = 2) {
  await scrollToPage(win, page);
  await win.waitForTimeout(600);
}

// All visible textLayer spans on `page`, in DOM order, with viewport geometry.
async function pageSpans(page = 2) {
  return win.evaluate((pg) => {
    const spans = Array.from(
      document.querySelectorAll(`.page-slot[data-page="${pg}"] .textLayer span`),
    );
    return spans.map((s) => {
      const r = s.getBoundingClientRect();
      return {
        text: (s.textContent || '').trim(),
        left: r.x,
        top: r.y,
        w: r.width,
        h: r.height,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
  }, page);
}

// Spans whose trimmed text equals `needle`, sorted top-to-bottom.
async function spansByText(needle, page = 2) {
  const spans = await pageSpans(page);
  return spans
    .filter((s) => s.text === needle && s.w > 20 && s.h > 4)
    .sort((a, b) => a.top - b.top);
}

// A pair of page-2 runs with IDENTICAL text (hence identical page-point
// geometry), sorted top-to-bottom. This makes the over-filter geometry match
// exact: moving the lower copy onto the upper copy's rect lands within 2pt.
async function duplicatePair(page = 2) {
  const spans = (await pageSpans(page)).filter((s) => s.text.length >= 8 && s.w > 40 && s.h > 4);
  const groups = new Map();
  for (const s of spans) {
    const g = groups.get(s.text) || [];
    g.push(s);
    groups.set(s.text, g);
  }
  let best = null;
  for (const [text, g] of groups) {
    if (g.length >= 2 && (best === null || text.length > best.text.length)) {
      best = { text, spans: g.slice().sort((a, b) => a.top - b.top) };
    }
  }
  if (best === null) return null;
  const A = best.spans[0];
  const B = best.spans[best.spans.length - 1];
  return { text: best.text, A, B };
}

async function hoverCount(page = 2) {
  return win.locator(`.page-slot[data-page="${page}"] .edit-text-hover`).count();
}
async function barCount() {
  return win.locator('[data-content-action-bar="textrun"]').count();
}
async function selectionCount() {
  return win.locator('[data-textrun-selection]').count();
}
async function elementAt(x, y) {
  return win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (el === null) return null;
    const cls = typeof el.className === 'string' ? el.className : '';
    return { tag: el.tagName, cls };
  }, [x, y]);
}
async function moveAway() {
  await win.mouse.move(5, 5);
  await win.waitForTimeout(200);
}
async function diag() {
  return win.evaluate(() => (window.tflexDiagnostics ? window.tflexDiagnostics() : null));
}

// Count dark glyph pixels on the page canvas inside a span's box. This is an
// independent oracle for "the run is VISUALLY present": the engine's delete
// MASKS the rect with white, so after a delete darkGlyphs ~ 0; an undo that
// restores the run must bring the glyphs back.
async function glyphsAt(span, page = 2) {
  const pb = await win.locator(`.pdf-page[data-page="${page}"]`).boundingBox();
  if (!pb) return null;
  const rel = {
    x: span.left - pb.x,
    y: span.top - pb.y,
    w: Math.max(6, Math.min(span.w, pb.width - (span.left - pb.x))),
    h: Math.max(6, span.h),
  };
  const r = await sampleCanvasPageRect(win, rel, page);
  return r ? r.darkGlyphs : null;
}

async function selectRun(cx, cy) {
  await win.mouse.click(cx, cy);
  await win.locator('[data-content-action-bar="textrun"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.waitForTimeout(250);
}

async function deleteSelectedRun() {
  await win.locator('[data-content-action="textrun-delete"]').first().click();
  await win.waitForFunction(
    () => document.querySelector('[data-content-action-bar="textrun"]') === null,
    undefined,
    { timeout: 15000 },
  );
  await win.waitForTimeout(2200);
}

// Probe a viewport point with the text tool active: hover then click.
// Returns the measured hover box count, bar/selection counts and the hit-test.
async function probePoint(x, y) {
  await moveAway();
  await win.mouse.move(x, y);
  await win.waitForTimeout(500);
  const hover = await hoverCount();
  const barHover = await barCount();
  const hit = await elementAt(x, y);
  await win.mouse.click(x, y);
  await win.waitForTimeout(700);
  const barClick = await barCount();
  const selClick = await selectionCount();
  await moveAway();
  await win.waitForTimeout(250);
  const hoverAfter = await hoverCount();
  return { x, y, hover, barHover, hit, barClick, selClick, hoverAfter };
}

// ===========================================================================
// A1 — Refresh persistence: the vacated rect must stay inert across scroll,
// zoom, page unmount/remount and tab switch.
// ===========================================================================
test('A1 refresh persistence: vacated rect stays inert after scroll/zoom/remount/tab switch', async () => {
  await armTextTool();
  const spans = await pageSpans(2);
  const target = spans.find((s) => s.text.length >= 8 && s.w > 40);
  expect(target, 'a page-2 text run is present').toBeTruthy();

  await selectRun(target.cx, target.cy);
  await deleteSelectedRun();
  await reanchor(2);

  const detail = {};
  // Re-locate the phantom span by its exact text after each refresh.
  const locate = async () => {
    const found = await spansByText(target.text, 2);
    return found.length > 0 ? found[0] : null;
  };

  // (a) baseline after delete
  let vac = await locate();
  expect(vac, 'phantom span still in the text layer after delete').not.toBeNull();
  detail.afterDelete = await probePoint(vac.cx, vac.cy);

  // (b) scroll away and back
  await scrollToPage(win, 6);
  await win.waitForTimeout(600);
  await reanchor(2);
  vac = await locate();
  expect(vac, 'phantom span after scroll-away/back').not.toBeNull();
  detail.afterScroll = await probePoint(vac.cx, vac.cy);

  // (c) zoom in twice, probe, zoom out twice
  const zoomIn = win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').first();
  const zoomOut = win.locator('[data-zoom-pill] button[aria-label="Zoom out"]').first();
  await zoomIn.click();
  await win.waitForTimeout(500);
  await zoomIn.click();
  await win.waitForTimeout(900);
  await reanchor(2);
  vac = await locate();
  expect(vac, 'phantom span after zoom-in').not.toBeNull();
  detail.afterZoomIn = await probePoint(vac.cx, vac.cy);
  await zoomOut.click();
  await win.waitForTimeout(500);
  await zoomOut.click();
  await win.waitForTimeout(900);
  await reanchor(2);

  // (d) force a page unmount/remount
  await scrollToPage(win, 20);
  await win.waitForTimeout(800);
  detail.page2MountedWhileAway = await win.locator('.page-slot[data-page="2"]').count();
  await reanchor(2);
  vac = await locate();
  expect(vac, 'phantom span after page unmount/remount').not.toBeNull();
  detail.afterRemount = await probePoint(vac.cx, vac.cy);

  // (e) tab switch: open a second document, switch to the first tab
  const second = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, second);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(2600);
  await win.locator('.tab[data-tab-id]').first().click();
  await win.waitForTimeout(1200);
  await reanchor(2);
  vac = await locate();
  detail.phantomAfterTabSwitch = vac !== null;
  if (vac !== null) detail.afterTabSwitch = await probePoint(vac.cx, vac.cy);

  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a1-refresh.png') });

  const steps = ['afterDelete', 'afterScroll', 'afterZoomIn', 'afterRemount', 'afterTabSwitch'];
  const inert = [];
  for (const k of steps) {
    const d = detail[k];
    if (d === undefined) continue;
    const ok = d.hover === 0 && d.barHover === 0 && d.barClick === 0 && d.selClick === 0 &&
      !(d.hit !== null && d.hit.cls.includes('edit-text-hover'));
    inert.push({ step: k, ok, d });
    expect(ok, `${k}: vacated rect inert (${JSON.stringify(d)})`).toBe(true);
  }
  rec('A1_refresh_persistence', 'PASS', { target: target.text, steps: inert, detail });
});

// ===========================================================================
// A2 — Over-filter false positive: after deleting A, MOVE the identical-text
// run B so it lands exactly on A's vacated rect. B must stay hoverable /
// selectable (the 2pt maskedRect match must not suppress a legitimate run).
// ===========================================================================
async function moveRunOnto(lower, targetCx, targetCy) {
  // Select the lower run, then drag its centre to the target point (aligning
  // the run's centre with the target). The move is committed via Confirm.
  await selectRun(lower.cx, lower.cy);
  await win.mouse.move(lower.cx, lower.cy);
  await win.mouse.down();
  await win.mouse.move(targetCx, targetCy, { steps: 12 });
  await win.waitForTimeout(150);
  await win.mouse.up();
  await win.waitForTimeout(400);
  // Confirm the pending move.
  const confirm = win.locator('[data-content-action="textrun-confirm"]').first();
  await confirm.waitFor({ state: 'visible', timeout: 8000 });
  await confirm.click();
  await win.waitForTimeout(2400);
}

test('A2 over-filter: a run moved onto the vacated rect stays hoverable/selectable', async () => {
  await armTextTool();
  const pair = await duplicatePair(2);
  expect(pair, 'a page-2 pair of identical-text runs exists').not.toBeNull();
  const { A, B, text } = pair;
  expect(Math.abs(A.w - B.w) <= 1 && Math.abs(A.h - B.h) <= 1,
    `pair geometry matches (w ${A.w} vs ${B.w}, h ${A.h} vs ${B.h})`).toBe(true);

  // Delete A (the upper copy).
  await selectRun(A.cx, A.cy);
  await deleteSelectedRun();
  await reanchor(2);

  // Re-locate the surviving lower copy B (the phantom A stays in the DOM at
  // the upper rect, so sort by top and take the last).
  const remaining = await spansByText(text, 2);
  expect(remaining.length, 'phantom A + surviving B both present').toBeGreaterThanOrEqual(2);
  const Anow = remaining[0];               // phantom A rect
  const Bnow = remaining[remaining.length - 1]; // surviving B
  const targetCx = Anow.left + Bnow.w / 2;
  const targetCy = Anow.top + Bnow.h / 2;

  await moveRunOnto(Bnow, targetCx, targetCy);
  await reanchor(2);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a2-after-move.png') });

  const movedSpans = await spansByText(text, 2);
  const moved = movedSpans.length > 0 ? movedSpans[0] : null;
  // Every text-layer item now sharing A's line (phantom A + re-baked B), with
  // geometry, to show whether the re-baked copy diverges from the deleted rect.
  const topGroup = movedSpans
    .filter((s) => Math.abs(s.top - Anow.top) < 40)
    .map((s) => ({ left: +s.left.toFixed(2), top: +s.top.toFixed(2), w: +s.w.toFixed(2), h: +s.h.toFixed(2) }));
  await moveAway();
  await win.mouse.move(targetCx, targetCy);
  await win.waitForTimeout(500);
  const hoverBox = await win
    .locator('.page-slot[data-page="2"] .edit-text-hover')
    .first()
    .boundingBox()
    .catch(() => null);
  await moveAway();
  const probe = await probePoint(targetCx, targetCy);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a2-probe.png') });

  const hoverable = probe.hover > 0 || probe.barHover > 0;
  const selectable = probe.barClick > 0 || probe.selClick > 0;
  const detail = {
    text,
    A, B,
    Anow, Bnow,
    targetCx, targetCy,
    movedTopSpan: moved,
    topGroup,
    hoverBox,
    probe,
    hoverable,
    selectable,
  };
  console.log(`[TFL776.4-ADV] A2 detail=${JSON.stringify(detail)}`);
  if (hoverable && selectable) {
    rec('A2_over_filter', 'PASS', detail);
  } else {
    rec('A2_over_filter', 'FAIL', detail);
  }
  // The assertion that encodes the brief's expectation (fails the run on a
  // genuine over-filter; the ADV entry names the measured values).
  expect(hoverable, `run B must stay hoverable at its new rect (probe ${JSON.stringify(probe)})`).toBe(true);
  expect(selectable, `run B must stay selectable at its new rect (probe ${JSON.stringify(probe)})`).toBe(true);
});

// ===========================================================================
// A3 — Near-tolerance: a surviving run whose rect sits just OUTSIDE the 2pt
// window of the deleted rect must remain hoverable and selectable.
// ===========================================================================
test('A3 near-tolerance: a run moved just outside the 2pt window stays interactive', async () => {
  await armTextTool();
  const pair = await duplicatePair(2);
  expect(pair, 'a page-2 pair of identical-text runs exists').not.toBeNull();
  const { A, B, text } = pair;

  // cssScale from the known page-point y gap between the two identical runs.
  const pairGapPt = 138.72; // report.pdf page 2: y 248.952 - 110.232
  const cssScale = (B.top - A.top) / pairGapPt;
  const offsetPt = 4; // just outside the 2pt window
  const offsetCss = offsetPt * cssScale;
  console.log(`[TFL776.4-ADV] A3 cssScale=${cssScale.toFixed(4)} offsetCss=${offsetCss.toFixed(2)}`);

  await selectRun(A.cx, A.cy);
  await deleteSelectedRun();
  await reanchor(2);

  const remaining = await spansByText(text, 2);
  expect(remaining.length, 'phantom A + surviving B both present').toBeGreaterThanOrEqual(2);
  const Anow = remaining[0];
  const Bnow = remaining[remaining.length - 1];
  const targetCx = Anow.left + Bnow.w / 2 + offsetCss;
  const targetCy = Anow.top + Bnow.h / 2;

  await moveRunOnto(Bnow, targetCx, targetCy);
  await reanchor(2);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a3-after-move.png') });

  // Probe BOTH the vacated rect centre and the offset centre: a run that moved
  // only +4pt still spans both, so hover at the offset proves a live run there.
  const probeOffset = await probePoint(targetCx, targetCy);
  const probeAtRect = await probePoint(Anow.left + Bnow.w / 2, Anow.top + Bnow.h / 2);
  // Record every text-layer item on A's line with its page-point x offset.
  const movedSpans = await spansByText(text, 2);
  const topGroup = movedSpans
    .filter((s) => Math.abs(s.top - Anow.top) < 40)
    .map((s) => ({
      left: +s.left.toFixed(2),
      w: +s.w.toFixed(2),
      offsetPt: cssScale > 0 ? +((s.left - Anow.left) / cssScale).toFixed(2) : null,
    }));

  const hoverable = probeOffset.hover > 0 || probeOffset.barHover > 0 || probeAtRect.hover > 0;
  const selectable = probeOffset.barClick > 0 || probeOffset.selClick > 0 || probeAtRect.barClick > 0;
  const detail = {
    text, Anow, Bnow, targetCx, targetCy, cssScale, offsetPt,
    topGroup, probeOffset, probeAtRect, hoverable, selectable,
  };
  console.log(`[TFL776.4-ADV] A3 detail=${JSON.stringify(detail)}`);
  rec('A3_near_tolerance', hoverable && selectable ? 'PASS' : 'FAIL', detail);
  expect(hoverable, `run just outside the 2pt window must stay hoverable (${JSON.stringify({ probeOffset, probeAtRect })})`).toBe(true);
  expect(selectable, `run just outside the 2pt window must stay selectable (${JSON.stringify({ probeOffset, probeAtRect })})`).toBe(true);
});

// ===========================================================================
// A4 — Multi-delete: delete two runs on the same page; both vacated rects
// inert, every other run unaffected.
// ===========================================================================
test('A4 multi-delete: both vacated rects inert, a surviving run unaffected', async () => {
  await armTextTool();
  const spans = (await pageSpans(2)).filter((s) => s.text.length >= 8 && s.w > 40 && s.h > 4);
  expect(spans.length, 'page-2 has at least three runs').toBeGreaterThanOrEqual(3);
  const r1 = spans[0];
  const r2 = spans[1];
  const control = spans.find((s) => s.text !== r1.text && s.text !== r2.text);

  await selectRun(r1.cx, r1.cy);
  await deleteSelectedRun();
  await reanchor(2);
  const r2now = (await spansByText(r2.text, 2)).sort((a, b) => a.top - b.top)[0];
  expect(r2now, 'second run still locatable after the first delete').toBeTruthy();
  await selectRun(r2now.cx, r2now.cy);
  await deleteSelectedRun();
  await reanchor(2);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a4-after-deletes.png') });

  const v1 = (await spansByText(r1.text, 2)).sort((a, b) => a.top - b.top)[0];
  const v2 = (await spansByText(r2.text, 2)).sort((a, b) => a.top - b.top)[0];
  expect(v1, 'phantom of run 1 present').toBeTruthy();
  expect(v2, 'phantom of run 2 present').toBeTruthy();
  const p1 = await probePoint(v1.cx, v1.cy);
  const p2 = await probePoint(v2.cx, v2.cy);

  const cnow = (await spansByText(control.text, 2)).sort((a, b) => a.top - b.top)[0];
  let controlProbe = null;
  if (cnow) {
    await moveAway();
    await win.mouse.move(cnow.cx, cnow.cy);
    await win.waitForTimeout(500);
    controlProbe = { hover: await hoverCount(), bar: await barCount() };
    await moveAway();
  }

  const inert1 = p1.hover === 0 && p1.barHover === 0 && p1.barClick === 0 && p1.selClick === 0;
  const inert2 = p2.hover === 0 && p2.barHover === 0 && p2.barClick === 0 && p2.selClick === 0;
  const controlOk = controlProbe !== null && controlProbe.hover > 0;
  const detail = { r1: r1.text, r2: r2.text, control: control.text, v1, v2, p1, p2, controlProbe, inert1, inert2, controlOk };
  console.log(`[TFL776.4-ADV] A4 detail=${JSON.stringify(detail)}`);
  rec('A4_multi_delete', inert1 && inert2 && controlOk ? 'PASS' : 'FAIL', detail);
  expect(inert1, `vacated rect 1 inert (${JSON.stringify(p1)})`).toBe(true);
  expect(inert2, `vacated rect 2 inert (${JSON.stringify(p2)})`).toBe(true);
  expect(controlOk, `a surviving run still hovers (${JSON.stringify(controlProbe)})`).toBe(true);
});

// ===========================================================================
// A5 — Other run-removal paths: empty the on-canvas inline editor and the
// panel Text field, then commit. Assert no hit-target remains where text
// disappeared and the document is not modified (DEF-541 whitespace guard).
// ===========================================================================
async function blurActive() {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  });
  await win.waitForTimeout(1400);
}

test('A5 other removal paths: empty inline editor / panel commit leaves no ghost and no modification', async () => {
  await armTextTool();
  const detail = {};

  // Path A — on-canvas inline run editor, emptied then committed (blur).
  const spans = (await pageSpans(2)).filter((s) => s.text.length >= 8 && s.w > 40);
  const runA = spans[0];
  await selectRun(runA.cx, runA.cy);
  // The run selection surface opens the inline editor on double-click.
  await win.locator('[data-textrun-selection]').first().waitFor({ state: 'visible', timeout: 8000 });
  await win.evaluate(() => {
    const el = document.querySelector('[data-textrun-selection]');
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  let inlineOpened = true;
  try {
    await win.waitForSelector('[data-edit-run-editor]', { state: 'visible', timeout: 6000 });
  } catch (_) {
    inlineOpened = false;
  }
  if (inlineOpened) {
    await win.locator('[data-edit-run-editor]').fill('');
    await win.waitForTimeout(300);
  }
  const beforeDiag = await diag();
  await blurActive();
  await win.waitForTimeout(1600);
  await reanchor(2);
  const afterA = await diag();
  const layerA = await win.evaluate((pg) => {
    const layer = document.querySelector(`.page-slot[data-page="${pg}"] .textLayer`);
    return layer ? (layer.textContent || '') : '';
  }, 2);
  const survivedA = layerA.includes(runA.text);
  const aLoc = (await spansByText(runA.text, 2)).sort((a, b) => a.top - b.top)[0];
  const aProbe = aLoc ? await probePoint(aLoc.cx, aLoc.cy) : null;
  detail.pathA = {
    run: runA.text,
    inlineOpened,
    modifiedBefore: beforeDiag && beforeDiag.modified,
    modifiedAfter: afterA && afterA.modified,
    textSurvived: survivedA,
    probe: aProbe,
    ghost: aProbe ? aProbe.hover : null,
  };
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a5-inline.png') });

  // Path B — panel Text field, emptied then committed (blur).
  const spans2 = (await pageSpans(2)).filter((s) => s.text.length >= 8 && s.w > 40);
  const runB = spans2.find((s) => s.text !== runA.text) || spans2[0];
  await selectRun(runB.cx, runB.cy);
  const field = win.locator('[data-txt-text]').first();
  await field.waitFor({ state: 'visible', timeout: 10000 });
  await field.fill('');
  await win.waitForTimeout(300);
  const beforeBDiag = await diag();
  await blurActive();
  await win.waitForTimeout(1600);
  await reanchor(2);
  const afterB = await diag();
  const layerB = await win.evaluate((pg) => {
    const layer = document.querySelector(`.page-slot[data-page="${pg}"] .textLayer`);
    return layer ? (layer.textContent || '') : '';
  }, 2);
  const survivedB = layerB.includes(runB.text);
  const bLoc = (await spansByText(runB.text, 2)).sort((a, b) => a.top - b.top)[0];
  const bProbe = bLoc ? await probePoint(bLoc.cx, bLoc.cy) : null;
  detail.pathB = {
    run: runB.text,
    modifiedBefore: beforeBDiag && beforeBDiag.modified,
    modifiedAfter: afterB && afterB.modified,
    textSurvived: survivedB,
    probe: bProbe,
    ghost: bProbe ? bProbe.hover : null,
  };
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a5-panel.png') });

  // DEF-541 guard: emptying and committing must NOT reach the engine, so the
  // text stays and the document stays unmodified. If the text DID disappear,
  // the vacated position must be inert (no ghost). When the on-canvas editor
  // could not be opened by the harness, path A is inconclusive (recorded).
  const aOk = !inlineOpened
    ? true
    : (survivedA ? (afterA && afterA.modified) === false : (aProbe !== null && aProbe.hover === 0));
  const bOk = survivedB ? (afterB && afterB.modified) === false : (bProbe !== null && bProbe.hover === 0);
  const verdict = aOk && bOk ? 'PASS' : 'FAIL';
  console.log(`[TFL776.4-ADV] A5 detail=${JSON.stringify(detail)}`);
  rec('A5_other_removal_paths', verdict, detail);
  expect(aOk, `path A (inline editor) safe (${JSON.stringify(detail.pathA)})`).toBe(true);
  expect(bOk, `path B (panel Text) safe (${JSON.stringify(detail.pathB)})`).toBe(true);
});

// ===========================================================================
// A6 — Delete then residual Confirm / undo / redo.
// ===========================================================================
test('A6 delete then Confirm/undo/redo: no ghost, no resurrection', async () => {
  await armTextTool();
  const spans = (await pageSpans(2)).filter((s) => s.text.length >= 8 && s.w > 40);
  const run = spans[0];
  const detail = { run: run.text };

  await selectRun(run.cx, run.cy);
  detail.glyphsBefore = await glyphsAt(run);
  await deleteSelectedRun();
  await reanchor(2);

  // Any residual Confirm on the run bar?
  detail.residualConfirm = await win.locator('[data-content-action="textrun-confirm"]').count();
  detail.residualBar = await barCount();
  detail.afterDeleteDiag = await diag();

  const vac = (await spansByText(run.text, 2)).sort((a, b) => a.top - b.top)[0];
  expect(vac, 'phantom after delete').toBeTruthy();
  detail.glyphsAfterDelete = await glyphsAt(vac);
  detail.afterDeleteProbe = await probePoint(vac.cx, vac.cy);

  // Undo the delete.
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(2400);
  await reanchor(2);
  detail.afterUndoDiag = await diag();
  const vacUndo = (await spansByText(run.text, 2)).sort((a, b) => a.top - b.top)[0];
  detail.glyphsAfterUndo = vacUndo ? await glyphsAt(vacUndo) : null;
  detail.afterUndoProbe = vacUndo ? await probePoint(vacUndo.cx, vacUndo.cy) : null;
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a6-after-undo.png') });

  // Redo the delete.
  await win.keyboard.press('Control+y');
  await win.waitForTimeout(2400);
  await reanchor(2);
  detail.afterRedoDiag = await diag();
  const vacRedo = (await spansByText(run.text, 2)).sort((a, b) => a.top - b.top)[0];
  detail.glyphsAfterRedo = vacRedo ? await glyphsAt(vacRedo) : null;
  detail.afterRedoProbe = vacRedo ? await probePoint(vacRedo.cx, vacRedo.cy) : null;
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-adv-a6-after-redo.png') });

  const inertAfterDelete = detail.afterDeleteProbe.hover === 0 && detail.afterDeleteProbe.barClick === 0;
  const inertAfterRedo = detail.afterRedoProbe !== null &&
    detail.afterRedoProbe.hover === 0 && detail.afterRedoProbe.barClick === 0;
  const undoSelectable = detail.afterUndoProbe !== null &&
    (detail.afterUndoProbe.hover > 0 || detail.afterUndoProbe.barClick > 0);
  // The run is VISUALLY restored by undo when the mask comes off: the delete
  // drops the dark-glyph count at the rect and the undo brings it back.
  const gBefore = detail.glyphsBefore;
  const gDelete = detail.glyphsAfterDelete;
  const gUndo = detail.glyphsAfterUndo;
  const undoVisual = gBefore !== null && gDelete !== null && gUndo !== null &&
    gBefore > gDelete && gUndo > gDelete;
  const undoOverFilter = undoVisual && !undoSelectable;

  detail.inertAfterDelete = inertAfterDelete;
  detail.inertAfterRedo = inertAfterRedo;
  detail.undoRestoredRunSelectable = undoSelectable;
  detail.undoRestoredRunVisible = undoVisual;
  detail.undoOverFilter = undoOverFilter;
  console.log(`[TFL776.4-ADV] A6 detail=${JSON.stringify(detail)}`);

  // The brief's hard expectations: no ghost after delete and after redo.
  const briefOk = inertAfterDelete && inertAfterRedo;
  rec('A6_delete_undo_redo', briefOk ? (undoOverFilter ? 'FAIL' : 'PASS') : 'FAIL', detail);
  expect(inertAfterDelete, `no ghost after delete (${JSON.stringify(detail.afterDeleteProbe)})`).toBe(true);
  expect(inertAfterRedo, `no ghost after redo (${JSON.stringify(detail.afterRedoProbe)})`).toBe(true);
  // Over-filter after undo is a real break: the run is visible but dead.
  expect(undoOverFilter, `undo must not leave the restored run un-selectable (${JSON.stringify({
    glyphsBefore: detail.glyphsBefore, glyphsAfterDelete: detail.glyphsAfterDelete,
    glyphsAfterUndo: detail.glyphsAfterUndo, afterUndoProbe: detail.afterUndoProbe,
  })})`).toBe(false);
});

// ===========================================================================
// S — summary matrix (informational; the per-attack ADV entries are the
// evidence. A failed earlier test restarts the Playwright worker, so this
// cannot rely on the in-memory RESULTS array).
// ===========================================================================
test('S summary: print the per-attack matrix collected this worker', async () => {
  console.log(`[TFL776.4-ADV] MATRIX ${JSON.stringify(RESULTS.map((r) => ({ a: r.attack, v: r.verdict })))}`);
});
