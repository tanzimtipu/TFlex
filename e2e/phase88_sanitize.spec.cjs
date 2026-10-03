// Phase 88 (FEA-037) phase-validation e2e (qa) - Sanitize PDF: strip active content.
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs); the REVIEW Action Dock verb
// (or the Command Palette, same dockAppActions verb) opens the dialog and every
// assertion is on LIVE ENGINE STATE (`window.tflex.engine.getState` /
// `exportText`), a raw catalog read of the saved file, and the DOM - never pixels.
//
// PHASE-GATE PROCEDURE: this spec drives the built renderer, so the gate MUST
// rebuild dist/ BEFORE the run or a stale bundle can pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase88_sanitize.spec.cjs
//
// FIXTURES (built in beforeAll, raw pdf-lib catalog-set like
// test/unit/main/sanitize.test.ts):
//   ACTIVE    /Names /JavaScript + /Names /EmbeddedFiles name trees, an external
//             /URI /OpenAction, a /Metadata XMP flate stream, page text "KEEP ME".
//   MALFORMED same page text, catalog /Names set to a number (wrong type).
//   PLAIN     text-only (no active content).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, PDFName, PDFDict, rgb } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'p88-sanitize');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const ACTIVE = path.join(TMP, 'p88-active.pdf');
const MALFORMED = path.join(TMP, 'p88-malformed.pdf');
const PLAIN = path.join(TMP, 'p88-plain.pdf');

const log = (label, obj) => console.log(`[p88|${label}] ${JSON.stringify(obj)}`);
const shot = (name) => path.join(SHOTS, name);

const CLASSES = ['javascript', 'launchActions', 'embeddedFiles', 'metadata'];
const LABELS = {
  javascript: 'JavaScript',
  launchActions: 'Launch and open actions',
  embeddedFiles: 'Embedded files',
  metadata: 'Metadata',
};

const XMP =
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>' +
  '<?xpacket end="w"?>';

async function pageTextDoc(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(text, { x: 72, y: 600, size: 48, font, color: rgb(0, 0, 0) });
  return doc;
}

async function buildActive() {
  const doc = await pageTextDoc('KEEP ME');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] }, EmbeddedFiles: { Names: [] } }),
  );
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'URI', URI: 'http://example.test/' }),
  );
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.flateStream(XMP, { Type: 'Metadata', Subtype: 'XML' }),
  );
  fs.writeFileSync(ACTIVE, await doc.save());
}

async function buildMalformed() {
  const doc = await pageTextDoc('KEEP ME');
  doc.catalog.set(PDFName.of('Names'), doc.context.obj(7));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', FS: {} }));
  doc.catalog.set(PDFName.of('Metadata'), doc.context.obj({ Type: 'Metadata' }));
  fs.writeFileSync(MALFORMED, await doc.save());
}

async function buildPlain() {
  const doc = await pageTextDoc('PLAIN TEXT');
  fs.writeFileSync(PLAIN, await doc.save());
}

let app = null;
let win = null;
const consoleLog = [];
let userData = null;

test.beforeAll(async () => {
  await buildActive();
  await buildMalformed();
  await buildPlain();
});

