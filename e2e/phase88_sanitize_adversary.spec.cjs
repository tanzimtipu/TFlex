// TFL-477 / Phase 88 (FEA-037) sanitize + save MERGE — ADVERSARIAL diff-pass spec.
//
// Adversary-only probe. It does NOT re-run qa's phase88_sanitize.spec.cjs; it
// attacks the sanitize removal carriers (src/main/services/sanitize.ts) together
// with the save path that re-serializes the working PDFDocument
// (serializeDoc / carryCatalogEntries / carryJavaScriptNames /
// carryPageLinkedEntries in src/main/services/engine.ts). Nothing under src/ is
// touched.
//
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase88_sanitize_adversary.spec.cjs --reporter=line
//
// Harness mirrors e2e/phase84_redaction_adversary.spec.cjs and
// e2e/phase88_sanitize.spec.cjs: canonical launchApp, delete
// ELECTRON_RUN_AS_NODE, @cantoo/pdf-lib fixtures, assertions on LIVE ENGINE STATE
// (window.tflex.engine.sanitizeDoc/getState/getDocumentBytes/undo), the
// validator (window.tflex.validation.validate) and RAW CATALOG READS of the
// serialized/saved bytes — never pixels.
//
// Vector map (issue TFL-477, attack cases 1-10):
//   1  benign /GoTo /OpenAction survives sanitize + save
//   2  wrong-typed /Names + non-dict /OpenAction -> warning, no throw, other
//      classes byte-intact
//   2b unreadable action objects (dict with no readable /S; wrong-typed /A) are
//      silently skipped (fail-loud contract)
//   3  AcroForm field /AA JavaScript removed; benign field + its value survive
//   4  /Names /EmbeddedFiles + /FileAttachment annots removed whole; ordinary
//      text annotation survives
//   5  sanitize -> undo -> carriers return; sanitize -> save -> reload -> gone
//   6  sanitize -> save -> reload -> validator reports clean
//   7  all-false -> typed no-op, bytes unchanged, no undo entry
//   8  javascript-only leaves launch/metadata; second identical sanitize reports
//      0 per class and throws nothing
//   9  /Names carrying /Dests (no /JavaScript) is not destroyed
//   10 /Launch action /FS: launchActions removes the action; embeddedFiles
//      removes the file spec
//   X  indirect /S action name: a JavaScript /AA with an INDIRECT /S survives
//      sanitize AND save (EXTRA hostile vector)
//
// The pure main-process service is bundled with the repo's esbuild into a temp
// .cjs (inside the fixture dir so @cantoo/pdf-lib resolves) and required, so the
// working-doc catalog semantics the serializer cannot expose (case 10) are
// asserted against the SAME shipped source the engine calls.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  PDFDocument, PDFArray, PDFDict, PDFName, PDFRef, PDFString,
  StandardFonts, rgb,
} = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

// Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its Node shim;
// launchApp spreads process.env, so Electron would exit as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const FIX = path.join(ROOT, 'test-fixtures', 'phase88-adversary');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIX, { recursive: true });

const P = (n) => path.join(FIX, n);
const FIX_GOTO = P('adv88-goto.pdf');
const FIX_MALFORMED = P('adv88-malformed.pdf');
const FIX_NOS = P('adv88-nos.pdf');
const FIX_FIELD = P('adv88-field.pdf');
const FIX_EMBEDDED = P('adv88-embedded.pdf');
const FIX_RICH = P('adv88-rich.pdf');
const FIX_VALIDATE = P('adv88-validate.pdf');
const FIX_DESTS = P('adv88-dests.pdf');
const FIX_AA_DIRECT = P('adv88-aa-direct.pdf');
const FIX_AA_INDIRECT = P('adv88-aa-indirect.pdf');
const SAVED = P('adv88-saved.pdf');
const PURE_ENTRY = P('adv88-pure-entry.ts');
const PURE_BUNDLE = P('adv88-pure.bundle.cjs');

const CLASSES = ['javascript', 'launchActions', 'embeddedFiles', 'metadata'];
const ALL = { javascript: true, launchActions: true, embeddedFiles: true, metadata: true };
const NONE = { javascript: false, launchActions: false, embeddedFiles: false, metadata: false };

const XMP =
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>' +
  '<?xpacket end="w"?>';

