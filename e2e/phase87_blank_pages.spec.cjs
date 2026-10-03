// Phase 87 (FEA-039) phase-validation e2e (qa) - remove blank pages.
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs); the real PAGES ContextPanel
// action opens the dialog and every assertion is on LIVE ENGINE STATE
// (`window.tflex.engine.getState` / `exportText`) and the DOM - never pixels.
//
// PHASE-GATE PROCEDURE: this spec drives the built renderer, so the gate MUST
// rebuild dist/ BEFORE the run or a stale bundle can pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase87_blank_pages.spec.cjs
//
// FIXTURE: 4 pages. Page 1 "ONE", page 2 TRULY BLANK (no draw calls), page 3
// "THREE", page 4 "FOUR", drawn in a StandardFont (Helvetica). The text is
// drawn LARGE (size 96) so a content page's ink coverage clearly exceeds the
// 0.005 default threshold - the brief fixes the words, not the type size, and a
// single small word would sit below 0.5% ink and blur the blank/content
// boundary the criteria depend on.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `p87-userdata-${Date.now()}`);
const TMP = path.join(os.tmpdir(), 'p87-blank-pages');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FIXTURE = path.join(TMP, 'p87-main.pdf');
const SAVED = path.join(TMP, 'p87-saved.pdf');
const CANCEL_FIXTURE = path.join(TMP, 'p87-cancel.pdf');

const log = (label, obj) => console.log(`[p87|${label}] ${JSON.stringify(obj)}`);
const shot = (name) => path.join(SHOTS, name);

// 4-page fixture: only page 2 has no draw calls at all (a true blank page).
// Words drawn at 96pt in Helvetica so content pages carry well over 0.5% ink.
async function buildFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const words = ['ONE', '', 'THREE', 'FOUR'];
  for (const word of words) {
    const page = doc.addPage([612, 792]);
    if (word !== '') {
      page.drawText(word, { x: 72, y: 600, size: 96, font, color: rgb(0, 0, 0) });
    }
  }
  fs.writeFileSync(FIXTURE, await doc.save());
}

// A long document so a raster sweep stays in-flight long enough to exercise
// `[data-blank-scan-cancel]`. Every page carries text so the render is not
// trivial; the cancel path must delete nothing.
async function buildCancelFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 60; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`PAGE ${i + 1}`, { x: 72, y: 600, size: 96, font, color: rgb(0, 0, 0) });
  }
  fs.writeFileSync(CANCEL_FIXTURE, await doc.save());
}

let app = null;
let win = null;
const consoleLog = [];

test.beforeAll(async () => {
  await buildFixture();
  await buildCancelFixture();
});

test.beforeEach(async () => {
  consoleLog.length = 0;
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p87');
  app = null;
  win = null;
});

test.setTimeout(900000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const welcome = win.locator('button:has-text("Open PDF")').first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
  } else {
    const cmd = win.locator('[aria-label="Open PDF document"]').first();
    if (await cmd.isVisible().catch(() => false)) await cmd.click();
    else await win.keyboard.press('Control+o');
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// PAGES ContextPanel is the home of [data-blank-scan-open]; expand the panel
// and force the PAGES stage before awaiting the control.
async function openPagesPanel() {
  await ensurePanelExpanded(win);
  await gotoStage(win, 1);
  await win.locator('[data-blank-scan-open]:visible').first().waitFor({ state: 'visible', timeout: 20000 });
}

async function openDialog() {
  await win.locator('[data-blank-scan-open]:visible').first().click();
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'visible', timeout: 10000 });
}

async function closeDialog() {
  const close = win.locator('[data-blank-pages-dialog] .modal-footer button:has-text("Close")');
  if (await close.count()) await close.first().click();
  else await win.keyboard.press('Escape');
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

async function setThreshold(value) {
  const input = win.locator('[data-blank-scan-threshold]');
  await input.fill(String(value));
  await win.waitForTimeout(150);
}

async function runScan() {
  await win.locator('[data-blank-scan-run]').click();
  await win.waitForFunction(() => {
    const running = document.querySelector('[data-blank-scan-progress]');
    const report = document.querySelector('[data-blank-scan-report]');
    return running === null && report !== null;
  }, undefined, { timeout: 120000 });
  await win.waitForTimeout(200);
}

async function candidatePages() {
  return win.$$eval('[data-blank-candidate]', (els) =>
    els.map((e) => Number(e.getAttribute('data-blank-candidate'))),
  );
}

async function readReport() {
  const el = win.locator('[data-blank-scan-report]');
  if (!(await el.count())) return '';
  return (await el.innerText()).trim();
}

async function enginePageCount(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.getState(id);
    return r.ok ? r.value.pageCount : { error: r.error };
  }, docId);
}

async function engineText(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return { error: r.error };
    return { pages: r.value };
  }, docId);
}

const allText = (pages) => (pages || []).map((p) => p.text).join('\n');
const count = (hay, term) => (hay.match(new RegExp(term, 'g')) || []).length;

async function saveAs(savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2600);
}

