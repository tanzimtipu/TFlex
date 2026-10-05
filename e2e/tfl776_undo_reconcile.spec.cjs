// TFL-776.6 (DEF-564) — focused regression: after the Edit Text run-bar Delete
// and then Ctrl+Z, the restored run MUST be live again (hover box + run bar +
// selection), and after Ctrl+Y the vacated rect MUST be inert again.
//
// Root cause: the delete's `push-text-run-commit` `maskedRect` is renderer-only
// and was never reconciled with engine undo/redo, so `isMaskedRunRect` kept
// suppressing the restored run. This spec drives the exact operator path and
// probes with the text tool. It FAILS on the pre-fix build (undo leaves the
// run visible but dead) and PASSES once the commit registry is reconciled.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs `launchApp`.
// Run: npm.cmd run test:e2e -- tfl776_undo_reconcile --reporter=line
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
delete process.env.ELECTRON_RUN_AS_NODE;
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const RUN_TEXT = 'Chapter 1: The Art of Orchestration';
let app = null;
let win = null;

test.setTimeout(300000);

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
  if (app) await hardClose(app, 'tfl776_undo');
  app = null;
  win = null;
});

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

// The viewport box of the page-2 run whose text matches `needle`; falls back to
// the first long run so the spec still drives a real run on a reflowed sample.
async function runBox() {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="2"] .textLayer span'));
    let fallback = null;
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (r.width <= 20 || r.height <= 4) continue;
      if (t === needle) return { text: t, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      if (fallback === null && t.length >= 8) fallback = { text: t, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }
    return fallback;
  }, RUN_TEXT);
}

async function hoverCount() {
  return win.locator('.page-slot[data-page="2"] .edit-text-hover').count();
}
async function barCount() {
  return win.locator('[data-content-action-bar="textrun"]').count();
}
async function selectionCount() {
  return win.locator('[data-textrun-selection]').count();
}
async function moveAway() {
  await win.mouse.move(5, 5);
  await win.waitForTimeout(220);
}

// Clear a run selection left by the previous click so the next probe starts
// from a neutral state (a lingering `[data-textrun-selection]` also paints an
// `.edit-text-hover` element, which would pollute the hover count).
async function dismissSelection() {
  const box = await win.locator('.pdf-page[data-page="2"]').boundingBox();
  if (box) {
    await win.mouse.click(box.x + 8, box.y + box.height - 8);
    await win.waitForTimeout(400);
  }
  await moveAway();
}

// Probe a viewport point with the text tool active: move away, hover then
// click, measuring the hover box, run bar and selection surface at each step.
async function probePoint(x, y) {
  await moveAway();
  await win.mouse.move(x, y);
  await win.waitForTimeout(500);
  const hover = await hoverCount();
  const barHover = await barCount();
  await win.mouse.click(x, y);
  await win.waitForTimeout(700);
  const barClick = await barCount();
  const selClick = await selectionCount();
  await moveAway();
  return { hover, barHover, barClick, selClick };
}

test('undo of a run delete restores a live run; redo makes it inert again', async () => {
  await armTextTool();
  const run = await runBox();
  expect(run, 'a page-2 text run is present').toBeTruthy();
  console.log(`[TFL-776.6] target run=${JSON.stringify(run)}`);

  // 1. Single-click the run -> run bar, then Delete.
  await win.mouse.click(run.cx, run.cy);
  await win.locator('[data-content-action-bar="textrun"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.locator('[data-content-action="textrun-delete"]').first().click();
  await win.waitForFunction(
    () => document.querySelector('[data-content-action-bar="textrun"]') === null,
    undefined,
    { timeout: 15000 },
  );
  await win.waitForTimeout(2200);

  // 2. Ctrl+Z -> the restored run must be live (hover box + bar + selection).
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(2400);
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const afterUndo = await runBox();
  expect(afterUndo, 'restored run still in the text layer after undo').toBeTruthy();
  const undoProbe = await probePoint(afterUndo.cx, afterUndo.cy);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-undo-after-undo.png') });
  console.log(`[TFL-776.6] after-undo probe=${JSON.stringify(undoProbe)}`);

  // 3. Ctrl+Y -> the vacated rect must be inert again.
  await dismissSelection();
  await win.keyboard.press('Control+y');
  await win.waitForTimeout(2400);
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const afterRedo = await runBox();
  const redoProbe = afterRedo ? await probePoint(afterRedo.cx, afterRedo.cy) : null;
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-undo-after-redo.png') });
  console.log(`[TFL-776.6] after-redo probe=${JSON.stringify(redoProbe)}`);

  fs.writeFileSync(
    path.join(SHOTS, 'tfl776-undo-reconcile.json'),
    JSON.stringify({ run, afterUndo, undoProbe, afterRedo, redoProbe }, null, 2),
  );

  expect(undoProbe.hover, `restored run hoverable (${JSON.stringify(undoProbe)})`).toBeGreaterThanOrEqual(1);
  expect(undoProbe.barClick, `restored run re-selectable (${JSON.stringify(undoProbe)})`).toBeGreaterThanOrEqual(1);
  expect(undoProbe.selClick, `restored run shows a selection surface (${JSON.stringify(undoProbe)})`).toBeGreaterThanOrEqual(1);

  expect(redoProbe, 'redo leaves a probeable rect').not.toBeNull();
  expect(redoProbe.hover, `vacated rect not hoverable after redo (${JSON.stringify(redoProbe)})`).toBe(0);
  expect(redoProbe.barHover, `no bar on hover after redo (${JSON.stringify(redoProbe)})`).toBe(0);
  expect(redoProbe.barClick, `vacated rect not selectable after redo (${JSON.stringify(redoProbe)})`).toBe(0);
  expect(redoProbe.selClick, `no selection surface after redo (${JSON.stringify(redoProbe)})`).toBe(0);
});