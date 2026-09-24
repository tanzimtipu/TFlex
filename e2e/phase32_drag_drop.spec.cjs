// Phase 32 — Multi Mode e2e (spec 3 of 4): cross-document page drag and drop.
//
// Covers success criterion 5, from BOTH drag paths:
//   (a) rail  : a thumbnail in section A -> a thumbnail in section B
//   (b) canvas: the hover grip [data-page-drag-handle] in pane A -> a page
//               slot in pane B
//   (c) Ctrl-held drop COPIES (B gains, A keeps)
//   (d) the drop indicator [data-drop-indicator="before"|"after"] and the
//       .thumb-drop-target / .document-scroller[data-page-drop-pane]
//       affordances
//
// Content verification uses the SHARED rail: both sections render their
// thumbnails at the same computed width, so the moved page's thumbnail
// raster in B is compared against the source page's raster in A (a
// scale-normalised 24x32 downscale + mean-absolute-difference), and against
// B's previous occupant of that slot.
//
// Native drag: Playwright's dragTo is attempted first (real mouse drag with
// Chromium's HTML5 drag machinery). Where a mid-drag affordance must be read
// (d), or when a native drag cannot be driven, a real DataTransfer is used
// in page.evaluate - explicitly reported in the run log.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const ALPHA_SRC = path.join(FIX, 'report.pdf'); // 34 pages
const BETA_SRC = path.join(FIX, 'long.pdf'); // 520 pages
const TMP = path.join(os.tmpdir(), 'tflex-p32');

