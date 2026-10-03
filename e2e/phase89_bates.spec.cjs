// Phase 89 (FEA-033) phase-validation e2e (qa) - Bates numbering.
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs). The REVIEW Action Dock
// verb [data-dock-verb="bates"] opens the Bates dialog; every assertion is on
// LIVE ENGINE STATE (`window.tflex.engine.getState` / `exportText`) and the
// DOM - never pixels.
//
// PHASE-GATE PROCEDURE: this spec drives the built renderer, so the gate MUST
// rebuild dist/ BEFORE the run or a stale bundle can false-pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase89_bates.spec.cjs
//
// FIXTURE: 4 pages, each carrying a distinct LARGE word (Helvetica 72pt) so
// the raw-PDF text extractor can map text back to its page. No page is blank,
// so the extractor's blank-page mis-attribution (phase87) cannot apply here.
//
// STRUCTURE (one behaviour per test so the phase verdict is criterion-mapped):
//   P89-CORE          configure+apply+per-page extraction (report via history)
//   P89-REPORT        the [data-bates-report] contract after an apply (DEF)
//   P89-RELOAD        save/reopen integrity of the stamp
//   P89-REFUSAL       engine typed refusals + UI unencodable refusal
//   P89-UNDO          one undo restores the pre-stamp text
//   P89-CONTROL-INDEX every [data-bates-*] control + dock verb
//   P89-OFFLINE       no network primitive added
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, clickDockVerb } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'p89-bates');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FIXTURE = path.join(TMP, 'p89-main.pdf');
const SAVED = path.join(TMP, 'p89-saved.pdf');

const WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
const PREFIX = 'BATES-';
const START = 7;
const PADDING = 5;
const LABEL_P2 = 'BATES-00007';
const LABEL_P3 = 'BATES-00008';
const UNSELECTED = [1, 4];

const log = (label, obj) => console.log(`[p89|${label}] ${JSON.stringify(obj)}`);
const shot = (name) => path.join(SHOTS, name);

async function buildFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const word of WORDS) {
    const page = doc.addPage([612, 792]);
    page.drawText(word, { x: 72, y: 600, size: 72, font, color: rgb(0, 0, 0) });
  }
  fs.writeFileSync(FIXTURE, await doc.save());
}

let app = null;
let win = null;
let userData = null;
const consoleLog = [];

test.beforeAll(async () => {
  await buildFixture();
});

