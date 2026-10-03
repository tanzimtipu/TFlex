// Phase 90 (TFL-509) phase-validation e2e (qa) — Bates placement, edit/delete
// and the unified review-element inspector.
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs) + e2e/lib/helpers.cjs. All
// assertions are on LIVE ENGINE STATE (`window.tflex.engine.getState` /
// `exportText` / `getBates`) and the DOM — never pixels.
//
// PHASE-GATE PROCEDURE: drives the built renderer, so the gate MUST rebuild
// dist/ BEFORE the run or a stale bundle can false-pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase90_bates_inspector.spec.cjs
//
// GEOMETRY EVIDENCE: criterion 1 requires the DRAWN location to match the x/y
// payload, so after save the spec parses the saved PDF's page content stream
// (pdf-lib + zlib) exactly like the chunk-A QA unit probe, and asserts the
// `1 0 0 1 x y Tm` of the Bates run. This proves the baked geometry, not just
// the marker echo.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { inflateSync } = require('node:zlib');
const { PDFDocument, PDFArray, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, clickDockVerb } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'p90-bates');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FIXTURE = path.join(TMP, 'p90-main.pdf');
const PW = 612;
const PH = 792;

const WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'];
const PADDING = 6;
const CORNER_PREFIX = 'C-';
const GUTTER_PREFIX = 'G-';
const CORNER_LABEL = 'C-000001';
const GUTTER_LABEL = 'G-000001';
// Explicit placement payloads. The gutter x=20 is well inside the 10%
// horizontal margin (61.2pt) that the Phase 89 slot maths would clamp to.
const CORNER_XY = { x: 0, y: 0 };
const GUTTER_XY = { x: 20, y: 400 };

const log = (label, obj) => console.log(`[p90|${label}] ${JSON.stringify(obj)}`);
const shot = (name) => path.join(SHOTS, name);

async function buildFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const word of WORDS) {
    const page = doc.addPage([PW, PH]);
    page.drawText(word, { x: 72, y: 600, size: 72, font, color: rgb(0, 0, 0) });
  }
  fs.writeFileSync(FIXTURE, await doc.save());
}

let app = null;
let win = null;
let userData = null;

test.beforeAll(async () => {
  await buildFixture();
});