const log = (label, obj) => console.log(`[adv88|${label}] ${typeof obj === 'string' ? obj : JSON.stringify(obj)}`);

let pure = null; // bundled { stripActiveContent, collectJavaScript, collectExternalContent }

// ---------------------------------------------------------------------------
// Pure-service bundle (same shipped source the engine calls)
// ---------------------------------------------------------------------------
async function bundlePureModule() {
  fs.writeFileSync(
    PURE_ENTRY,
    [
      "export { stripActiveContent } from '../../src/main/services/sanitize';",
      "export { collectJavaScript, collectExternalContent } from '../../src/main/services/validation/pdfa';",
      '',
    ].join('\n'),
  );
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [PURE_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: PURE_BUNDLE,
    // Keep pdf-lib external: the bundle lives inside the repo, so Node resolves
    // it from the repo's node_modules (a temp-dir bundle could not).
    external: ['@cantoo/pdf-lib'],
    logLevel: 'silent',
  });
  pure = require(PURE_BUNDLE);
  log('pure-bundle', { ok: true });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
async function pageTextDoc(text, size = 28, y = 640) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(text, { x: 72, y, size, font, color: rgb(0, 0, 0) });
  return { doc, page, font };
}

function xmpCatalog(doc) {
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.flateStream(XMP, { Type: 'Metadata', Subtype: 'XML' }),
  );
}

async function buildGoto() {
  const { doc } = await pageTextDoc('GOTO KEEP');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] } }),
  );
  // A benign internal navigation action: /S /GoTo with a NAMED destination.
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'GoTo', D: PDFString.of('myDest') }),
  );
  xmpCatalog(doc);
  fs.writeFileSync(FIX_GOTO, await doc.save());
}

async function buildMalformed() {
  const { doc } = await pageTextDoc('MALFORMED KEEP');
  doc.catalog.set(PDFName.of('Names'), doc.context.obj(7)); // wrong type
  doc.catalog.set(PDFName.of('OpenAction'), PDFString.of('not-an-action')); // non-dict
  xmpCatalog(doc);
  fs.writeFileSync(FIX_MALFORMED, await doc.save());
}

async function buildNoS() {
  const { doc, page } = await pageTextDoc('NOS KEEP');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] } }),
  );
  // An action dict whose /S is NOT a name -> unreadable action name.
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 42, JS: PDFString.of('app.alert("adv88")') }),
  );
  // A page /AA action whose /S is not a name either.
  page.node.set(
    PDFName.of('AA'),
    doc.context.obj({ O: { S: 99, JS: PDFString.of('app.alert("adv88-aa")') } }),
  );
  // An annotation whose /A is the wrong type (not an action dictionary).
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [72, 600, 200, 620], A: PDFString.of('broken') }]),
  );
  xmpCatalog(doc);
  fs.writeFileSync(FIX_NOS, await doc.save());
}

async function buildField() {
  const { doc, page, font } = await pageTextDoc('FIELD KEEP');
  const form = doc.getForm();
  const f1 = form.createTextField('adv.f1');
  f1.addToPage(page, { x: 72, y: 560, width: 220, height: 26, font });
  f1.setText('KEEP-ONE');
  const f2 = form.createTextField('adv.f2');
  f2.addToPage(page, { x: 72, y: 520, width: 220, height: 26, font });
  f2.setText('KEEP-TWO');
  // Attach a JavaScript additional-action to the FIRST field's dict.
  const acro = doc.context.lookup(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  const fields = doc.context.lookup(acro.get(PDFName.of('Fields')), PDFArray);
  const d0 = doc.context.lookup(fields.get(0), PDFDict);
  d0.set(
    PDFName.of('AA'),
    doc.context.obj({ K: { S: 'JavaScript', JS: PDFString.of('app.alert("field")') } }),
  );
  fs.writeFileSync(FIX_FIELD, await doc.save());
}

async function buildEmbedded() {
  const { doc, page } = await pageTextDoc('EMBEDDED KEEP');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ EmbeddedFiles: { Names: [] }, JavaScript: { Names: [] } }),
  );
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([
      { Type: 'Annot', Subtype: 'FileAttachment', Rect: [72, 600, 92, 620], FS: { Type: 'Filespec', F: 'att.txt' } },
      { Type: 'Annot', Subtype: 'Text', Rect: [72, 550, 92, 570], Contents: PDFString.of('ordinary note') },
    ]),
  );
  xmpCatalog(doc);
  fs.writeFileSync(FIX_EMBEDDED, await doc.save());
}