// ---------------------------------------------------------------------------
// Criteria 1-5: open -> scan -> single candidate -> remove -> save/reload ->
// boundary scan with no blank pages left.
// ---------------------------------------------------------------------------
test('P87-CORE: one blank candidate removed, survivors intact through save/reload, boundary shows the empty state', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  expect(await enginePageCount(docId)).toBe(4);
  const prePages = (await engineText(docId)).pages;
  const before = allText(prePages);
  log('before-pages', prePages.map((p, i) => `p${i + 1}:${JSON.stringify(p.text)}`));
  // The main-process `exportText` raw-PDF extractor mis-attributes the page
  // AFTER a truly blank page (pdf.js itself reports page 2 as ""; the extractor
  // returns page 3's text there). Page 2's ink is proven by the SCAN below
  // (pdf.js raster), so the pre-removal oracle only pins the unambiguous ends.
  expect(count(before, 'ONE')).toBe(1);
  expect(count(before, 'FOUR')).toBe(1);

  // Criterion 1 - the PAGES surface control opens the dialog.
  await openPagesPanel();
  await openDialog();
  expect(await win.locator('[data-blank-pages-dialog]').isVisible()).toBe(true);
  expect(await win.locator('[data-blank-scan-threshold]').inputValue()).toBe('0.005');

  // Criterion 2 - threshold 0.005 yields exactly the blank page as candidate.
  await setThreshold(0.005);
  await runScan();
  const report = await readReport();
  const candidates = await candidatePages();
  log('scan-report', report);
  log('scan-candidates', candidates);
  expect(candidates).toEqual([2]);
  expect(await win.locator('[data-blank-candidate]').first().innerText()).toContain('Page 2');
  expect(report.length).toBeGreaterThan(0);
  expect(report).toContain('1 candidate');
  expect(report).toContain('0 unclassified');
  await win.screenshot({ path: shot('phase87_dialog_candidates.png') });

  // Criterion 3 - confirm removes page 2 only; survivors keep their text.
  const confirm = win.locator('[data-blank-scan-confirm]');
  expect(await confirm.isEnabled()).toBe(true);
  await confirm.click();
  await win.waitForFunction(
    () => window.tflexDiagnostics().pageCount === 3,
    undefined,
    { timeout: 30000 },
  );
  await win.waitForTimeout(1500);
  expect(await enginePageCount(docId)).toBe(3);
  const afterPages = (await engineText(docId)).pages || [];
  const after = allText(afterPages);
  log('exportText-after-removal', afterPages.map((p, i) => `p${i + 1}:${p.text}`));
  // Survivor CONTENT is present in the extraction; the exact page-count
  // requirement is asserted at the very end so the remaining criteria and the
  // save/reload integrity check still run (the page count is the defect item).
  expect(count(after, 'ONE')).toBeGreaterThanOrEqual(1);
  expect(count(after, 'THREE')).toBeGreaterThanOrEqual(1);
  expect(count(after, 'FOUR')).toBeGreaterThanOrEqual(1);
  const removalReport = await readReport();
  log('removal-report', removalReport);
  expect(removalReport).toContain('Removed 1 page');

  // Canvas after removal (dialog closed so the workspace is unobscured).
  await closeDialog();
  await win.screenshot({ path: shot('phase87_after_removal.png') });

  // Criterion 4 - the removal is real saved output: save, reopen, re-probe.
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  await openFixture(SAVED);
  const d2 = await diag();
  const docId2 = d2.engineDocId;
  expect(await enginePageCount(docId2)).toBe(3);
  const reopenedPages = (await engineText(docId2)).pages || [];
  const reopened = allText(reopenedPages);
  log('exportText-after-reload', reopenedPages.map((p, i) => `p${i + 1}:${p.text}`));
  expect(reopenedPages.length).toBe(3);
  expect(count(reopened, 'ONE')).toBe(1);
  expect(count(reopened, 'THREE')).toBe(1);
  expect(count(reopened, 'FOUR')).toBe(1);

  // Criterion 5 - with no blank pages left, a scan yields zero candidates and
  // the dialog's no-blank-pages empty state. NOTE: the brief says "raise the
  // threshold above the measured coverage" to reach this state, but the
  // classifier marks blank when coverage <= threshold, so zero candidates
  // requires the threshold BELOW every content page's coverage; the meaningful
  // boundary scan is therefore at the 0.005 default on the survivor document.
  await openPagesPanel();
  await openDialog();
  await setThreshold(0.005);
  await runScan();
  log('boundary-candidates', await candidatePages());
  expect(await candidatePages()).toEqual([]);
  const emptyReport = await readReport();
  log('boundary-report', emptyReport);
  expect(emptyReport).toBe('No blank pages found.');
  await closeDialog();

  // Criterion 3 (page count): exportText must reflect the removal. It does NOT:
  // `_exportTextImpl` serialises `doc.pdfDoc` directly and ignores
  // `doc.order`/`doc.deleted`, so the deleted blank page is still returned
  // (4 pages). This is the defect recorded in DEFECTS.md.
  expect(afterPages.length).toBe(3);
});

