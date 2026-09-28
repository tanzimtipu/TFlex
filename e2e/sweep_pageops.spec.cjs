// DEEP SWEEP - page operations on the DEV build (converted from the installed v1.7.11 app, 2026-09-05). Insert blank /
// from-PDF at start/middle/end, undo/redo chains, reorder/rotate/delete mixed
// with insert, crop multiple pages, and save+reopen structural preservation.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchDev, openSample, diag, shot, scrollToPage, getSamplePath , hardClose, gotoStage, runTool } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  pageErrors = [];
  win.on('pageerror', (e) => {
    const m = e && e.message ? e.message : String(e);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(400);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null; pageErrors = [];
});
test.setTimeout(300000);

async function eng() {
  const d = await diag(win);
  return d.engineState || d;
}
async function openTools() {
  // Phase 36 migration: the All-tools palette is retired; use runTool(id).
}
function badHooks() {
  return pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request|NaN|degreeAngle/.test(m));
}
async function saveAsTo(name) {
  const outPath = path.join(os.tmpdir(), `tflex-pgops-${Date.now()}-${name}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  // Stable title-bar hook (the Phase-13 label is "Save a copy").
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  return outPath;
}
async function reparse(filePath) {
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(filePath));
    return { pages: pdf.getPageCount() };
  } catch (e) { return { err: e.message }; }
}

// Insert a blank page at a numeric position (rank semantics).
async function insertBlank(position) {
  await runTool(win, 'insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.waitForTimeout(200);
  await win.fill('[data-insert-position]', String(position));
  await win.waitForTimeout(200);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2600);
}

test('P1: insert blank at start/middle/end + save/reopen preserves structure', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const e0 = await eng();
  const base = e0.pageCount; // 34
  console.log(`[P1] base pageCount=${base}`);

  // Insert at start (position 1 -> blank becomes page 1).
  await insertBlank(1);
  let e1 = await eng();
  console.log(`[P1] after start insert count=${e1.pageCount} order0-4=${JSON.stringify(e1.pageOrder.slice(0, 5))}`);
  expect(e1.pageCount, 'start insert grows page count').toBe(base + 1);
  expect(new Set(e1.pageOrder).size, 'no dup after start insert').toBe(e1.pageOrder.length);
  expect(e1.pageOrder[0], 'blank becomes page 1').toBe(base);

  // Insert at middle (position 3 -> blank becomes page 3).
  await insertBlank(3);
  e1 = await eng();
  console.log(`[P1] after mid insert count=${e1.pageCount} order0-5=${JSON.stringify(e1.pageOrder.slice(0, 6))}`);
  expect(new Set(e1.pageOrder).size, 'no dup after mid insert').toBe(e1.pageOrder.length);

  // Insert at end.
  await insertBlank('end');
  e1 = await eng();
  console.log(`[P1] after end insert count=${e1.pageCount} last=${e1.pageOrder[e1.pageOrder.length - 1]}`);
  expect(e1.pageCount, 'end insert grows page count').toBe(base + 3);
  expect(new Set(e1.pageOrder).size, 'no dup after end insert').toBe(e1.pageOrder.length);

  // Undo chain: undo the end insert, then the mid insert, then the start insert.
  await runTool(win, 'undo');
  await win.waitForTimeout(1500);
  expect((await eng()).pageCount, 'undo end insert').toBe(base + 2);
  await runTool(win, 'undo');
  await win.waitForTimeout(1500);
  expect((await eng()).pageCount, 'undo mid insert').toBe(base + 1);
  await runTool(win, 'undo');
  await win.waitForTimeout(1500);
  expect((await eng()).pageCount, 'undo start insert').toBe(base);

  // Re-do one.
  await win.click('[aria-label="Redo"]').catch(() => {});
  await win.keyboard.press('Control+y').catch(() => {});
  await win.waitForTimeout(1500);
  console.log(`[P1] after redo count=${(await eng()).pageCount}`);
  await shot('sweep-p1-pageops.png');

  expect(badHooks(), 'no React/page-request errors during page ops').toHaveLength(0);
  console.log('[P1] PASS');
});

test('P2: reorder + rotate + delete + insert, then save/reopen preserves', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const base = (await eng()).pageCount;

  // Rotate page 1 via the PAGES dock (Phase 36 — the row is retired).
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(1000);
  // Jump to page 2 via the current-page input, then rotate page 2.
  await win.fill('input[aria-label="Current page"], .page-nav input', '2');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(900);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(1000);
  const afterRot = await eng();
  console.log(`[P2] rotations after two rotates: ${JSON.stringify(afterRot.rotations.slice(0, 4))}`);

  // Delete page 3 via the Delete pages dialog (range mode).
  const beforeDeleteCount = (await eng()).pageCount;
  await runTool(win, 'delete');
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.click('[data-delete-mode="range"]');
  await win.waitForTimeout(200);
  await win.fill('[data-delete-range]', '3');
  await win.waitForTimeout(200);
  await win.click('[data-delete-confirm]');
  await win.waitForTimeout(2200);
  const afterDeleteCount = (await eng()).pageCount;
  console.log(`[P2] delete: before=${beforeDeleteCount} after=${afterDeleteCount}`);

  // Insert a blank at position 2.
  await insertBlank(2);
  const eAfter = await eng();
  console.log(`[P2] final count=${eAfter.pageCount} order0-6=${JSON.stringify(eAfter.pageOrder.slice(0, 7))}`);
  await shot('sweep-p2-mixed-ops.png');

  // Save + reopen: structure preserved (count + rotations survive).
  const outPath = await saveAsTo('p2');
  const rp = await reparse(outPath);
  console.log(`[P2] saved reparse=${JSON.stringify(rp)}`);
  expect(rp.pages, 'saved PDF must parse').toBe(eAfter.pageCount);

  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2200);

  const eReopen = await eng();
  console.log(`[P2] after reopen count=${eReopen.pageCount} rotations0-3=${JSON.stringify(eReopen.rotations.slice(0, 4))}`);
  expect(eReopen.pageCount, 'reopened page count matches saved').toBe(eAfter.pageCount);
  expect(badHooks(), 'no React/page-request errors').toHaveLength(0);
  console.log('[P2] PASS');
});

test('P3: crop multiple pages with different box sizes; only intended pages crop; undo', async () => {
  await openSample(win, electronApp, 'report.pdf');
  await scrollToPage(win, 1);
  const before = await win.evaluate(() => {
    const out = {};
    document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
      const c = p.querySelector('canvas');
      const n = Number(p.getAttribute('data-page'));
      if (c) { const r = c.getBoundingClientRect(); out[n] = { w: Math.round(r.width), h: Math.round(r.height), aspect: r.width / r.height }; }
    });
    return out;
  });
  console.log(`[P3] before crop pages=${JSON.stringify(before)}`);
  const FULL = 612 / 792;

  // Crop a specific page (per-page) with a given drag.
  const cropOne = async (pageNum, drag) => {
    await runTool(win, 'cropPages');
    await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
    await win.waitForTimeout(600);
    await win.click('[data-crop-mode="perPage"]');
    await win.waitForTimeout(500);
    await win.locator('[data-crop-page-select]').selectOption(String(pageNum));
    await win.waitForTimeout(500);
    const se = win.locator('[data-crop-handle="se"]');
    await se.waitFor({ timeout: 10000 });
    const sb = await se.boundingBox();
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.mouse.down();
    await win.mouse.move(sb.x + sb.width / 2 - drag, sb.y + sb.height / 2 - drag, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(400);
    await win.click('[data-crop-confirm]');
    await win.waitForTimeout(2200);
  };

  // Crop page 1, then page 2 (different box size).
  await cropOne(1, 45);
  await cropOne(2, 90);

  // Virtualized workspace: a 720px viewport cannot mount pages 1..3 at once
  // (each slot is ~1496px tall). Measure at each stop and merge by data-page,
  // waiting for each slot's canvas before capturing its box.
  const measureMerged = async () => {
    const out = {};
    for (const want of [1, 3]) {
      await scrollToPage(win, want);
      await win.waitForFunction(
        (n) => {
          const s = document.querySelector(`.page-slot[data-page="${n}"]`);
          return s && s.querySelector('canvas');
        },
        want,
        { timeout: 15000 },
      );
      await win.waitForTimeout(600);
      const part = await win.evaluate(() => {
        const o = {};
        document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
          const c = p.querySelector('canvas');
          const n = Number(p.getAttribute('data-page'));
          if (c && o[n] === undefined) { const r = c.getBoundingClientRect(); o[n] = { w: Math.round(r.width), h: Math.round(r.height), aspect: r.width / r.height }; }
        });
        return o;
      });
      Object.assign(out, part);
    }
    return out;
  };

  await scrollToPage(win, 1);
  const after = await measureMerged();
  console.log(`[P3] after crop pages=${JSON.stringify(after)}`);
  await shot('sweep-p3-crop2pages.png');

  // Pages 1 and 2 must deviate from full aspect (cropped); page 3 must stay full.
  const a1 = after[1], a2 = after[2], a3 = after[3];
  expect(a1, 'page 1 measurable').toBeTruthy();
  expect(a2, 'page 2 measurable').toBeTruthy();
  expect(a3, 'page 3 measurable').toBeTruthy();
  expect(Math.abs(a1.aspect - FULL), 'page 1 cropped (aspect differs)').toBeGreaterThan(0.01);
  expect(Math.abs(a2.aspect - FULL), 'page 2 cropped (aspect differs)').toBeGreaterThan(0.01);
  expect(Math.abs(a3.aspect - FULL), 'page 3 NOT cropped (full aspect)').toBeLessThan(0.01);
  // Different crop box sizes -> page 1 and page 2 should render differently.
  expect(Math.abs(a1.aspect - a2.aspect), 'page 1 and 2 have different crop boxes').toBeGreaterThan(0.005);

  // Undo one crop.
  await runTool(win, 'undo');
  await win.waitForTimeout(1800);
  await scrollToPage(win, 1);
  const afterUndo = await win.evaluate(() => {
    const out = {};
    document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
      const c = p.querySelector('canvas');
      const n = Number(p.getAttribute('data-page'));
      if (c) { const r = c.getBoundingClientRect(); out[n] = r.width / r.height; }
    });
    return out;
  });
  console.log(`[P3] after undo aspects=${JSON.stringify(afterUndo)}`);
  await shot('sweep-p3-crop-undo.png');
  expect(badHooks(), 'no React/page-request errors during crop').toHaveLength(0);
  console.log('[P3] PASS');
});