async function buildRich() {
  const { doc } = await pageTextDoc('ROUNDTRIP KEEP');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] }, EmbeddedFiles: { Names: [] } }),
  );
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'URI', URI: PDFString.of('http://example.test/') }),
  );
  xmpCatalog(doc);
  fs.writeFileSync(FIX_RICH, await doc.save());
}

async function buildValidate() {
  const { doc, page } = await pageTextDoc('VALIDATE KEEP');
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] } }),
  );
  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([
      { Type: 'Annot', Subtype: 'FileAttachment', Rect: [72, 600, 92, 620], FS: { Type: 'Filespec', F: 'att.txt' } },
      { Type: 'Annot', Subtype: 'Link', Rect: [72, 550, 200, 570], A: { S: 'URI', URI: PDFString.of('http://example.test/') } },
    ]),
  );
  fs.writeFileSync(FIX_VALIDATE, await doc.save());
}

async function buildDests() {
  const { doc } = await pageTextDoc('DESTS KEEP');
  const pageRef = doc.getPage(0).ref;
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({
      Dests: { Names: [PDFString.of('destA'), doc.context.obj([pageRef, PDFName.of('Fit')])] },
    }),
  );
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'GoTo', D: PDFString.of('destA') }),
  );
  xmpCatalog(doc);
  fs.writeFileSync(FIX_DESTS, await doc.save());
}

async function buildAaDirect() {
  const { doc, page } = await pageTextDoc('AA DIRECT KEEP');
  page.node.set(
    PDFName.of('AA'),
    doc.context.obj({ O: { S: 'JavaScript', JS: PDFString.of('app.alert("direct")') } }),
  );
  fs.writeFileSync(FIX_AA_DIRECT, await doc.save());
}

async function buildAaIndirect() {
  const { doc, page } = await pageTextDoc('AA INDIRECT KEEP');
  // A hostile PDF: the action type name is written INDIRECTLY (/S 12 0 R).
  const jsName = doc.context.register(PDFName.of('JavaScript'));
  page.node.set(
    PDFName.of('AA'),
    doc.context.obj({ O: { S: jsName, JS: PDFString.of('app.alert("indirect")') } }),
  );
  fs.writeFileSync(FIX_AA_INDIRECT, await doc.save());
}

// ---------------------------------------------------------------------------
// App driving
// ---------------------------------------------------------------------------
let app = null;
let win = null;
let pageErrors = [];
let consoleErrors = [];

test.beforeAll(async () => {
  await bundlePureModule();
  await buildGoto();
  await buildMalformed();
  await buildNoS();
  await buildField();
  await buildEmbedded();
  await buildRich();
  await buildValidate();
  await buildDests();
  await buildAaDirect();
  await buildAaIndirect();
});

