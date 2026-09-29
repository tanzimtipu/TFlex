// Phase 54 DEF-378 run-close retest (QA). Launches ONLY through the canonical
// launchApp helper (dev build under dist/). Covers:
//   Part A - re-runs the DEF-378 acceptance cases (also in the phase54 gate spec);
//   Part B - the JavaScript rule must not falsely PASS through an OPENED
//            document, both sides, and /OCProperties must survive a save;
//   Part D - the catalog entries serializeDoc STILL drops, with saved-file
//            evidence (the new DEF in DEFECTS.md).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, runTool } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('@cantoo/pdf-lib');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase54');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  js: path.join(FIX, 'js-names-action.pdf'),
  ocg: path.join(FIX, 'ocg-layers.pdf'),
  drops: path.join(FIX, 'catalog-drops.pdf'),
  pdfaOk: path.join(FIX, 'pdfa-1b-ok.pdf'),
};

let app = null;
let win = null;
const consoleLog = [];

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase54-retest');
  app = null;
  win = null;
  consoleLog.length = 0;
});

test.setTimeout(180000);

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function runValidation(target) {
  await runTool(win, 'validateDocument');
  await win.waitForSelector('[data-validate-document-dialog]', { timeout: 10000 });
  await win.locator(`[data-validation-target="${target}"]`).check();
  await win.locator('[data-validation-run]').click();
  await win.waitForSelector('[data-validation-inline-report] [data-validation-notice]', { timeout: 20000 });
  await win.waitForTimeout(300);
}

async function inlineReport() {
  const notice = win.locator('[data-validation-inline-report] [data-validation-notice]').first();
  return {
    target: await notice.getAttribute('data-validation-target'),
    conforms: await notice.getAttribute('data-validation-conforms'),
    declared: await notice.locator('[data-validation-declared-value]').innerText(),
    rules: await notice.locator('[data-validation-violation]').evaluateAll((els) =>
      els.map((e) => ({ rule: e.getAttribute('data-validation-rule'), severity: e.getAttribute('data-validation-severity') })),
    ),
    details: await notice.locator('[data-validation-detail]').allInnerTexts(),
  };
}

async function saveAs(outPath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) break;
    await win.waitForTimeout(300);
  }
  await win.waitForTimeout(800);
}

async function loadSaved(p) {
  return PDFDocument.load(fs.readFileSync(p), { updateMetadata: false, throwOnInvalidObject: false });
}

function catalogKeys(doc) {
  return doc.catalog.entries().map(([k]) => (typeof k.asString === 'function' ? k.asString() : String(k)));
}

function ocgNames(doc) {
  const ocp = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('OCProperties')), PDFDict);
  if (ocp === undefined) return null;
  const arr = doc.context.lookupMaybe(ocp.get(PDFName.of('OCGs')), PDFArray);
  if (arr === undefined) return null;
  return arr.asArray().map((r) => {
    const d = doc.context.lookupMaybe(r, PDFDict);
    const n = d === undefined ? undefined : d.get(PDFName.of('Name'));
    return n === undefined ? null : n.decodeText();
  });
}

// ---------------------------------------------------------------------------
// Part B.1a - a document carrying /Names /JavaScript MUST report
// pdfa.javascript through the app's OPENED-document path (the false-PASS hole).
// ---------------------------------------------------------------------------
test('Part B: a JavaScript document reports pdfa.javascript through an opened document', async () => {
  await openFixture(F.js);
  await runValidation('pdfa-1b');
  const r = await inlineReport();
  console.log('P54R_JS_POS ' + JSON.stringify(r));
  expect(r.rules.map((x) => x.rule), 'JavaScript violation present').toContain('pdfa.javascript');
  const detail = r.details.join(' ');
  expect(detail).toContain('/Names /JavaScript');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-retest-js-positive.png') });
});

// ---------------------------------------------------------------------------
// Part B.1b - a JavaScript-free document must report NO pdfa.javascript.
// ---------------------------------------------------------------------------
test('Part B: a JavaScript-free document reports no pdfa.javascript', async () => {
  await openFixture(F.pdfaOk);
  await runValidation('pdfa-1b');
  const r = await inlineReport();
  console.log('P54R_JS_NEG ' + JSON.stringify(r));
  expect(r.rules.map((x) => x.rule)).not.toContain('pdfa.javascript');
  expect(r.conforms).toBe('true');
  expect(r.declared).toBe('PDF/A-1b');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-retest-js-negative.png') });
});