test.beforeEach(async () => {
  consoleLog.length = 0;
  userData = path.join(os.tmpdir(), `p88-userdata-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  app = await launchApp([], userData);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p88');
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
  // Multiple documents may be open (this spec opens several fixtures in one
  // test), so each tab-pane hosts its own `.workspace`; wait for the ACTIVE
  // pane's workspace, not the first hidden one.
  await win.waitForSelector('.workspace:visible', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// REVIEW Action Dock verb opens the dialog; if the dock spilled the verb into
// overflow (no [data-dock-verb] node), the Command Palette runs the same verb.
async function openSanitize() {
  await ensurePanelExpanded(win).catch(() => {});
  await gotoStage(win, 3);
  const verb = win.locator('[data-dock-verb="sanitize"]');
  if ((await verb.count()) > 0 && (await verb.first().isVisible().catch(() => false))) {
    await verb.first().click();
  } else {
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-command-palette-input]').fill('Sanitize document');
    await win.waitForTimeout(350);
    const row = win.locator('.command-palette-row').filter({ hasText: 'Sanitize document' }).first();
    if (await row.count()) await row.click();
    else await win.keyboard.press('Enter');
  }
  await win.waitForSelector('[data-sanitize-dialog]', { state: 'visible', timeout: 10000 });
}

async function closeDialog() {
  const close = win.locator('[data-sanitize-close]');
  if (await close.count()) await close.first().click();
  else await win.keyboard.press('Escape');
  await win.waitForSelector('[data-sanitize-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

async function setClass(cls, checked) {
  const box = win.locator(`[data-sanitize-class="${cls}"]`);
  if (checked) await box.check();
  else await box.uncheck();
  await win.waitForTimeout(120);
}

async function setAll(checked) {
  for (const cls of CLASSES) await setClass(cls, checked);
}

async function runSanitize() {
  await win.locator('[data-sanitize-run]').click();
  await win.waitForFunction(
    () =>
      document.querySelector('[data-sanitize-report]') !== null ||
      document.querySelector('[data-sanitize-error]') !== null,
    undefined,
    { timeout: 60000 },
  );
  await win.waitForTimeout(200);
}

async function readReportCounts() {
  return win.$$eval('[data-sanitize-report] .sanitize-report-class', (els) =>
    els.map((e) => {
      const label = (e.querySelector('.sanitize-report-label') || {}).textContent || '';
      const countText = (e.querySelector('.sanitize-report-count') || {}).textContent || '';
      const m = countText.match(/(\d+)/);
      return { label: label.trim(), count: m ? Number(m[1]) : -1 };
    }),
  );
}

async function engineText(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return { error: r.error };
    return { pages: r.value };
  }, docId);
}

const allText = (pages) => (pages || []).map((p) => p.text).join('\n');

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

// Raw catalog read of the SAVED file with the same pdf-lib objects the service
// uses (the brief allows a raw catalog read instead of collectDocumentFacts).
async function readCatalog(filePath) {
  const doc = await PDFDocument.load(fs.readFileSync(filePath), {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const namesVal = doc.catalog.get(PDFName.of('Names'));
  const names = namesVal === undefined ? undefined : doc.context.lookupMaybe(namesVal, PDFDict);
  const oaVal = doc.catalog.get(PDFName.of('OpenAction'));
  const oa = oaVal === undefined ? undefined : doc.context.lookupMaybe(oaVal, PDFDict);
  return {
    hasMetadata: doc.catalog.has(PDFName.of('Metadata')),
    hasJsTree: !!(names && names.has(PDFName.of('JavaScript'))),
    hasEmbeddedTree: !!(names && names.has(PDFName.of('EmbeddedFiles'))),
    hasOpenAction: oaVal !== undefined,
    openActionS: oa ? (oa.get(PDFName.of('S')) || {}).decodeText?.() || null : null,
  };
}

async function openValidate() {
  await gotoStage(win, 3);
  const verb = win.locator('[data-dock-verb="validateDocument"]');
  if ((await verb.count()) > 0 && (await verb.first().isVisible().catch(() => false))) {
    await verb.first().click();
  } else {
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-command-palette-input]').fill('Validate document');
    await win.waitForTimeout(350);
    const row = win.locator('.command-palette-row').filter({ hasText: 'Validate document' }).first();
    if (await row.count()) await row.click();
    else await win.keyboard.press('Enter');
  }
  await win.waitForSelector('[data-validate-document-dialog]', { state: 'visible', timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Items 1-4 + 9: open dialog, defaults, all-four report, save/reload is clean.
// ---------------------------------------------------------------------------
test('P88-CORE: dock opens the dialog, four classes default checked, all-four run reports each class, save/reload is clean and text survives', async () => {
  await openFixture(ACTIVE);
  const d = await diag();
  const docId = d.engineDocId;
  expect(allText((await engineText(docId)).pages)).toContain('KEEP ME');

  // Item 1 - [data-dock-verb="sanitize"] opens [data-sanitize-dialog].
  await openSanitize();
  expect(await win.locator('[data-sanitize-dialog]').isVisible()).toBe(true);

  // Item 2 - the four class checkboxes exist and are checked by default.
  for (const cls of CLASSES) {
    const box = win.locator(`[data-sanitize-class="${cls}"]`);
    expect(await box.count(), `missing checkbox ${cls}`).toBe(1);
    expect(await box.isChecked(), `${cls} not checked by default`).toBe(true);
  }

  // Item 3a - select all four -> run -> report names a removal per class.
  await setAll(true);
  await runSanitize();
  expect(await win.locator('[data-sanitize-error]').count()).toBe(0);
  const counts = await readReportCounts();
  log('core-report-counts', counts);
  expect(counts.map((c) => c.label)).toEqual(CLASSES.map((c) => LABELS[c]));
  for (const c of counts) expect(c.count, `${c.label} removed 0`).toBeGreaterThanOrEqual(1);
  const reportText = (await win.locator('[data-sanitize-report]').innerText()).trim();
  expect(reportText.length).toBeGreaterThan(0);

  // Item 9 - screenshot: dialog open with the four classes and the report.
  await win.screenshot({ path: shot('phase88-sanitize-dialog.png') });

  // Item 3b - uncheck every class -> [data-sanitize-run] is disabled.
  await setAll(false);
  expect(await win.locator('[data-sanitize-run]').isDisabled()).toBe(true);
  await closeDialog();

  // Item 4 - save, then a raw catalog read of the saved bytes.
  const saved = path.join(TMP, 'p88-core-saved.pdf');
  await saveAs(saved);
  expect(fs.existsSync(saved), 'save produced no file').toBe(true);
  const cat = await readCatalog(saved);
  log('core-saved-catalog', cat);
  expect(cat.hasJsTree).toBe(false);
  expect(cat.hasEmbeddedTree).toBe(false);
  expect(cat.hasOpenAction).toBe(false);
  expect(cat.hasMetadata).toBe(false);

  // Item 4 - reload and assert the page text survives the sanitize + save.
  await openFixture(saved);
  const d2 = await diag();
  const reopened = allText((await engineText(d2.engineDocId)).pages);
  log('core-reopened-text', reopened);
  expect(reopened).toContain('KEEP ME');
});

// ---------------------------------------------------------------------------
// Item 5: uncheck metadata only -> metadata survives save, others removed.
// ---------------------------------------------------------------------------
test('P88-PARTIAL: uncheck metadata only -> metadata survives save while the other three are removed', async () => {
  await openFixture(ACTIVE);
  await openSanitize();
  await setAll(true);
  await setClass('metadata', false);
  await runSanitize();
  const counts = await readReportCounts();
  const byLabel = Object.fromEntries(counts.map((c) => [c.label, c.count]));
  log('partial-counts', counts);
  expect(byLabel[LABELS.metadata]).toBe(0);
  expect(byLabel[LABELS.javascript]).toBeGreaterThanOrEqual(1);
  expect(byLabel[LABELS.launchActions]).toBeGreaterThanOrEqual(1);
  expect(byLabel[LABELS.embeddedFiles]).toBeGreaterThanOrEqual(1);

  await closeDialog();
  const saved = path.join(TMP, 'p88-partial-saved.pdf');
  await saveAs(saved);
  const cat = await readCatalog(saved);
  log('partial-saved-catalog', cat);
  expect(cat.hasMetadata).toBe(true);
  expect(cat.hasJsTree).toBe(false);
  expect(cat.hasEmbeddedTree).toBe(false);
  expect(cat.hasOpenAction).toBe(false);
});

// ---------------------------------------------------------------------------
// Item 6: uncheck all -> run disabled; live engine refuses with typed no-op and
// nothing changes. The dialog disables Run at zero classes, so [data-sanitize-
// error] is not reachable by a click; the typed refusal is proven on the engine.
// ---------------------------------------------------------------------------
test('P88-NOOP: all unchecked disables run; the live engine refuses an all-false selection and mutates nothing', async () => {
  await openFixture(ACTIVE);
  const d = await diag();
  const docId = d.engineDocId;
  const before = allText((await engineText(docId)).pages);

  await openSanitize();
  await setAll(false);
  expect(await win.locator('[data-sanitize-run]').isDisabled()).toBe(true);
  expect(await win.locator('[data-sanitize-error]').count()).toBe(0);

  const noop = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.sanitizeDoc(id, {
      options: { javascript: false, launchActions: false, embeddedFiles: false, metadata: false },
    });
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, docId);
  log('noop-engine', noop);
  expect(noop.ok).toBe(false);
  expect(noop.code).toBe('no-op');
  expect(typeof noop.message).toBe('string');
  expect(noop.message.length).toBeGreaterThan(0);

  expect(allText((await engineText(docId)).pages)).toBe(before);
  await closeDialog();
});

// ---------------------------------------------------------------------------
// Item 7: malformed /Names -> [data-sanitize-warning] names it, rest sanitizes.
// ---------------------------------------------------------------------------
test('P88-WARN: malformed /Names is reported as a warning and the rest still sanitizes', async () => {
  await openFixture(MALFORMED);
  await openSanitize();
  await setAll(true);
  await runSanitize();
  const warning = win.locator('[data-sanitize-warning]');
  expect(await warning.count()).toBeGreaterThanOrEqual(1);
  const warningText = (await warning.first().innerText()).trim();
  log('malformed-warning', warningText);
  expect(warningText).toContain('/Names');
  const counts = await readReportCounts();
  const byLabel = Object.fromEntries(counts.map((c) => [c.label, c.count]));
  log('malformed-counts', counts);
  expect(byLabel[LABELS.launchActions]).toBeGreaterThanOrEqual(1);
  expect(byLabel[LABELS.metadata]).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: shot('phase88-sanitize-warning.png') });
});

// ---------------------------------------------------------------------------
// Item 8: PLAIN open/save still works; the PDF/A validator still DETECTS active
// content on an UNSANITIZED active fixture (shared validator predicate path).
// ---------------------------------------------------------------------------
test('P88-NOREGRESSION: plain open/save works and the validator still detects active content on UNSANITIZED ACTIVE', async () => {
  await openFixture(PLAIN);
  const d = await diag();
  expect(allText((await engineText(d.engineDocId)).pages)).toContain('PLAIN TEXT');
  const saved = path.join(TMP, 'p88-plain-saved.pdf');
  await saveAs(saved);
  expect(fs.existsSync(saved), 'plain save produced no file').toBe(true);
  await openFixture(saved);
  const d2 = await diag();
  expect(allText((await engineText(d2.engineDocId)).pages)).toContain('PLAIN TEXT');

  await openFixture(ACTIVE);
  await openValidate();
  await win.locator('[data-validation-target="pdfa-1b"]').check();
  await win.locator('[data-validation-run]').click();
  await win.waitForSelector('[data-validation-inline-report]', { state: 'visible', timeout: 30000 });
  await win.waitForTimeout(300);
  const vtext = (await win.locator('[data-validation-inline-report]').innerText()).trim();
  log('validator-report', vtext);
  expect(vtext).toContain('JavaScript');
  await win.screenshot({ path: shot('phase88-validator-detects.png') });
});


