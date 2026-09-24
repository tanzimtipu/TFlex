// Run-close focused verification (qa): DEF-279 guard + Phase 32 criteria 2 & 5.
//
// The shipped e2e/retests/def279_repro.spec.cjs asserts a refusal toast from a
// flow the DEF-279 dedupe fix made unreachable: the case-variant open now
// collapses to ONE tab, so pane B's pick list is empty and no conflicting
// assign is ever attempted, yet the spec still asserts the toast. This focused
// spec exercises the guard through the REACHABLE path - focus pane B, then open
// the SAME file - and re-confirms the two most consequential behaviours in the
// current build:
//   (a) criterion 2 (amended DEF-277): opening a document while the mode is on
//       assigns it to the FOCUSED pane with a visible effect;
//   (b) criterion 5: a cross-document drag moves the page from BOTH the rail
//       and the canvas (both page counts change).
// Temp copies only; launches only through e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(ROOT, 'test-fixtures');
const REPORT_SRC = path.join(FIX, 'report.pdf'); // 34 pages
const LONG_SRC = path.join(FIX, 'long.pdf'); // 520 pages
const TMP = path.join(os.tmpdir(), 'tflex-def279-rc');

let app = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}
async function mockOpen(p) {
  await app.evaluate(async ({ dialog }, fp) => {
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
// Correct setup: open BOTH files while the mode is OFF, then seed pane A and
// pick the other document into pane B. (The stale specs open the second file
// AFTER enabling the mode, which the amended DEF-277 semantics now assign to
// the focused pane instead - the cause of their setup failure.)
async function twoPaneSetup() {
  await openFile(tmpCopy(REPORT_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await openFile(tmpCopy(LONG_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — single-mode Multi Mode toggle now lives in the palette.
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1400);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}
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
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p32rc_dt';
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
      const ev = new DragEvent(s === 'over' ? 'dragover' : 'drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + r.width / 2,
        clientY: a.after ? r.top + r.height * 0.75 : r.top + r.height * 0.25,
        ctrlKey: !!a.ctrl,
        altKey: false,
      });
      tgt.dispatchEvent(ev);
      return { ok: true, defaultPrevented: ev.defaultPrevented };
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
  await synthStep('over', { tgt: tgtSel, ctrl, after });
  await win.waitForTimeout(120);
  const drop = await synthStep('drop', { tgt: tgtSel, ctrl, after });
  await win.waitForTimeout(1600);
  return drop;
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def279-rc');
  app = null;
  win = null;
});
test.setTimeout(240000);

test('DEF-279 guard: a case-variant spelling of the same file cannot enter the other pane', async () => {
  const exact = tmpCopy(REPORT_SRC, 'p32-samefile.pdf');
  const variant = exact.replace('p32-samefile.pdf', 'P32-SAMEFILE.PDF');
  expect(fs.existsSync(variant)).toBe(true); // Windows: same file, different case

  // Mode OFF: the case-variant open must dedupe to ONE tab.
  await openFile(exact);
  await waitTabCount(1);
  await openFile(variant);
  await win.waitForTimeout(700);
  const tabsAfterVariant = await win.locator('.tab[data-tab-id]').count();
  console.log(`[DEF279-rc] tabs after case-variant open (mode off) = ${tabsAfterVariant} (expect 1)`);
  expect(tabsAfterVariant).toBe(1);

  // Enable Multi Mode -> pane A = the exact-case document, pane B empty.
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(500);

  // Focus the EMPTY pane B, then open the SAME file: the pane guard must
  // refuse it with a message and create no tab.
  await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').click();
  await win.waitForTimeout(300);
  await openFile(variant);
  const toasts = await win.locator('.toast-text').allInnerTexts();
  const tabsAfter = await win.locator('.tab[data-tab-id]').count();
  const paneBEmpty = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  console.log(`[DEF279-rc] refusal toasts=${JSON.stringify(toasts)} tabs=${tabsAfter} paneBEmpty=${paneBEmpty}`);
  expect(toasts.some((t) => t.includes('already shown in the other pane'))).toBe(true);
  expect(tabsAfter).toBe(1);
  expect(paneBEmpty).toBe(1);
});

test('criterion 2 (amended): opening a document while the mode is on assigns it to the FOCUSED pane', async () => {
  await openFile(tmpCopy(REPORT_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(400);
  // Focused pane is A by default; open gamma -> pane A must become gamma.
  await openFile(tmpCopy(REPORT_SRC, 'p32-gamma.pdf'));
  await win.waitForTimeout(1200);
  const hA = (await headerLoc('A').innerText()).replace(/\s+/g, ' ').trim();
  const emptyB = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  const panes = await win.locator('[data-pane]').count();
  console.log(`[P32-rc] open while mode on: A="${hA}" paneBEmpty=${emptyB} data-pane count=${panes}`);
  expect(hA).toContain('p32-gamma');
  expect(emptyB).toBe(1);
});

test('criterion 5: rail drag moves a page across documents (both counts change)', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  expect(a0).toBe(34);
  expect(b0).toBe(520);
  const srcSel = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
  const tgtSel = '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]';
  const native = await nativeDrag(win.locator(srcSel).first(), win.locator(tgtSel).first(), false);
  await win.waitForTimeout(2200);
  let a1 = await paneCount('A');
  let b1 = await paneCount('B');
  let method = 'native dragTo';
  if (a1 === a0 || b1 === b0) {
    method = 'synthetic DataTransfer';
    await synthDrag(srcSel, tgtSel, {});
    a1 = await paneCount('A');
    b1 = await paneCount('B');
  }
  console.log(`[P32-rc] rail drag (${method}) nativeOk=${native.ok} counts A ${a0}->${a1}, B ${b0}->${b1}`);
  expect(a1).toBe(33);
  expect(b1).toBe(521);
});

test('criterion 5: canvas drag moves a page across documents (both counts change)', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  const srcLoc = win.locator('.tab-pane[data-pane="A"] [data-page-drag-handle="1"]').first();
  const tgtLoc = win.locator('.tab-pane[data-pane="B"] .page-slot[data-page="2"]').first();
  expect(await srcLoc.count()).toBeGreaterThan(0);
  const box = await tgtLoc.boundingBox();
  let native = { ok: false };
  if (box) {
    try {
      await srcLoc.dragTo(tgtLoc, { targetPosition: { x: Math.round(box.width / 2), y: 20 }, timeout: 8000 });
      native = { ok: true };
    } catch (e) {
      native = { ok: false, error: e.message };
    }
  }
  await win.waitForTimeout(2200);
  let a1 = await paneCount('A');
  let b1 = await paneCount('B');
  let method = 'native dragTo';
  if (a1 === a0 || b1 === b0) {
    method = 'synthetic DataTransfer';
    await synthDrag('.tab-pane[data-pane="A"] [data-page-drag-handle="1"]', '.tab-pane[data-pane="B"] .page-slot[data-page="2"]', { after: false });
    a1 = await paneCount('A');
    b1 = await paneCount('B');
  }
  console.log(`[P32-rc] canvas drag (${method}) nativeOk=${native.ok} counts A ${a0}->${a1}, B ${b0}->${b1}`);
  expect(a1).toBe(33);
  expect(b1).toBe(521);
});