let electronApp = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}
async function mockOpen(p) {
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}
async function openFile(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}
async function waitTabCount(n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}
function headerLoc(pane) {
  return win.locator(`.multi-pane-header[data-pane="${pane}"]`);
}
async function paneCount(pane) {
  const raw = await headerLoc(pane).innerText();
  const m = raw.match(/(\d+)\s+pages?/);
  return m ? Number(m[1]) : null;
}
// Amended Phase 32 semantics (DEF-277): a title-bar Open while the mode is on
// assigns the document to the FOCUSED pane, so the second document is opened
// in single mode first; alpha is then made active before the mode is turned on
// (pane A = alpha) and beta is picked into pane B.
async function twoPaneSetup() {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await openFile(tmpCopy(BETA_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}

// Scale-normalised raster signature of one rail thumbnail (24x32 grey).
async function thumbSig(pane, page) {
  return win.evaluate(({ p, pg }) => {
    const canvas = document.querySelector(
      `[data-pane-strip-pane="${p}"] .thumb-item[data-page="${pg}"] canvas.thumb-canvas`,
    );
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const W = 24;
    const H = 32;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const ctx = off.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(canvas, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push(Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
    return out;
  }, { p: pane, pg: page });
}
function sigDiff(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return Number((s / a.length).toFixed(2));
}

// Native drag attempt: Playwright dragTo with an optional Ctrl hold.
async function nativeDrag(srcLoc, tgtLoc, ctrl) {
  if (ctrl) await win.keyboard.down('Control');
  try {
    await srcLoc.dragTo(tgtLoc, { timeout: 8000 });
  } catch (e) {
    if (ctrl) await win.keyboard.up('Control');
    return { ok: false, error: e.message };
  }
  if (ctrl) await win.keyboard.up('Control');
  return { ok: true };
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(240000);

// Synthetic HTML5 drag steps with a real DataTransfer, driven from the
// renderer. Split across calls so React can commit the drag source state
// between dragstart and dragover/drop.
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p32dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over' || s === 'drop') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const clientX = r.left + r.width / 2;
      const clientY = a.after ? r.top + r.height * 0.75 : r.top + r.height * 0.25;
      const ev = new DragEvent(s === 'over' ? 'dragover' : 'drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX,
        clientY,
        ctrlKey: !!a.ctrl,
        altKey: false,
      });
      tgt.dispatchEvent(ev);
      const ind = document.querySelector('[data-drop-indicator]');
      return {
        ok: true,
        defaultPrevented: ev.defaultPrevented,
        indicator: ind ? ind.getAttribute('data-drop-indicator') : null,
        indicatorPage: ind ? ind.getAttribute('data-drop-page') : null,
        copy: ind ? ind.getAttribute('data-drop-copy') : null,
        dropPane: !!document.querySelector('.document-scroller[data-page-drop-pane="true"]'),
        thumbDropTarget: !!document.querySelector('.thumb-drop-target'),
        sectionDropTarget: !!document.querySelector('[data-pane-strip-drop-target="true"]'),
      };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}

async function synthDrag(srcSel, tgtSel, { ctrl = false, after = false } = {}) {
  const started = await synthStep('start', { src: srcSel });
  if (!started.ok) return started;
  await win.waitForTimeout(120);
  const over = await synthStep('over', { tgt: tgtSel, ctrl, after });
  await win.waitForTimeout(120);
  const drop = await synthStep('drop', { tgt: tgtSel, ctrl, after });
  await win.waitForTimeout(1600);
  return { ...drop, over };
}

test('D1 rail drag: page moves from section A to section B at the drop position', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  const refA1 = await thumbSig('A', 1);
  const bOld2 = await thumbSig('B', 2);
  expect(a0).toBe(34);
  expect(b0).toBe(520);

  const srcSel = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
  const tgtSel = '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]';
  const native = await nativeDrag(win.locator(srcSel).first(), win.locator(tgtSel).first(), false);
  await win.waitForTimeout(2200);
  let a1 = await paneCount('A');
  let b1 = await paneCount('B');
  let method = 'native dragTo';
  console.log(`[P32-dnd] D1 native dragTo ok=${native.ok}${native.error ? ' err=' + native.error : ''}; counts A ${a0}->${a1}, B ${b0}->${b1}`);
  if (a1 === a0 || b1 === b0) {
    method = 'synthetic DataTransfer (native dragTo did not move)';
    const s = await synthDrag(srcSel, tgtSel, {});
    a1 = await paneCount('A');
    b1 = await paneCount('B');
    console.log(`[P32-dnd] D1 synthetic over=${JSON.stringify(s.over)} counts A ${a0}->${a1}, B ${b0}->${b1}`);
  }
  console.log(`[P32-dnd] D1 method used: ${method}`);
  expect(a1).toBe(33);
  expect(b1).toBe(521);

  const newB2 = await thumbSig('B', 2);
  const newA1 = await thumbSig('A', 1);
  const dPos = sigDiff(newB2, refA1);
  const dOld = sigDiff(newB2, bOld2);
  const dNeg = sigDiff(newA1, refA1);
  console.log(`[P32-dnd] D1 raster: diff(B.newPage2, A.page1.before)=${dPos} diff(B.newPage2, B.page2.before)=${dOld} diff(A.newPage1, A.page1.before)=${dNeg}`);
  expect(dPos).not.toBeNull();
  expect(dPos).toBeLessThan(6); // inserted page matches the source page
  expect(dOld).toBeGreaterThan(dPos); // and is not B's previous occupant
  expect(dNeg).toBeGreaterThan(2); // A's slot now holds a different page
});

test('D2 canvas drag: page moves from pane A onto pane B at the drop position', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  const refA1 = await thumbSig('A', 1);
  const bOld2 = await thumbSig('B', 2);

  const srcLoc = win.locator('.tab-pane[data-pane="A"] [data-page-drag-handle="1"]').first();
  const tgtLoc = win.locator('.tab-pane[data-pane="B"] .page-slot[data-page="2"]').first();
  const srcCount = await srcLoc.count();
  console.log(`[P32-dnd] D2 canvas grip count in pane A = ${srcCount}`);
  expect(srcCount).toBeGreaterThan(0);

  const box = await tgtLoc.boundingBox();
  let native = { ok: false };
  if (box) {
    native = await (async () => {
      try {
        await srcLoc.dragTo(tgtLoc, { targetPosition: { x: Math.round(box.width / 2), y: 20 }, timeout: 8000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();
  }
  await win.waitForTimeout(2200);
  let a1 = await paneCount('A');
  let b1 = await paneCount('B');
  let method = 'native dragTo (targetPosition upper half)';
  console.log(`[P32-dnd] D2 native dragTo ok=${native.ok}${native.error ? ' err=' + native.error : ''}; counts A ${a0}->${a1}, B ${b0}->${b1}`);
  if (a1 === a0 || b1 === b0) {
    method = 'synthetic DataTransfer (native dragTo did not move)';
    const s = await synthDrag(
      '.tab-pane[data-pane="A"] [data-page-drag-handle="1"]',
      '.tab-pane[data-pane="B"] .page-slot[data-page="2"]',
      { after: false },
    );
    a1 = await paneCount('A');
    b1 = await paneCount('B');
    console.log(`[P32-dnd] D2 synthetic over=${JSON.stringify(s.over)} counts A ${a0}->${a1}, B ${b0}->${b1}`);
  }
  console.log(`[P32-dnd] D2 method used: ${method}`);
  expect(a1).toBe(33);
  expect(b1).toBe(521);

  const newB2 = await thumbSig('B', 2);
  const dPos = sigDiff(newB2, refA1);
  const dOld = sigDiff(newB2, bOld2);
  console.log(`[P32-dnd] D2 raster: diff(B.newPage2, A.page1.before)=${dPos} diff(B.newPage2, B.page2.before)=${dOld}`);
  expect(dPos).toBeLessThan(6);
  expect(dOld).toBeGreaterThan(dPos);
});

test('D3 Ctrl-held drop COPIES: B gains the page, A keeps it', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  const refA1 = await thumbSig('A', 1);
  const bOld2 = await thumbSig('B', 2);
  expect(a0).toBe(34);
  expect(b0).toBe(520);

  const srcSel = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
  const tgtSel = '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]';
  const native = await nativeDrag(win.locator(srcSel).first(), win.locator(tgtSel).first(), true);
  await win.waitForTimeout(2200);
  let a1 = await paneCount('A');
  let b1 = await paneCount('B');
  let method = 'native dragTo with Ctrl held';
  console.log(`[P32-dnd] D3 native Ctrl dragTo ok=${native.ok}; counts A ${a0}->${a1}, B ${b0}->${b1}`);
  if (a1 !== a0 || b1 === b0) {
    method = 'synthetic DataTransfer with ctrlKey (native Ctrl dragTo did not copy)';
    const s = await synthDrag(srcSel, tgtSel, { ctrl: true });
    a1 = await paneCount('A');
    b1 = await paneCount('B');
    console.log(`[P32-dnd] D3 synthetic over=${JSON.stringify(s.over)} counts A ${a0}->${a1}, B ${b0}->${b1}`);
  }
  console.log(`[P32-dnd] D3 method used: ${method}`);
  expect(a1).toBe(34); // source kept
  expect(b1).toBe(521); // target gained

  const newB2 = await thumbSig('B', 2);
  const a1sig = await thumbSig('A', 1);
  const dPos = sigDiff(newB2, refA1);
  const dOld = sigDiff(newB2, bOld2);
  const dSrc = sigDiff(a1sig, refA1);
  console.log(`[P32-dnd] D3 raster: diff(B.newPage2, A.page1.before)=${dPos} diff(B.newPage2, B.page2.before)=${dOld} diff(A.page1.after, A.page1.before)=${dSrc}`);
  expect(dPos).toBeLessThan(6);
  expect(dOld).toBeGreaterThan(dPos);
  expect(dSrc).toBeLessThan(2); // source page untouched by a copy
});

// React commits the drag state on the next render, so affordances are read
// in a separate evaluate after a short settle - never in the same tick as the
// dispatched event.
async function readAffordances() {
  return win.evaluate(() => {
    const inds = Array.from(document.querySelectorAll('[data-drop-indicator]')).map((el) => ({
      side: el.getAttribute('data-drop-indicator'),
      page: el.getAttribute('data-drop-page'),
      copy: el.getAttribute('data-drop-copy'),
    }));
    return {
      indicators: inds,
      dropPane: !!document.querySelector('.document-scroller[data-page-drop-pane="true"]'),
      thumbDropTarget: !!document.querySelector('.thumb-drop-target'),
      thumbDropCopy: !!document.querySelector('.thumb-drop-copy'),
      sectionDropTarget: !!document.querySelector('[data-pane-strip-drop-target="true"]'),
    };
  });
}
function hasIndicator(a, side, page) {
  return a.indicators.some((i) => i.side === side && i.page === String(page));
}

test('D4 drop affordances: indicator side, thumb drop target, drop-pane highlight', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');

  // (a) RAIL hover: the landing thumb + section highlight, no drop yet.
  const railStart = await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  expect(railStart.ok).toBe(true);
  await win.waitForTimeout(150);
  const railOver = await synthStep('over', { tgt: '[data-pane-strip-pane="B"] .thumb-item[data-page="3"]' });
  await win.waitForTimeout(300);
  const railAff = await readAffordances();
  console.log(`[P32-dnd] D4 rail hover: prevented=${railOver.defaultPrevented} ${JSON.stringify(railAff)}`);
  expect(railAff.thumbDropTarget).toBe(true);
  expect(railAff.sectionDropTarget).toBe(true);
  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(300);
  expect(await win.locator('.thumb-drop-target').count()).toBe(0);
  expect(await win.locator('[data-pane-strip-drop-target="true"]').count()).toBe(0);

  // (b) CANVAS hover, upper half of B page 2 -> indicator BEFORE page 2.
  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(150);
  const upHalf = await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="2"]', after: false });
  await win.waitForTimeout(300);
  const upAff = await readAffordances();
  console.log(`[P32-dnd] D4 canvas upper-half hover: prevented=${upHalf.defaultPrevented} ${JSON.stringify(upAff)}`);
  expect(upAff.dropPane).toBe(true);
  expect(hasIndicator(upAff, 'before', 2)).toBe(true);

  // (c) CANVAS hover, lower half of B page 2 -> indicator AFTER page 2.
  const loHalf = await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="2"]', after: true });
  await win.waitForTimeout(300);
  const loAff = await readAffordances();
  console.log(`[P32-dnd] D4 canvas lower-half hover: prevented=${loHalf.defaultPrevented} ${JSON.stringify(loAff)}`);
  expect(hasIndicator(loAff, 'after', 2)).toBe(true);

  // (d) Ctrl held -> the indicator advertises COPY.
  const copyHover = await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="2"]', after: false, ctrl: true });
  await win.waitForTimeout(300);
  const copyAff = await readAffordances();
  console.log(`[P32-dnd] D4 Ctrl hover: prevented=${copyHover.defaultPrevented} ${JSON.stringify(copyAff)}`);
  expect(copyAff.indicators.some((i) => i.copy === 'true')).toBe(true);

  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(400);
  expect(await win.locator('[data-drop-indicator]').count()).toBe(0);
  expect(await win.locator('.document-scroller[data-page-drop-pane="true"]').count()).toBe(0);

  // No page moved (only hovers, no drop).
  const a1 = await paneCount('A');
  const b1 = await paneCount('B');
  console.log(`[P32-dnd] D4 counts after hover-only drag: A ${a0}->${a1}, B ${b0}->${b1}`);
  expect(a1).toBe(a0);
  expect(b1).toBe(b0);
});