// ---------------------------------------------------------------------------
// Part B.2 - /OCProperties survives a save (Phase 57 layers depend on it).
// ---------------------------------------------------------------------------
test('Part B: /OCProperties survives a save', async () => {
  await openFixture(F.ocg);
  const outPath = path.join(os.tmpdir(), `tflex-p54-ocg-${Date.now()}.pdf`);
  await saveAs(outPath);
  expect(fs.existsSync(outPath), 'saved file written').toBe(true);
  const doc = await loadSaved(outPath);
  const keys = catalogKeys(doc);
  const names = ocgNames(doc);
  console.log('P54R_OCG ' + JSON.stringify({ keys, names }));
  expect(keys, '/OCProperties present after save').toContain('/OCProperties');
  expect(names, 'both OCG names survive').toEqual(['Layer Alpha', 'Layer Beta']);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-retest-ocg-saved.png') });
});

// ---------------------------------------------------------------------------
// Part D - the entries serializeDoc STILL drops, evidenced on a saved file.
// The carried control (/MarkInfo) proves the fixture is well-formed and the
// carry path ran; the dropped keys prove the remaining data loss.
// ---------------------------------------------------------------------------
test('Part D: serializeDoc still drops /StructTreeRoot, /Dests, /OpenAction, /AcroForm and /Names (wholesale)', async () => {
  await openFixture(F.drops);
  const outPath = path.join(os.tmpdir(), `tflex-p54-drops-${Date.now()}.pdf`);
  await saveAs(outPath);
  expect(fs.existsSync(outPath), 'saved file written').toBe(true);

  const src = await loadSaved(F.drops);
  const out = await loadSaved(outPath);
  const srcKeys = catalogKeys(src);
  const outKeys = catalogKeys(out);
  const srcNames = src.context.lookupMaybe(src.catalog.get(PDFName.of('Names')), PDFDict);
  const outNames = out.context.lookupMaybe(out.catalog.get(PDFName.of('Names')), PDFDict);
  const evidence = {
    srcCatalogue: srcKeys,
    savedCatalogue: outKeys,
    srcNamesKeys: srcNames ? srcNames.keys().map((k) => k.asString()) : null,
    savedNamesKeys: outNames ? outNames.keys().map((k) => k.asString()) : null,
    savedHasStructTreeRoot: outKeys.includes('/StructTreeRoot'),
    savedHasDests: outKeys.includes('/Dests'),
    savedHasOpenAction: outKeys.includes('/OpenAction'),
    savedHasAcroForm: outKeys.includes('/AcroForm'),
    savedHasMarkInfo: outKeys.includes('/MarkInfo'),
    savedNamesHasJavaScript: outNames ? outNames.has(PDFName.of('JavaScript')) : false,
    savedNamesHasDests: outNames ? outNames.has(PDFName.of('Dests')) : false,
  };
  console.log('P54R_DROPS ' + JSON.stringify(evidence));
  await win.screenshot({ path: path.join(SHOTS, 'phase54-retest-drops.png') });

  // Positive control: the fixture really had every entry, and the carried
  // /MarkInfo + /Names/JavaScript survived.
  expect(srcKeys, 'fixture carried the entries').toEqual(
    expect.arrayContaining(['/StructTreeRoot', '/Dests', '/OpenAction', '/AcroForm', '/Names', '/MarkInfo']),
  );
  expect(evidence.savedHasMarkInfo, 'carried /MarkInfo survives').toBe(true);
  expect(evidence.savedNamesHasJavaScript, 'carried /Names/JavaScript survives').toBe(true);
  // The documented losses (Part D defect evidence).
  expect(evidence.savedHasStructTreeRoot, 'tagged structure is lost on save').toBe(false);
  expect(evidence.savedHasDests, 'named destinations are lost on save').toBe(false);
  expect(evidence.savedHasOpenAction, 'initial view is lost on save').toBe(false);
  expect(evidence.savedHasAcroForm, 'the source /AcroForm is lost on save').toBe(false);
  expect(evidence.savedNamesHasDests, 'wholesale /Names /Dests is lost on save').toBe(false);
});