test.beforeEach(async () => {
  userData = path.join(os.tmpdir(), `p90-userdata-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  app = await launchApp([], userData);
  win = await app.firstWindow();
  win.on('pageerror', (e) => console.log(`[p90|pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p90');
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

// --- engine ops (live IPC) -------------------------------------------------
async function engineGetBates(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.getBates(id);
    return r.ok ? { runs: r.value } : { error: r.error };
  }, docId);
}

async function engineAddBates(docId, settings) {
  return win.evaluate(async ({ id, s }) => {
    const r = await window.tflex.engine.addBates(id, s);
    return r.ok ? { ok: true, stamped: r.value.stamped, labels: r.value.labels } : { ok: false, code: r.error.code, message: r.error.message };
  }, { id: docId, s: settings });
}

async function engineUpdateBates(docId, id, settings) {
  return win.evaluate(async ({ d, runId, s }) => {
    const r = await window.tflex.engine.updateBates(d, runId, s);
    return r.ok ? { ok: true, labels: r.value.labels } : { ok: false, code: r.error.code, message: r.error.message };
  }, { d: docId, runId: id, s: settings });
}

async function engineDeleteBates(docId, id) {
  return win.evaluate(async ({ d, runId }) => {
    const r = await window.tflex.engine.deleteBates(d, runId);
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, { d: docId, runId: id });
}

// --- Bates dialog helpers --------------------------------------------------
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

async function closeDialog(sel) {
  const close = win.locator(`${sel} .modal-close, ${sel} .modal-footer button:has-text("Cancel")`);
  if (await close.count()) await close.first().click();
  else await win.keyboard.press('Escape');
  await win.waitForSelector(sel, { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

async function setBatesScope(from, to) {
  await win.locator('[data-bates-range-all]').uncheck();
  await win.locator('[data-bates-range-from]').fill(String(from));
  await win.locator('[data-bates-range-to]').fill(String(to));
  await win.waitForTimeout(150);
}

// Configure an explicit-XY apply and click Apply (the single engine.addBates
// call the CONTROL-INDEX promises).
async function applyBatesXY({ prefix, padding = PADDING, x, y, from, to }) {
  await win.locator('[data-bates-prefix]').fill(prefix);
  await win.locator('[data-bates-padding]').fill(String(padding));
  await win.locator('[data-bates-custom-xy]').check();
  await win.locator('[data-bates-x]').fill(String(x));
  await win.locator('[data-bates-y]').fill(String(y));
  await setBatesScope(from, to);
  const mode = await win.locator('[data-bates-dialog]').getAttribute('data-bates-mode');
  await win.locator('[data-bates-apply]').click();
  return mode;
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

async function uiUndo() {
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(800);
}

// --- saved-PDF geometry decode (mirrors the chunk-A QA unit probe) ---------
function decodePageContent(doc, pageIndex) {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return '';
  const resolve = (r) => {
    let o = doc.context.lookup(r);
    while (o && o.constructor && o.constructor.name === 'PDFRef') o = doc.context.lookup(o);
    return o;
  };
  const read = (o) => {
    if (!o) return '';
    if (o.constructor && o.constructor.name === 'PDFArray' || o instanceof PDFArray) {
      let out = '';
      for (let i = 0; i < o.size(); i += 1) out += read(resolve(o.get(i)));
      return out;
    }
    if (o.contents) {
      try { return inflateSync(o.contents).toString('latin1'); }
      catch { return Buffer.from(o.contents).toString('latin1'); }
    }
    return '';
  };
  return read(resolve(contents));
}

function batesTm(content) {
  const idx = content.indexOf('%TFLEX-BATES');
  if (idx === -1) return null;
  const m = content.slice(idx).match(/1 0 0 1 (-?[0-9.]+) (-?[0-9.]+) Tm/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

function readSavedGeometry(filePath) {
  const doc = PDFDocument.load(fs.readFileSync(filePath));
  return doc.then((d) => ({
    p0: batesTm(decodePageContent(d, 0)),
    p3: batesTm(decodePageContent(d, 3)),
  }));
}

// --- review-list helpers ---------------------------------------------------
async function openReviewList() {
  await ensurePanelExpanded(win);
  await gotoStage(win, 3);
  await win.waitForTimeout(500);
  await win.waitForSelector('[data-context-panel] [data-review-elements]', { state: 'visible', timeout: 10000 });
}

const panelCategory = (category) =>
  win.locator(`[data-context-panel] [data-review-category="${category}"]`).first();

const panelRow = (type) =>
  win.locator(`[data-context-panel] [data-review-element-type="${type}"]`).first();

// --- theme helper ----------------------------------------------------------
async function setTheme(theme) {
  await win.locator('[data-theme-toggle]').click();
  await win.waitForSelector('[data-theme-option]', { state: 'visible', timeout: 8000 });
  await win.locator(`[data-theme-option="${theme}"]`).click();
  await win.waitForTimeout(600);
  const applied = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  log(`theme-${theme}`, applied);
  return applied;
}

async function scrollDialogToPreview() {
  const body = win.locator('[data-bates-dialog] .modal-body');
  if (await body.count()) {
    await body.first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await win.waitForTimeout(250);
  }
}

async function openWatermarkDialog() {
  await ensurePanelExpanded(win);
  await gotoStage(win, 3);
  await win.waitForTimeout(300);
  await clickDockVerb(win, 3, 'watermark');
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 10000 });
}

// Apply a text watermark through the real dialog (default range = all pages).
async function applyWatermark(text) {
  await openWatermarkDialog();
  await win.locator('[data-watermark-type="text"]').check().catch(() => {});
  await win.locator('[data-watermark-text]').fill(text);
  await win.waitForTimeout(150);
  await win.locator('[data-watermark-confirm]').click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'detached', timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// Criterion 1 — placement is not margin-clamped: corner (x=0,y=0) and gutter
// (x=20, inside the 10% margin) both bake at the payload point, survive a
// save+reload, and the DRAWN Tm matches the payload.
// ---------------------------------------------------------------------------
test('P90-CORNER-GUTTER: explicit x/y corner + gutter stamps bake at the payload point and survive save+reload', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  const pre = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(pageText(pre, n)).toContain(WORDS[n - 1]);

  await openBatesDialog();
  const mode1 = await applyBatesXY({ prefix: CORNER_PREFIX, x: CORNER_XY.x, y: CORNER_XY.y, from: 1, to: 1 });
  log('corner-mode', mode1);
  expect(mode1).toBe('apply');
  await waitForPageText(docId, 1, CORNER_LABEL);

  await applyBatesXY({ prefix: GUTTER_PREFIX, x: GUTTER_XY.x, y: GUTTER_XY.y, from: 4, to: 4 });
  await waitForPageText(docId, 4, GUTTER_LABEL);
  await closeDialog('[data-bates-dialog]');

  const post = (await engineText(docId)).pages;
  log('post-pages', post.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(post, 1)).toContain(CORNER_LABEL);
  expect(pageText(post, 4)).toContain(GUTTER_LABEL);
  expect(pageText(post, 2)).toBe(pageText(pre, 2));
  expect(pageText(post, 3)).toBe(pageText(pre, 3));

  // The marker echo (getBates) carries the payload coordinates.
  const runs = (await engineGetBates(docId)).runs;
  log('runs', runs.map((r) => ({ id: r.id, x: r.x, y: r.y, pages: r.pages, labels: r.labels })));
  const cornerRun = runs.find((r) => r.labels.includes(CORNER_LABEL));
  const gutterRun = runs.find((r) => r.labels.includes(GUTTER_LABEL));
  expect(cornerRun).toBeTruthy();
  expect(gutterRun).toBeTruthy();
  expect(cornerRun.x).toBe(CORNER_XY.x);
  expect(cornerRun.y).toBe(CORNER_XY.y);
  expect(gutterRun.x).toBe(GUTTER_XY.x);
  expect(gutterRun.y).toBe(GUTTER_XY.y);

  const SAVED = path.join(TMP, `p90-corner-gutter-${Date.now()}.pdf`);
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);

  // Reopen: extraction finds each label.
  await openFixture(SAVED);
  const d2 = await diag();
  const reloaded = (await engineText(d2.engineDocId)).pages;
  log('reloaded', reloaded.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(reloaded, 1)).toContain(CORNER_LABEL);
  expect(pageText(reloaded, 4)).toContain(GUTTER_LABEL);

  // Drawn geometry from the saved bytes: Tm x == payload x exactly, and the
  // two Tm baselines differ by the payload y difference (same font/size).
  const geo = await readSavedGeometry(SAVED);
  log('saved-tm', geo);
  expect(geo.p0).not.toBeNull();
  expect(geo.p3).not.toBeNull();
  expect(geo.p0.x).toBeCloseTo(CORNER_XY.x, 2);
  expect(geo.p3.x).toBeCloseTo(GUTTER_XY.x, 2);
  expect(geo.p0.y - geo.p3.y).toBeCloseTo(GUTTER_XY.y - CORNER_XY.y, 1);
  await win.screenshot({ path: shot('phase90_corner_gutter_reload.png') });
});

// ---------------------------------------------------------------------------
// Criterion 2 — the graphical page-shaped preview reflects the chosen position
// (slot or explicit x/y), replacing the text-only preview.
// ---------------------------------------------------------------------------
test('P90-PREVIEW: [data-bates-preview] is a graphical page frame reflecting the slot and explicit x/y', async () => {
  await openFixture(FIXTURE);
  await openBatesDialog();

  const preview = win.locator('[data-bates-preview]');
  expect(await preview.count()).toBe(1);
  const frame = win.locator('[data-bates-dialog] .watermark-preview-frame').first();
  expect(await frame.count()).toBe(1);
  const frameBox = await frame.boundingBox();
  const previewBox = await preview.boundingBox();
  log('preview-geometry', { frameBox, previewBox });
  // Page-shaped frame: Letter aspect 612x792 -> height is the taller side.
  expect(frameBox.height).toBeGreaterThan(frameBox.width);

  // Default slot (bottom-right): the label sits in the lower-right of the frame.
  const labelText = (await preview.innerText()).trim();
  expect(labelText.length).toBeGreaterThan(0);
  const slotCenter = { x: previewBox.x + previewBox.width / 2, y: previewBox.y + previewBox.height / 2 };
  const frameCenter = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 };
  expect(slotCenter.x).toBeGreaterThan(frameCenter.x);
  expect(slotCenter.y).toBeGreaterThan(frameCenter.y);

  // Toggling explicit coords disables the 3x3 grid and enables X/Y.
  await win.locator('[data-bates-custom-xy]').check();
  expect(await win.locator('[data-bates-position="bottom-right"]').isDisabled()).toBe(true);
  expect(await win.locator('[data-bates-x]').isEnabled()).toBe(true);
  expect(await win.locator('[data-bates-y]').isEnabled()).toBe(true);
  expect(await win.locator('[data-bates-x]').getAttribute('min')).toBe('0');
  expect(await win.locator('[data-bates-x]').getAttribute('max')).toBe('14400');

  // The custom-coords hint grows the dialog and re-centres the frame, so the
  // frame must be re-measured AFTER the layout change (not before).
  await win.waitForTimeout(300);
  const frameAfterToggle = await frame.boundingBox();

  // x=0,y=0 puts the preview label's top-left at the frame's top-left.
  await win.locator('[data-bates-x]').fill('0');
  await win.locator('[data-bates-y]').fill('0');
  await win.waitForTimeout(200);
  const at00 = await preview.boundingBox();
  log('preview-at-0-0', { at00, frameAfterToggle });
  expect(Math.abs(at00.x - frameAfterToggle.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(at00.y - frameAfterToggle.y)).toBeLessThanOrEqual(2);

  // x=20,y=400 scales into preview pixels (1pt = 150/612px).
  await win.locator('[data-bates-x]').fill(String(GUTTER_XY.x));
  await win.locator('[data-bates-y]').fill(String(GUTTER_XY.y));
  await win.waitForTimeout(200);
  const atGutter = await preview.boundingBox();
  const frameGutter = await frame.boundingBox();
  log('preview-at-gutter', { atGutter, frameGutter });
  expect(Math.abs(atGutter.x - frameGutter.x - GUTTER_XY.x * (150 / 612))).toBeLessThanOrEqual(2);
  expect(Math.abs(atGutter.y - frameGutter.y - GUTTER_XY.y * (150 / 612))).toBeLessThanOrEqual(2);
  await scrollDialogToPreview();
  await win.screenshot({ path: shot('phase90_preview_custom_xy.png') });
});

// ---------------------------------------------------------------------------
// Criterion 4 — the unified review list renders all four categories, each row
// exposes select/edit/delete, and select jumps the workspace to the page.
// ---------------------------------------------------------------------------
test('P90-REVIEW-LIST: all four categories render; every row exposes select/edit/delete; select jumps', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  // One Bates run (pages 2-3) and one watermark so those categories have rows.
  await openBatesDialog();
  await win.locator('[data-bates-prefix]').fill('R-');
  await setBatesScope(2, 3);
  await win.locator('[data-bates-apply]').click();
  await waitForPageText(docId, 2, 'R-000001');
  await closeDialog('[data-bates-dialog]');
  await applyWatermark('P90WM');
  // Re-open the watermark dialog so the applied list refreshes, then close.
  await openWatermarkDialog();
  await closeDialog('[data-watermark-dialog]');

  await openReviewList();
  for (const c of ['annotations', 'bates', 'watermarks', 'signatures']) {
    expect(await panelCategory(c).count(), `category ${c} renders in the ContextPanel`).toBeGreaterThanOrEqual(1);
  }
  // The Inspector re-parents the ONE component too (Ruling 6).
  expect(await win.locator('[data-inspector] [data-review-category="bates"]').count()).toBeGreaterThanOrEqual(1);

  const batesRow = panelRow('bates');
  expect(await batesRow.count()).toBe(1);
  expect(await batesRow.getAttribute('data-review-element-id')).toBeTruthy();
  expect(await batesRow.locator('[data-review-element-select]').count()).toBe(1);
  expect(await batesRow.locator('[data-review-element-edit]').count()).toBe(1);
  expect(await batesRow.locator('[data-review-element-delete]').count()).toBe(1);

  const wmRow = panelRow('watermark');
  expect(await wmRow.count()).toBe(1);
  expect(await wmRow.locator('[data-review-element-select]').count()).toBe(1);
  expect(await wmRow.locator('[data-review-element-edit]').count()).toBe(1);
  expect(await wmRow.locator('[data-review-element-delete]').count()).toBe(1);

  // Select on the Bates row jumps to its first page (2), from page 1.
  expect((await diag()).currentPage).toBe(1);
  await batesRow.locator('[data-review-element-select]').click();
  await win.waitForTimeout(800);
  const jumped = (await diag()).currentPage;
  log('select-jump', { jumped });
  expect(jumped).toBe(2);
  await win.screenshot({ path: shot('phase90_review_list.png') });
});

// ---------------------------------------------------------------------------
// Criterion 3 — an applied Bates run can be edited from the list (position +
// padding) and the change is ONE undo entry.
// ---------------------------------------------------------------------------
test('P90-EDIT: editing a Bates run (position + padding) updates the doc as ONE undo entry', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  await openBatesDialog();
  await win.locator('[data-bates-prefix]').fill('E-');
  await win.locator('[data-bates-padding]').fill('6');
  await setBatesScope(2, 3);
  await win.locator('[data-bates-apply]').click();
  await waitForPageText(docId, 2, 'E-000001');
  await closeDialog('[data-bates-dialog]');
  const preEdit = (await engineText(docId)).pages;
  expect(pageText(preEdit, 2)).toContain('E-000001');
  expect(pageText(preEdit, 3)).toContain('E-000002');

  await openReviewList();
  await panelRow('bates').locator('[data-review-element-edit]').click();
  await win.waitForSelector('[data-bates-dialog]', { state: 'visible', timeout: 10000 });
  const mode = await win.locator('[data-bates-dialog]').getAttribute('data-bates-mode');
  log('edit-mode', { mode });
  expect(mode).toBe('update');
  // The dialog is seeded from the applied run.
  expect(await win.locator('[data-bates-prefix]').inputValue()).toBe('E-');
  expect(await win.locator('[data-bates-padding]').inputValue()).toBe('6');

  // Change position (explicit x/y) and padding (6 -> 3). The update dialog
  // honestly defaults its scope to "All pages" (it does not seed the run's
  // pages), so the user re-selects the run's original scope here.
  await win.locator('[data-bates-custom-xy]').check();
  await win.locator('[data-bates-x]').fill('50');
  await win.locator('[data-bates-y]').fill('60');
  await win.locator('[data-bates-padding]').fill('3');
  await setBatesScope(2, 3);
  await win.waitForTimeout(200);
  await win.locator('[data-bates-apply]').click();
  await waitForPageText(docId, 2, 'E-001');
  await waitForPageTextGone(docId, 2, 'E-000001');
  await closeDialog('[data-bates-dialog]');

  const updated = (await engineText(docId)).pages;
  log('post-update', updated.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(updated, 2)).toContain('E-001');
  expect(pageText(updated, 3)).toContain('E-002');
  // Scope preserved: page 1 and 4 were never stamped.
  expect(pageText(updated, 1)).not.toContain('E-');
  expect(pageText(updated, 4)).not.toContain('E-');
  const runs = (await engineGetBates(docId)).runs;
  log('updated-runs', runs.map((r) => ({ id: r.id, x: r.x, y: r.y, padding: r.padding, labels: r.labels })));
  const run = runs.find((r) => r.labels.includes('E-001'));
  expect(run).toBeTruthy();
  expect(run.x).toBe(50);
  expect(run.y).toBe(60);
  expect(run.padding).toBe(3);

  // ONE undo entry: a single Ctrl+Z restores the pre-update run exactly.
  await uiUndo();
  const afterUndo = (await engineText(docId)).pages;
  log('post-undo', afterUndo.map((p) => `p${p.pageIndex}:${JSON.stringify(p.text)}`));
  expect(pageText(afterUndo, 2)).toContain('E-000001');
  expect(pageText(afterUndo, 3)).toContain('E-000002');
  expect(pageText(afterUndo, 2)).not.toContain('E-001');
});

// ---------------------------------------------------------------------------
// Criterion 4b — delete a Bates run AND a watermark from the list; both leave
// the document and the list.
// ---------------------------------------------------------------------------
test('P90-DELETE: deleting a Bates run and a watermark from the list removes both', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  await openBatesDialog();
  await win.locator('[data-bates-prefix]').fill('D-');
  await setBatesScope(1, 1);
  await win.locator('[data-bates-apply]').click();
  await waitForPageText(docId, 1, 'D-000001');
  await closeDialog('[data-bates-dialog]');
  await applyWatermark('DELWM');
  await openWatermarkDialog();
  await closeDialog('[data-watermark-dialog]');

  await openReviewList();
  expect(await panelRow('bates').count()).toBe(1);
  expect(await panelRow('watermark').count()).toBe(1);

  // Delete the Bates run first (Bates category empties).
  await panelRow('bates').locator('[data-review-element-delete]').click();
  await expect(panelCategory('bates').locator('[data-review-empty]')).toHaveCount(1, { timeout: 15000 });
  await waitForPageTextGone(docId, 1, 'D-000001');
  log('after-bates-delete', { runs: (await engineGetBates(docId)).runs });

  // Delete the watermark next.
  await panelRow('watermark').locator('[data-review-element-delete]').click();
  await expect(panelCategory('watermarks').locator('[data-review-empty]')).toHaveCount(1, { timeout: 15000 });
  await waitForPageTextGone(docId, 1, 'DELWM');
  const finalText = (await engineText(docId)).pages;
  expect(pageText(finalText, 1)).not.toContain('D-000001');
  expect(pageText(finalText, 1)).not.toContain('DELWM');
  await win.screenshot({ path: shot('phase90_deleted.png') });
});

// ---------------------------------------------------------------------------
// Criterion 6 — fail-loud: an out-of-bounds coordinate and an unknown id are
// refused with a readable message and mutate nothing.
// ---------------------------------------------------------------------------
test('P90-REFUSE: out-of-bounds coordinate and unknown id are refused loudly and change nothing', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;
  const pre = (await engineText(docId)).pages;

  await openBatesDialog();
  await win.locator('[data-bates-prefix]').fill('X-');
  await win.locator('[data-bates-custom-xy]').check();
  await setBatesScope(1, 1);

  // Out-of-bounds (< 0): the dialog refuses before any engine call.
  await win.locator('[data-bates-x]').fill('-5');
  await win.locator('[data-bates-y]').fill('0');
  await win.waitForTimeout(150);
  await win.locator('[data-bates-apply]').click();
  await win.waitForTimeout(800);
  const reportEl = win.locator('[data-bates-report]');
  const reportText = (await reportEl.innerText()).trim();
  log('oob-report', reportText);
  expect(reportText).toContain('between 0 and 14400');
  expect(await reportEl.getAttribute('role')).toBe('alert');

  // Out-of-bounds (> MAX): also refused.
  await win.locator('[data-bates-x]').fill('14401');
  await win.locator('[data-bates-y]').fill('0');
  await win.waitForTimeout(150);
  await win.locator('[data-bates-apply]').click();
  await win.waitForTimeout(800);
  const reportText2 = (await reportEl.innerText()).trim();
  log('oob-report-2', reportText2);
  expect(reportText2).toContain('between 0 and 14400');
  await closeDialog('[data-bates-dialog]');

  // Unknown id at the engine level: update + delete both refuse, typed error.
  const settings = { pages: [1], prefix: 'X-', suffix: '', startNumber: 1, padding: 6, position: 'bottom-right' };
  const upd = await engineUpdateBates(docId, 'no-such-run', settings);
  const del = await engineDeleteBates(docId, 'no-such-run');
  const oob = await engineAddBates(docId, { ...settings, x: 14401, y: 0 });
  log('engine-refusals', { upd, del, oob });
  expect(upd.ok).toBe(false);
  expect(upd.code).toBe('engine-error');
  expect(del.ok).toBe(false);
  expect(del.code).toBe('engine-error');
  expect(oob.ok).toBe(false);
  expect(oob.code).toBe('engine-error');

  // Nothing changed: every page's extracted text is byte-identical.
  const after = (await engineText(docId)).pages;
  for (let n = 1; n <= 4; n += 1) expect(pageText(after, n)).toBe(pageText(pre, n));
  await win.screenshot({ path: shot('phase90_refusal.png') });
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX sweep (criterion 7) — every Phase 90 control exists and
// performs its promised action; plus both-theme screenshots and the offline
// static check (criterion 5).
// ---------------------------------------------------------------------------
test('P90-CONTROL-INDEX: every control exists + acts; both themes captured; offline only', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const docId = d.engineDocId;

  // --- dock open control ---------------------------------------------------
  await ensurePanelExpanded(win);
  await gotoStage(win, 3);
  const inlineCount = await win.locator('[data-dock-verb="bates"]').count();
  const lane = await clickDockVerb(win, 3, 'bates');
  await win.waitForSelector('[data-bates-dialog]', { state: 'visible', timeout: 10000 });
  log('control-index-open', { inlineCount, lane });
  expect(inlineCount + (lane.startsWith('overflow') ? 1 : 0)).toBeGreaterThan(0);

  // --- in-dialog controls --------------------------------------------------
  expect(await win.locator('[data-bates-dialog]').getAttribute('data-bates-mode')).toBe('apply');
  const xy = win.locator('[data-bates-custom-xy]');
  expect(await xy.count()).toBe(1);
  await xy.check();
  expect(await win.locator('[data-bates-position]').first().isDisabled()).toBe(true);
  expect(await win.locator('[data-bates-x]').getAttribute('min')).toBe('0');
  expect(await win.locator('[data-bates-x]').getAttribute('max')).toBe('14400');
  expect(await win.locator('[data-bates-y]').getAttribute('min')).toBe('0');
  expect(await win.locator('[data-bates-y]').getAttribute('max')).toBe('14400');
  await xy.uncheck();
  expect(await win.locator('[data-bates-position]').first().isDisabled()).toBe(false);
  expect(await win.locator('[data-bates-preview]').count()).toBe(1);

  const apply = win.locator('[data-bates-apply]');
  await win.locator('[data-bates-prefix]').fill('IX-');
  await setBatesScope(1, 1);
  await apply.click();
  await waitForPageText(docId, 1, 'IX-000001');
  expect((await win.locator('[data-bates-report]').innerText())).toContain('1 page stamped');
  await closeDialog('[data-bates-dialog]');

  // --- unified review-list controls ---------------------------------------
  await openReviewList();
  for (const c of ['annotations', 'bates', 'watermarks', 'signatures']) {
    expect(await panelCategory(c).count(), `category ${c}`).toBeGreaterThanOrEqual(1);
  }
  const row = panelRow('bates');
  expect(await row.getAttribute('data-review-element-type')).toBe('bates');
  expect(await row.getAttribute('data-review-element-id')).toBeTruthy();
  expect(await row.locator('[data-review-element-select]').count()).toBe(1);
  expect(await row.locator('[data-review-element-edit]').count()).toBe(1);
  expect(await row.locator('[data-review-element-delete]').count()).toBe(1);

  // --- watermark update control ([data-watermark-mode="update"]) -----------
  await applyWatermark('IDXWM');
  await openWatermarkDialog();
  await closeDialog('[data-watermark-dialog]');
  await openReviewList();
  const wmRow = panelRow('watermark');
  expect(await wmRow.count()).toBe(1);
  await wmRow.locator('[data-review-element-edit]').click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 10000 });
  expect(await win.locator('[data-watermark-dialog]').getAttribute('data-watermark-mode')).toBe('update');
  expect(await win.locator('[data-watermark-confirm]').count()).toBe(1);
  await closeDialog('[data-watermark-dialog]');

  // --- both-theme screenshots ---------------------------------------------
  const darkApplied = await setTheme('dark');
  expect(darkApplied).toBe('dark');
  await openBatesDialog();
  await scrollDialogToPreview();
  await win.screenshot({ path: shot('phase90_dialog_dark.png') });
  await closeDialog('[data-bates-dialog]');
  await openReviewList();
  await win.screenshot({ path: shot('phase90_review_dark.png') });

  const lightApplied = await setTheme('light');
  expect(lightApplied).toBe('light');
  await openBatesDialog();
  await scrollDialogToPreview();
  await win.screenshot({ path: shot('phase90_dialog_light.png') });
  await closeDialog('[data-bates-dialog]');
  await openReviewList();
  await win.screenshot({ path: shot('phase90_review_light.png') });

  // --- criterion 5: offline only (no network primitive in the Phase 90 src)
  const files = [
    path.join(ROOT, 'src', 'shared', 'bates.ts'),
    path.join(ROOT, 'src', 'renderer', 'components', 'BatesDialog.tsx'),
    path.join(ROOT, 'src', 'renderer', 'components', 'ReviewElementsPanel.tsx'),
  ];
  const network = /(\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|\bnet\.request|\bhttps?\.request|axios)/;
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const line of src.split(/\r?\n/)) if (network.test(line)) hits.push(`${path.basename(f)}: ${line.trim()}`);
  }
  log('offline-network-hits', hits);
  expect(hits).toEqual([]);
});