test.beforeEach(async () => {
  pageErrors = [];
  consoleErrors = [];
  const userData = path.join(os.tmpdir(), `adv88-userdata-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  app = await launchApp([], userData);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'adv88');
  app = null;
  win = null;
});

test.afterAll(async () => {
  try { fs.rmSync(PURE_BUNDLE, { force: true }); } catch (_) { /* ignore */ }
});

test.setTimeout(900000);

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const welcome = win.locator('[data-home-tool="open"]').first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
  } else {
    await win.keyboard.press('Control+o');
  }
  await win.waitForSelector('.workspace:visible', { timeout: 30000 });
  await win.waitForTimeout(1100);
}

async function docId() {
  const d = await win.evaluate(() => window.tflexDiagnostics());
  return d.engineDocId;
}

async function canUndo() {
  return win.evaluate(() => window.tflexDiagnostics().canUndo);
}

async function sanitize(id, options) {
  return win.evaluate(async ({ i, o }) => {
    const r = await window.tflex.engine.sanitizeDoc(i, { options: o });
    if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
    return { ok: true, report: r.value.report, warnings: r.value.warnings };
  }, { i: id, o: options });
}

async function undo(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.undo(i);
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, id);
}

async function getBytesB64(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.getDocumentBytes(i);
    if (!r.ok) return { error: r.error };
    const u = new Uint8Array(r.value);
    let s = '';
    const CH = 0x8000;
    for (let k = 0; k < u.length; k += CH) s += String.fromCharCode.apply(null, u.subarray(k, k + CH));
    return { b64: btoa(s), len: u.length };
  }, id);
}

async function bytes(id) {
  const r = await getBytesB64(id);
  if (r.error) throw new Error(`getDocumentBytes failed: ${JSON.stringify(r.error)}`);
  return Buffer.from(r.b64, 'base64');
}

async function exportText(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.exportText(i);
    if (!r.ok) return { error: r.error };
    const pages = Array.isArray(r.value) ? r.value : (r.value && r.value.pages) || [];
    return { text: pages.map((p) => p.text).join('\n') };
  }, id);
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

async function validateDoc(id, target) {
  return win.evaluate(async ({ i, t }) => {
    const r = await window.tflex.validation.validate(i, t);
    if (!r.ok) return { ok: false, code: r.error };
    return { ok: true, report: r.value };
  }, { i: id, t: target });
}

// ---------------------------------------------------------------------------
// Raw catalog reads of serialized/saved bytes
// ---------------------------------------------------------------------------
async function load(buff) {
  return PDFDocument.load(buff, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
}

function namesDict(doc) {
  const v = doc.catalog.get(PDFName.of('Names'));
  if (v === undefined) return undefined;
  return doc.context.lookupMaybe(v, PDFDict);
}

function hasJsTree(doc) {
  const n = namesDict(doc);
  return !!(n && n.has(PDFName.of('JavaScript')));
}

function hasEmbeddedTree(doc) {
  const n = namesDict(doc);
  return !!(n && n.has(PDFName.of('EmbeddedFiles')));
}

function hasDestsTree(doc) {
  const n = namesDict(doc);
  return !!(n && n.has(PDFName.of('Dests')));
}

function openAction(doc) {
  const v = doc.catalog.get(PDFName.of('OpenAction'));
  if (v === undefined) return { present: false };
  const d = doc.context.lookupMaybe(v, PDFDict);
  const s = d ? d.get(PDFName.of('S')) : undefined;
  return {
    present: true,
    isDict: !!d,
    s: s ? (s.decodeText ? s.decodeText() : String(s)) : null,
    hasFs: !!(d && d.has(PDFName.of('FS'))),
  };
}

function annotSubtypes(doc, pageIdx = 0) {
  const page = doc.getPage(pageIdx);
  const v = page.node.get(PDFName.of('Annots'));
  if (v === undefined) return [];
  const arr = doc.context.lookupMaybe(v, PDFArray);
  if (!arr) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i += 1) {
    const d = doc.context.lookupMaybe(arr.get(i), PDFDict);
    const st = d ? d.get(PDFName.of('Subtype')) : undefined;
    out.push(st && st.decodeText ? st.decodeText() : null);
  }
  return out;
}

// True when any page /AA entry resolves to an action dict whose /S resolves to
// JavaScript. Resolves an indirect /S.
function pageAaHasJs(doc, pageIdx = 0) {
  const page = doc.getPage(pageIdx);
  const v = page.node.get(PDFName.of('AA'));
  if (v === undefined) return false;
  const aa = doc.context.lookupMaybe(v, PDFDict);
  if (!aa) return false;
  for (const key of aa.keys()) {
    const act = doc.context.lookupMaybe(aa.get(key), PDFDict);
    if (!act) continue;
    const sVal = act.get(PDFName.of('S'));
    const s = doc.context.lookupMaybe(sVal, PDFName) || (sVal instanceof PDFName ? sVal : undefined);
    if (s && s.decodeText() === 'JavaScript') return true;
  }
  return false;
}

function fieldAaPresent(doc) {
  const acro = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  if (!acro) return null;
  const fields = doc.context.lookupMaybe(acro.get(PDFName.of('Fields')), PDFArray);
  if (!fields) return null;
  const out = [];
  for (let i = 0; i < fields.size(); i += 1) {
    const d = doc.context.lookupMaybe(fields.get(i), PDFDict);
    out.push(!!(d && d.has(PDFName.of('AA'))));
  }
  return out;
}

function fieldValues(doc) {
  const form = doc.getForm();
  const out = {};
  for (const name of ['adv.f1', 'adv.f2']) {
    try { out[name] = form.getTextField(name).getText(); }
    catch (e) { out[name] = `ERR:${e.message}`; }
  }
  return out;
}

// ===========================================================================
// CASE 1 — benign /GoTo /OpenAction survives sanitize + save
// ===========================================================================
test('ADV88-1 benign GoTo OpenAction survives sanitize and save', async () => {
  await openFixture(FIX_GOTO);
  const id = await docId();
  const res = await sanitize(id, ALL);
  log('1-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.report.removedByClass.launchActions, 'a GoTo must not be counted as a launch action').toBe(0);
  expect(res.report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
  expect(res.report.removedByClass.metadata).toBe(1);

  const d = await load(await bytes(id));
  const oa = openAction(d);
  log('1-serialized-openaction', oa);
  expect(oa.present, 'benign GoTo OpenAction dropped by sanitize+save').toBe(true);
  expect(oa.s).toBe('GoTo');

  await saveAs(SAVED);
  const sd = await load(fs.readFileSync(SAVED));
  const soa = openAction(sd);
  log('1-saved-openaction', soa);
  expect(soa.present, 'benign GoTo OpenAction dropped by the saved file').toBe(true);
  expect(soa.s).toBe('GoTo');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 2 — wrong-typed /Names + non-dict /OpenAction -> warning, no throw,
// other classes byte-intact
// ===========================================================================
test('ADV88-2 wrong-typed /Names and non-dict /OpenAction warn without throwing; metadata survives', async () => {
  await openFixture(FIX_MALFORMED);
  const id = await docId();
  const res = await sanitize(id, { ...NONE, javascript: true });
  log('2-sanitize', res);
  expect(res.ok, `wrong-typed objects must not throw: ${JSON.stringify(res)}`).toBe(true);
  expect(res.warnings.some((w) => w.includes('/Names')), `no /Names warning: ${JSON.stringify(res.warnings)}`).toBe(true);
  expect(res.warnings.some((w) => w.includes('/OpenAction')), `no /OpenAction warning: ${JSON.stringify(res.warnings)}`).toBe(true);
  expect(res.report.removedByClass.javascript).toBe(0);

  const d = await load(await bytes(id));
  expect(d.catalog.has(PDFName.of('Metadata')), 'unselected metadata must stay byte-intact').toBe(true);
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 2b — unreadable action objects are silently skipped (fail-loud gap)
// ===========================================================================
test('ADV88-2b unreadable action objects are reported, not silently skipped', async () => {
  await openFixture(FIX_NOS);
  const id = await docId();
  const res = await sanitize(id, ALL);
  log('2b-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);

  const hasOpenActionWarning = res.warnings.some((w) => w.includes('/OpenAction'));
  const hasAaWarning = res.warnings.some((w) => w.includes('/AA'));
  const hasAWarning = res.warnings.some((w) => w.includes('annotation 1') || w.includes('/A'));
  log('2b-warnings', { hasOpenActionWarning, hasAaWarning, hasAWarning, warnings: res.warnings });
  // Ruling 3: "an action dict with no readable /S" is a readable warning, never
  // a silent skip. All three carriers here are unreadable action objects.
  expect(
    { hasOpenActionWarning, hasAaWarning, hasAWarning },
    `silent skip: expected warnings for /OpenAction, page /AA and annotation /A; got ${JSON.stringify(res.warnings)}`,
  ).toEqual({ hasOpenActionWarning: true, hasAaWarning: true, hasAWarning: true });
});

// ===========================================================================
// CASE 3 — AcroForm field /AA JavaScript removed; benign field + value survive
// ===========================================================================
test('ADV88-3 field /AA JavaScript removed by the javascript class; values survive', async () => {
  await openFixture(FIX_FIELD);
  const id = await docId();
  const res = await sanitize(id, { ...NONE, javascript: true });
  log('3-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.report.removedByClass.javascript, 'field /AA JavaScript not counted as removed').toBeGreaterThanOrEqual(1);

  const d = await load(await bytes(id));
  const aa = fieldAaPresent(d);
  const vals = fieldValues(d);
  log('3-serialized', { fieldAaPresent: aa, fieldValues: vals });
  expect(aa, 'AcroForm Fields not readable after save').not.toBeNull();
  expect(aa[0], 'field 1 /AA JavaScript survived save').toBe(false);
  expect(vals['adv.f1'], 'benign field 1 value lost').toBe('KEEP-ONE');
  expect(vals['adv.f2'], 'benign field 2 value lost').toBe('KEEP-TWO');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 4 — EmbeddedFiles tree + FileAttachment annot removed; text annot stays
// ===========================================================================
test('ADV88-4 embedded-files tree and FileAttachment annot removed; ordinary text annotation survives', async () => {
  await openFixture(FIX_EMBEDDED);
  const id = await docId();
  const res = await sanitize(id, { ...NONE, embeddedFiles: true });
  log('4-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.report.removedByClass.embeddedFiles).toBeGreaterThanOrEqual(2); // tree + annot
  expect(res.report.removedByClass.javascript, 'javascript unselected must stay 0').toBe(0);

  const d = await load(await bytes(id));
  const subs = annotSubtypes(d, 0);
  log('4-serialized', { annotSubtypes: subs, hasEmbeddedTree: hasEmbeddedTree(d), hasJsTree: hasJsTree(d) });
  expect(subs.includes('FileAttachment'), 'FileAttachment annotation survived save').toBe(false);
  expect(subs.includes('Text'), 'ordinary text annotation was destroyed').toBe(true);
  expect(hasEmbeddedTree(d), 'EmbeddedFiles name tree survived save').toBe(false);
  expect(hasJsTree(d), 'unselected JavaScript tree must remain').toBe(true);
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 5 — sanitize -> undo -> carriers return; sanitize -> save -> reload gone
// ===========================================================================
test('ADV88-5 undo restores the sanitized carriers; save+reload removes them', async () => {
  await openFixture(FIX_RICH);
  const id = await docId();
  const before = await load(await bytes(id));
  log('5-before', { hasJsTree: hasJsTree(before), hasMetadata: before.catalog.has(PDFName.of('Metadata')) });
  expect(hasJsTree(before)).toBe(true);
  expect(before.catalog.has(PDFName.of('Metadata'))).toBe(true);

  const res = await sanitize(id, ALL);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  const after = await load(await bytes(id));
  log('5-after-sanitize', { hasJsTree: hasJsTree(after), hasMetadata: after.catalog.has(PDFName.of('Metadata')) });
  expect(hasJsTree(after), 'JS tree still present after sanitize').toBe(false);
  expect(after.catalog.has(PDFName.of('Metadata')), 'metadata still present after sanitize').toBe(false);

  const un = await undo(id);
  log('5-undo', un);
  expect(un.ok, JSON.stringify(un)).toBe(true);
  const restored = await load(await bytes(id));
  log('5-restored', { hasJsTree: hasJsTree(restored), hasMetadata: restored.catalog.has(PDFName.of('Metadata')) });
  expect(hasJsTree(restored), 'undo did not restore the JS tree').toBe(true);
  expect(restored.catalog.has(PDFName.of('Metadata')), 'undo did not restore the metadata packet').toBe(true);

  const res2 = await sanitize(id, ALL);
  expect(res2.ok, JSON.stringify(res2)).toBe(true);
  await saveAs(SAVED);
  const saved = await load(fs.readFileSync(SAVED));
  log('5-saved', { hasJsTree: hasJsTree(saved), hasMetadata: saved.catalog.has(PDFName.of('Metadata')), openAction: openAction(saved) });
  expect(hasJsTree(saved), 'saved file still carries the JS tree').toBe(false);
  expect(saved.catalog.has(PDFName.of('Metadata')), 'saved file still carries metadata').toBe(false);
  expect((await exportText(id)).text || '', 'page text lost').toContain('ROUNDTRIP KEEP');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 6 — sanitize-then-validate on the saved file
// ===========================================================================
test('ADV88-6 validator detects active content before; reports clean after save+reload', async () => {
  await openFixture(FIX_VALIDATE);
  const id = await docId();
  const pre = await validateDoc(id, 'pdfa-1b');
  log('6-pre-validate', pre.ok ? pre.report.violations.map((v) => v.rule) : pre);
  expect(pre.ok, JSON.stringify(pre)).toBe(true);
  const preRules = pre.report.violations.map((v) => v.rule);
  expect(preRules).toContain('pdfa.javascript');
  expect(preRules, 'validator must detect the external action on the unsanitized file').toContain('pdfa.external-content');

  const res = await sanitize(id, ALL);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  await saveAs(SAVED);
  await openFixture(SAVED);
  const id2 = await docId();
  const post = await validateDoc(id2, 'pdfa-1b');
  log('6-post-validate', post.ok ? post.report.violations.map((v) => v.rule) : post);
  expect(post.ok, JSON.stringify(post)).toBe(true);
  expect(post.report.violations.filter((v) => v.rule === 'pdfa.javascript'), 'sanitized file still reported with JavaScript').toEqual([]);
  const extText = post.report.violations
    .filter((v) => v.rule === 'pdfa.external-content')
    .map((v) => v.detail)
    .join(' | ');
  expect(extText.includes('external action'), `sanitized file still has an external action: ${extText}`).toBe(false);
  expect(extText.includes('file spec'), `sanitized file still embeds a file spec: ${extText}`).toBe(false);
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 7 — all-false selection is a typed no-op and mutates nothing
// ===========================================================================
test('ADV88-7 all-false selection is a typed no-op: bytes unchanged, no undo entry', async () => {
  await openFixture(FIX_RICH);
  const id = await docId();
  const before = await getBytesB64(id);
  const beforeUndo = await canUndo();

  const res = await win.evaluate(async (i) => {
    const r = await window.tflex.engine.sanitizeDoc(i, { options: { javascript: false, launchActions: false, embeddedFiles: false, metadata: false } });
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, id);
  log('7-noop', res);
  expect(res.ok).toBe(false);
  expect(res.code).toBe('no-op');
  expect(typeof res.message).toBe('string');

  const after = await getBytesB64(id);
  log('7-bytes', { lenBefore: before.len, lenAfter: after.len, equal: before.b64 === after.b64 });
  expect(after.b64, 'no-op sanitize changed the serialized document bytes').toBe(before.b64);
  expect(await canUndo(), 'no-op sanitize pushed an undo entry').toBe(beforeUndo);

  const un = await undo(id);
  log('7-undo', un);
  expect(un.ok).toBe(false);
  expect(un.code).toBe('nothing-to-undo');
});

// ===========================================================================
// CASE 8 — partial selection leaves the others; a second sanitize is 0-and-quiet
// ===========================================================================
test('ADV88-8 javascript-only leaves metadata; a second identical sanitize reports 0 per class', async () => {
  await openFixture(FIX_RICH);
  const id = await docId();
  const res1 = await sanitize(id, { ...NONE, javascript: true });
  log('8-first', res1);
  expect(res1.ok, JSON.stringify(res1)).toBe(true);
  expect(res1.report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
  expect(res1.report.removedByClass.launchActions).toBe(0);
  expect(res1.report.removedByClass.embeddedFiles).toBe(0);
  expect(res1.report.removedByClass.metadata).toBe(0);

  const d = await load(await bytes(id));
  expect(hasJsTree(d), 'javascript-only left the JS tree').toBe(false);
  expect(d.catalog.has(PDFName.of('Metadata')), 'javascript-only removed unselected metadata').toBe(true);

  const res2 = await sanitize(id, { ...NONE, javascript: true });
  log('8-second', res2);
  expect(res2.ok, `second identical sanitize threw: ${JSON.stringify(res2)}`).toBe(true);
  expect(res2.report.removedByClass).toEqual({ javascript: 0, launchActions: 0, embeddedFiles: 0, metadata: 0 });
  expect(res2.warnings, `second sanitize warned: ${JSON.stringify(res2.warnings)}`).toEqual([]);

  // Depth probe: after first sanitize the stack holds 1 entry. If the
  // no-removal SECOND sanitize is a true no-op it adds none, so the second undo
  // is `nothing-to-undo`. Evidence only (reported, not asserted): the shipped
  // engine pushes a snapshot on every non-all-false call.
  const u1 = await undo(id);
  const u2 = await undo(id);
  log('8-undo-depth', { first: u1, second: u2 });
});

// ===========================================================================
// CASE 9 — /Names carrying /Dests (no /JavaScript) is not destroyed
// ===========================================================================
test('ADV88-9 a /Names carrying /Dests but no /JavaScript is preserved', async () => {
  await openFixture(FIX_DESTS);
  const id = await docId();
  const res = await sanitize(id, ALL);
  log('9-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.report.removedByClass.javascript).toBe(0);

  const d = await load(await bytes(id));
  const n = namesDict(d);
  const dests = n ? n.get(PDFName.of('Dests')) : undefined;
  let destNames = [];
  if (dests !== undefined) {
    const tree = d.context.lookupMaybe(dests, PDFDict);
    const arr = tree ? d.context.lookupMaybe(tree.get(PDFName.of('Names')), PDFArray) : undefined;
    if (arr) for (let i = 0; i < arr.size(); i += 1) {
      const v = arr.get(i);
      destNames.push(v instanceof PDFString ? v.decodeText() : (v && v.decodeText ? v.decodeText() : String(v)));
    }
  }
  log('9-serialized', { hasDestsTree: hasDestsTree(d), destNames, openAction: openAction(d) });
  expect(hasDestsTree(d), 'the unrelated /Dests name tree was destroyed').toBe(true);
  expect(destNames.includes('destA'), 'the /Dests entry was dropped').toBe(true);
  expect(openAction(d).s).toBe('GoTo');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
});

// ===========================================================================
// CASE 10 — /Launch with /FS (working-doc semantics, pure service)
// ===========================================================================
test('ADV88-10 launchActions removes the Launch action; embeddedFiles removes its /FS', async () => {
  // (a) launchActions only -> the whole action goes.
  const docA = await PDFDocument.create();
  docA.addPage([612, 792]);
  docA.catalog.set(PDFName.of('OpenAction'), docA.context.obj({ S: 'Launch', FS: { Type: 'Filespec', F: 'att.txt' } }));
  const rA = pure.stripActiveContent(docA, { ...NONE, launchActions: true });
  const oaA = openAction(docA);
  log('10a', { report: rA.report.removedByClass, openAction: oaA });
  expect(oaA.present, 'launchActions did not remove the Launch /OpenAction').toBe(false);
  expect(rA.report.removedByClass.launchActions).toBeGreaterThanOrEqual(1);

  // (b) embeddedFiles only -> the action stays but its /FS is gone.
  const docB = await PDFDocument.create();
  docB.addPage([612, 792]);
  docB.catalog.set(PDFName.of('OpenAction'), docB.context.obj({ S: 'Launch', FS: { Type: 'Filespec', F: 'att.txt' } }));
  const rB = pure.stripActiveContent(docB, { ...NONE, embeddedFiles: true });
  const oaB = openAction(docB);
  log('10b', { report: rB.report.removedByClass, openAction: oaB });
  expect(oaB.present, 'embeddedFiles-only removed the whole action (should keep it, drop /FS)').toBe(true);
  expect(oaB.hasFs, 'embeddedFiles did not remove the Launch /FS').toBe(false);
  expect(rB.report.removedByClass.embeddedFiles).toBeGreaterThanOrEqual(1);
});

// ===========================================================================
// EXTRA X — indirect /S action name: JavaScript /AA survives sanitize AND save
// ===========================================================================
test('ADV88-X1 direct page /AA JavaScript is removed (positive control)', async () => {
  await openFixture(FIX_AA_DIRECT);
  const id = await docId();
  const res = await sanitize(id, ALL);
  log('X1-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.report.removedByClass.javascript, 'direct page /AA JavaScript not removed').toBeGreaterThanOrEqual(1);
  const d = await load(await bytes(id));
  log('X1-pageAaHasJs', pageAaHasJs(d));
  expect(pageAaHasJs(d), 'direct page /AA JavaScript survived save').toBe(false);
});

test('ADV88-X2 indirect /S JavaScript /AA survives sanitize and save (HOSTILE)', async () => {
  await openFixture(FIX_AA_INDIRECT);
  const id = await docId();
  const res = await sanitize(id, ALL);
  log('X2-sanitize', res);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  const d = await load(await bytes(id));
  const alive = pageAaHasJs(d);
  log('X2-serialized', { reportJs: res.report.removedByClass.javascript, pageAaHasJs: alive, warnings: res.warnings });
  expect(
    res.report.removedByClass.javascript,
    `indirect /S page /AA JavaScript was not removed (report=${res.report.removedByClass.javascript}); warnings=${JSON.stringify(res.warnings)}`,
  ).toBeGreaterThanOrEqual(1);
  expect(alive, 'indirect /S page /AA JavaScript survived sanitize AND save').toBe(false);
});