test.beforeEach(async () => {
  consoleLog.length = 0;
  // Fresh profile per test so AppSettings.batesDefaults starts at its defaults
  // (the first-use case the report contract must survive).
  userData = path.join(os.tmpdir(), `p89-userdata-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  app = await launchApp([], userData);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p89');
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

// REVIEW is stage 3 (Ctrl+3). The dock verb is the ONLY open control; it may
// spill into the "More" overflow on a narrow window, so clickDockVerb picks
// the lane and returns which one it used.
async function openBatesDialog() {
  await ensurePanelExpanded(win);
  await gotoStage(win, 3);
  await win.waitForTimeout(300);
  const inlineCount = await win.locator('[data-dock-verb="bates"]').count();
  const lane = await clickDockVerb(win, 3, 'bates');
  await win.waitForSelector('[data-bates-dialog]', { state: 'visible', timeout: 10000 });
  log('open-control', { inlineCount, lane });
  return { lane, inlineCount };
}

async function closeDialog() {
  const close = win.locator('[data-bates-dialog] .modal-close, [data-bates-dialog] .modal-footer button:has-text("Cancel")');
  if (await close.count()) await close.first().click();
  else await win.keyboard.press('Escape');
  await win.waitForSelector('[data-bates-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

async function configureAndApply({ prefix = PREFIX, start = START, padding = PADDING, from = 2, to = 3, clickApply = true } = {}) {
  await win.locator('[data-bates-prefix]').fill(prefix);
  await win.locator('[data-bates-start]').fill(String(start));
  await win.locator('[data-bates-padding]').fill(String(padding));
  await win.locator('[data-bates-position="top-left"]').click();
  await win.locator('[data-bates-range-all]').uncheck();
  await win.locator('[data-bates-range-from]').fill(String(from));
  await win.locator('[data-bates-range-to]').fill(String(to));
  await win.waitForTimeout(200);
  if (clickApply) await win.locator('[data-bates-apply]').click();
}

async function readReport() {
  const el = win.locator('[data-bates-report]');
  if (!(await el.count())) return '';
  return (await el.innerText()).trim();
}

// Record every [data-bates-report] text transition so a test can distinguish
// "the success/refusal text was produced" from "the report never updated".
async function installReportObserver() {
  await win.evaluate(() => {
    const el = document.querySelector('[data-bates-report]');
    window.__p89log = [el ? el.textContent : null];
    const obs = new MutationObserver(() => {
      window.__p89log.push(el ? el.textContent : null);
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

async function reportHistory() {
  return win.evaluate(() => window.__p89log || []);
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

const pageText = (pages, n) => {
  const p = (pages || []).find((x) => x.pageIndex === n);
  return p ? p.text : '';
};
const has = (hay, term) => (hay || '').includes(term);

// Poll live engine text until page `n` contains `term` (the apply is async).
async function waitForPageText(docId, n, term, timeout = 30000) {
  await win.waitForFunction(async ({ id, pn, t }) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return false;
    const p = r.value.find((x) => x.pageIndex === pn);
    return !!p && p.text.includes(t);
  }, { id: docId, pn: n, t: term }, { timeout });
}

async function waitForPageTextGone(docId, n, term, timeout = 30000) {
  await win.waitForFunction(async ({ id, pn, t }) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return false;
    const p = r.value.find((x) => x.pageIndex === pn);
    return !!p && !p.text.includes(t);
  }, { id: docId, pn: n, t: term }, { timeout });
}

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

// Undo through the real Ctrl+Z accelerator (native menu -> dispatchMenuAction
// -> engine undo), the same path a user takes.
async function uiUndo() {
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Criteria 1/2: configure -> apply -> per-page extraction. The apply is
// observed through the LIVE ENGINE (not the report), so this test proves the
// stamping pipeline even though the report contract is broken (P89-REPORT).
// ---------------------------------------------------------------------------
test('P89-CORE: configure+apply a subset; labels land on exactly the selected pages', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  expect(await enginePageCount(docId)).toBe(4);
  const pre = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(pageText(pre, n)).toContain(WORDS[n - 1]);

  // The REVIEW dock verb opens the dialog; opening alone stamps nothing.
  const open = await openBatesDialog();
  log('core-open-lane', open);
  expect(await win.locator('[data-bates-dialog]').isVisible()).toBe(true);
  expect(await win.locator('[data-bates-start]').inputValue()).toBe('1');
  expect(await win.locator('[data-bates-padding]').inputValue()).toBe('6');
  expect(await win.locator('[data-bates-position="bottom-right"]').getAttribute('aria-pressed')).toBe('true');
  const afterOpen = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(has(pageText(afterOpen, n), PREFIX)).toBe(false);

  await configureAndApply({ clickApply: false });
  await win.screenshot({ path: shot('phase89_dialog_values.png') });
  await installReportObserver();
  const t0 = Date.now();
  await win.locator('[data-bates-apply]').click();
  // Wait on live engine content: proves the op completed without trusting the
  // report (which is reset by a re-seed effect - see P89-REPORT).
  await waitForPageText(docId, 2, LABEL_P2);
  log('apply-elapsed-ms', Date.now() - t0);
  await win.screenshot({ path: shot('phase89_applied_report.png') });

  // Criterion 1: the success text with count + labels WAS produced.
  const history = await reportHistory();
  log('core-report-history', history);
  expect(history.join(' | ')).toContain('2 pages stamped');
  expect(history.join(' | ')).toContain(LABEL_P2);
  expect(history.join(' | ')).toContain(LABEL_P3);

  // Criterion 2: labels on exactly the selected pages; others byte-untouched.
  const post = (await engineText(docId)).pages;
  log('post-apply-pages', post.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(post, 2)).toContain(LABEL_P2);
  expect(pageText(post, 3)).toContain(LABEL_P3);
  for (const n of UNSELECTED) {
    expect(has(pageText(post, n), PREFIX)).toBe(false);
    expect(pageText(post, n)).toBe(pageText(pre, n));
  }
  // Responsiveness observation on the 4-page fixture (not a perf re-time).
  const rt = Date.now();
  await win.evaluate(() => document.title);
  log('post-apply-responsive-ms', Date.now() - rt);
});

// ---------------------------------------------------------------------------
// The [data-bates-report] contract. A successful apply must leave the report
// showing "N pages stamped" + the labels; an unencodable apply must leave the
// refusal text. The observed behaviour resets it to "Not applied yet.".
// ---------------------------------------------------------------------------
test('P89-REPORT: [data-bates-report] keeps the success count+labels after an apply (and the refusal text)', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  await openBatesDialog();
  await installReportObserver();
  await configureAndApply();
  // The op genuinely completes (live engine), then observe the report.
  await waitForPageText(docId, 3, LABEL_P3);
  await win.waitForTimeout(1500);

  const history = await reportHistory();
  log('report-history', history);
  const current = await readReport();
  log('report-current', current);
  await win.screenshot({ path: shot('phase89_report_after_apply.png') });

  // The promised contract: the report names the count and labels after apply.
  expect.soft(history.some((t) => t && t.includes('2 pages stamped') && t.includes(LABEL_P2))).toBe(true);
  expect.soft(current).toContain('2 pages stamped');
  expect.soft(current).toContain(LABEL_P2);

  // Refusal contract: an unencodable prefix leaves the readable error text.
  await win.locator('[data-bates-prefix]').fill('\u6f22');
  await win.locator('[data-bates-apply]').click();
  await win.waitForTimeout(4000);
  const refusalHistory = await reportHistory();
  const refusalCurrent = await readReport();
  log('refusal-report-history', refusalHistory);
  log('refusal-report-current', refusalCurrent);
  expect.soft(refusalHistory.some((t) => t && /encode/i.test(t))).toBe(true);
  expect.soft(refusalCurrent.toLowerCase()).toContain('encode');
});

// ---------------------------------------------------------------------------
// Criterion 2b: the stamp is real saved page content - save, reopen, re-extract.
// ---------------------------------------------------------------------------
test('P89-RELOAD: labels survive save + reopen on exactly their pages', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  await openBatesDialog();
  await configureAndApply();
  await waitForPageText(docId, 2, LABEL_P2);
  await closeDialog();

  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  await openFixture(SAVED);
  const d2 = await diag();
  const docId2 = d2.engineDocId;
  expect(await enginePageCount(docId2)).toBe(4);
  const reloaded = (await engineText(docId2)).pages;
  log('post-reload-pages', reloaded.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(reloaded, 2)).toContain(LABEL_P2);
  expect(pageText(reloaded, 3)).toContain(LABEL_P3);
  for (const n of UNSELECTED) {
    expect(has(pageText(reloaded, n), PREFIX)).toBe(false);
    expect(pageText(reloaded, n)).toContain(WORDS[n - 1]);
  }
  await win.screenshot({ path: shot('phase89_post_reload.png') });
});

// ---------------------------------------------------------------------------
// Criterion 3: fail-loud. Engine typed refusals are all-or-nothing; the UI
// unencodable refusal changes nothing (its report text is covered by
// P89-REPORT); an invalid range disables apply.
// ---------------------------------------------------------------------------
test('P89-REFUSAL: empty/duplicate/out-of-range refuse and change nothing; unencodable prefix changes nothing', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  const pre = (await engineText(docId)).pages;

  const callAddBates = (settings) => win.evaluate(async ({ id, s }) => {
    const r = await window.tflex.engine.addBates(id, s);
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, { id: docId, s: settings });

  const base = { prefix: PREFIX, suffix: '', startNumber: 1, padding: 6, position: 'bottom-right' };
  const empty = await callAddBates({ ...base, pages: [] });
  const dup = await callAddBates({ ...base, pages: [2, 2] });
  const oor = await callAddBates({ ...base, pages: [99] });
  log('refusals', { empty, dup, oor });
  expect(empty.ok).toBe(false);
  expect(empty.code).toBe('empty-range');
  expect(dup.ok).toBe(false);
  expect(dup.code).toBe('out-of-range');
  expect(oor.ok).toBe(false);
  expect(oor.code).toBe('out-of-range');

  expect(await enginePageCount(docId)).toBe(4);
  const afterEngine = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(pageText(afterEngine, n)).toBe(pageText(pre, n));

  // UI unencodable prefix: the whole op is refused; the document is unchanged.
  await openBatesDialog();
  await installReportObserver();
  await win.locator('[data-bates-prefix]').fill('\u6f22');
  await win.locator('[data-bates-range-all]').uncheck();
  await win.locator('[data-bates-range-from]').fill('2');
  await win.locator('[data-bates-range-to]').fill('3');
  await win.locator('[data-bates-apply]').click();
  await win.waitForTimeout(4000);
  const history = await reportHistory();
  log('refusal-history', history);
  expect(history.some((t) => t && /encode/i.test(t))).toBe(true);
  const afterUi = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(pageText(afterUi, n)).toBe(pageText(pre, n));
  await win.screenshot({ path: shot('phase89_refusal.png') });

  // UI invalid range: apply disabled, hint explains the bound. The dialog
  // re-seeded to "All pages" after the refusal (rangeAll true), so uncheck it.
  await win.locator('[data-bates-range-all]').uncheck();
  await win.locator('[data-bates-range-from]').fill('5');
  await win.locator('[data-bates-range-to]').fill('5');
  await win.waitForTimeout(200);
  expect(await win.locator('[data-bates-apply]').isDisabled()).toBe(true);
  expect(await win.locator('[data-bates-dialog] .modal-hint').first().isVisible()).toBe(true);
});

// ---------------------------------------------------------------------------
// Undo: the whole Bates run is ONE undo entry; Ctrl+Z restores the pre-stamp
// text (the stamp is content, not an annotation).
// ---------------------------------------------------------------------------
test('P89-UNDO: one undo restores the pre-stamp text after an apply', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  const pre = (await engineText(docId)).pages;

  await openBatesDialog();
  await configureAndApply();
  await waitForPageText(docId, 3, LABEL_P3);
  await closeDialog();

  await uiUndo();
  await waitForPageTextGone(docId, 2, LABEL_P2);
  const undone = (await engineText(docId)).pages;
  log('post-undo-pages', undone.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  for (let n = 1; n <= 4; n += 1) {
    expect(has(pageText(undone, n), PREFIX)).toBe(false);
    expect(pageText(undone, n)).toContain(WORDS[n - 1]);
  }
  expect(pageText(undone, 2)).toBe(pageText(pre, 2));
  expect(pageText(undone, 3)).toBe(pageText(pre, 3));
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX sweep: every [data-bates-*] control exists and performs its
// promised action. The dock verb is the open control (no data-bates-open).
// One apply drives exactly the engine.addBates path (the single-call nature is
// also proven by P89-UNDO: one Ctrl+Z reverses the whole run = one undo entry).
// ---------------------------------------------------------------------------
test('P89-CONTROL-INDEX: each control exists and performs its promised action', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  const open = await openBatesDialog();
  expect(open.inlineCount + (open.lane.startsWith('overflow') ? 1 : 0)).toBeGreaterThan(0);
  expect(await win.locator('[data-bates-dialog]').isVisible()).toBe(true);

  const prefix = win.locator('[data-bates-prefix]');
  const suffix = win.locator('[data-bates-suffix]');
  await prefix.fill('ABC-');
  expect(await prefix.inputValue()).toBe('ABC-');
  await suffix.fill('-END');
  expect(await suffix.inputValue()).toBe('-END');

  const start = win.locator('[data-bates-start]');
  const padding = win.locator('[data-bates-padding]');
  await start.fill('10');
  expect(await start.inputValue()).toBe('10');
  await padding.fill('3');
  expect(await padding.inputValue()).toBe('3');

  expect(await win.locator('[data-bates-position]').count()).toBe(9);
  await win.locator('[data-bates-position="center"]').click();
  expect(await win.locator('[data-bates-position="center"]').getAttribute('aria-pressed')).toBe('true');
  expect(await win.locator('[data-bates-position="bottom-right"]').getAttribute('aria-pressed')).toBe('false');

  expect(await win.locator('[data-bates-pages]').count()).toBe(1);
  const all = win.locator('[data-bates-range-all]');
  expect(await all.isChecked()).toBe(true);
  await all.uncheck();
  await win.locator('[data-bates-range-from]').fill('2');
  await win.locator('[data-bates-range-to]').fill('4');
  await win.waitForTimeout(200);
  expect(await win.locator('[data-bates-preview-range]').innerText()).toContain('3 pages');

  expect((await readReport()).length).toBeGreaterThan(0);
  const apply = win.locator('[data-bates-apply]');
  expect(await apply.isEnabled()).toBe(true);
  await installReportObserver();
  await apply.click();
  await waitForPageText(docId, 4, 'ABC-012-END');
  const historyJoined = (await reportHistory()).join(' | ');
  log('control-index-report-history', historyJoined);
  expect(historyJoined).toContain('3 pages stamped');
  expect(historyJoined).toContain('ABC-010-END');
  expect(historyJoined).toContain('ABC-012-END');

  // After the apply the dialog re-seeded to "All pages" (the report defect's
  // side effect), so uncheck it before typing the invalid range.
  await win.locator('[data-bates-range-all]').uncheck();
  await win.locator('[data-bates-range-from]').fill('4');
  await win.locator('[data-bates-range-to]').fill('2');
  await win.waitForTimeout(200);
  expect(await apply.isDisabled()).toBe(true);

  const stamped = (await engineText(docId)).pages;
  expect(pageText(stamped, 2)).toContain('ABC-010-END');
  expect(pageText(stamped, 3)).toContain('ABC-011-END');
  expect(pageText(stamped, 4)).toContain('ABC-012-END');
  expect(has(pageText(stamped, 1), 'ABC-')).toBe(false);
});

// ---------------------------------------------------------------------------
// Criterion 4: offline only. The Phase 89 change adds no network call: the
// pure shared model and the dialog touch no network primitive, and the engine
// op reuses the Phase 18 pdf-lib content-stream path.
// ---------------------------------------------------------------------------
test('P89-OFFLINE: the Phase 89 source adds no network primitive', async () => {
  const files = [
    path.join(ROOT, 'src', 'shared', 'bates.ts'),
    path.join(ROOT, 'src', 'renderer', 'components', 'BatesDialog.tsx'),
  ];
  const network = /(\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\bnet\.request|\bhttps?\.request|axios)/;
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const line of src.split(/\r?\n/)) {
      if (network.test(line)) hits.push(`${path.basename(f)}: ${line.trim()}`);
    }
  }
  log('offline-network-hits', hits);
  expect(hits).toEqual([]);
});