// ---------------------------------------------------------------------------
// Criterion 6: cancel while a scan is in flight closes the dialog and deletes
// nothing. The 60-page fixture keeps the sweep running long enough to click.
// ---------------------------------------------------------------------------
test('P87-CANCEL: cancel while scanning closes the dialog and deletes nothing', async () => {
  await openFixture(CANCEL_FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  expect(await enginePageCount(docId)).toBe(60);
  await openPagesPanel();
  await openDialog();
  await setThreshold(0.005);
  await win.locator('[data-blank-scan-run]').click();
  const cancel = win.locator('[data-blank-scan-cancel]');
  await cancel.waitFor({ state: 'visible', timeout: 15000 });
  await cancel.click();
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(1500);
  expect(await win.locator('[data-blank-pages-dialog]').count()).toBe(0);
  expect(await enginePageCount(docId)).toBe(60);
});

// ---------------------------------------------------------------------------
// Criterion 7: CONTROL-INDEX - every `[data-blank-scan-*]` / candidate control
// exists and performs its promised action.
// ---------------------------------------------------------------------------
test('P87-CONTROL-INDEX: each control exists and performs its promised action', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  // [data-blank-scan-open] opens the dialog.
  await openPagesPanel();
  const openBtn = win.locator('[data-blank-scan-open]');
  expect(await openBtn.count()).toBe(1);
  await openBtn.click();
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'visible', timeout: 10000 });
  expect(await win.locator('[data-blank-pages-dialog]').isVisible()).toBe(true);

  // [data-blank-scan-threshold] is editable and holds the typed value.
  const threshold = win.locator('[data-blank-scan-threshold]');
  expect(await threshold.count()).toBe(1);
  await threshold.fill('0.01');
  expect(await threshold.inputValue()).toBe('0.01');
  await threshold.fill('0.005');

  // [data-blank-scan-confirm] exists; disabled before any selection.
  const confirm = win.locator('[data-blank-scan-confirm]');
  expect(await confirm.count()).toBe(1);
  expect(await confirm.isDisabled()).toBe(true);

  // [data-blank-scan-run] runs the scan.
  const run = win.locator('[data-blank-scan-run]');
  expect(await run.count()).toBe(1);
  await run.click();
  await win.waitForFunction(() => {
    const running = document.querySelector('[data-blank-scan-progress]');
    const report = document.querySelector('[data-blank-scan-report]');
    return running === null && report !== null;
  }, undefined, { timeout: 120000 });

  // [data-blank-scan-report] is non-empty after the scan.
  const report = win.locator('[data-blank-scan-report]');
  expect(await report.count()).toBe(1);
  expect((await report.innerText()).trim().length).toBeGreaterThan(0);

  // [data-blank-candidate] names the page and defaults to checked; the confirm
  // label tracks the checked set.
  const candidates = win.locator('[data-blank-candidate]');
  expect(await candidates.count()).toBe(1);
  expect(await candidates.first().innerText()).toContain('Page 2');
  const box = candidates.first().locator('input[type=checkbox]');
  expect(await box.isChecked()).toBe(true);
  expect(await confirm.isEnabled()).toBe(true);
  await box.uncheck();
  expect(await confirm.isDisabled()).toBe(true);
  await box.check();
  expect(await confirm.isEnabled()).toBe(true);

  // [data-blank-scan-cancel] only renders while running; clicking it closes the
  // dialog without removing anything.
  await run.click();
  const cancel = win.locator('[data-blank-scan-cancel]');
  await cancel.waitFor({ state: 'visible', timeout: 15000 });
  expect(await cancel.count()).toBe(1);
  await cancel.click();
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'detached', timeout: 8000 });

  // Reopen/close proves the open control is reusable and nothing was removed.
  await openDialog();
  await closeDialog();
  expect(await enginePageCount(docId)).toBe(4);
});

// ---------------------------------------------------------------------------
// UNCLASSIFIED / REFUSAL. The engine's all-or-nothing refusal is exercised
// through the LIVE engine here (stronger than the unit proof). The renderer's
// raster-failure -> unclassified path cannot be forced through the real UI, so
// that UI-level item is reported INCONCLUSIVE, never faked.
// ---------------------------------------------------------------------------
test('P87-REFUSAL: live engine refuses out-of-range and delete-everything sets', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  const outOfRange = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.removeBlankPages(id, { pages: [99] });
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, docId);
  log('refusal-out-of-range', outOfRange);
  expect(outOfRange.ok).toBe(false);
  expect(outOfRange.code).toBe('out-of-range');

  const all = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.removeBlankPages(id, { pages: [1, 2, 3, 4] });
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, docId);
  log('refusal-all-pages', all);
  expect(all.ok).toBe(false);
  expect(all.code).toBe('empty-range');
  expect(await enginePageCount(docId)).toBe(4);

  log(
    'unclassified-ui',
    'INCONCLUSIVE: a raster failure cannot be forced through the real UI (the dialog only submits classified, in-range candidates); the unclassified path is unit-proven in phase87BlankScan.test.ts.',
  );
});
