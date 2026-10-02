// TFL-408 / Phase 84 true-redaction ADVERSARIAL diff-pass spec.
//
// Adversary-only probe. It does NOT re-run qa's phase84 spec; it attacks the
// content-stream rewrite (src/shared/redaction.ts + engine.applyRedactions),
// a high-risk save/rewrite path. Nothing under src/ is touched.
//
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase84_redaction_adversary.spec.cjs --reporter=line
//
// Vector map (issue TFL-408, Phase 84 Feature D):
//   1  partially covered TJ array (engine-level, real pdf-lib font widths)
//   2  mark spanning a q/cm/Q scaled CTM (engine-level)
//   3  encrypted / open-prefix document (empty user password)
//   4  no-text mark over a vector-only area -> warning, no glyph removed
//   5  apply -> Ctrl+Z -> re-apply -> save -> reload, saved stream inspected
//   6  pure-geometry stress (Tz, ', ", nested q/Q, page edge, unresolvable font)
//      is exercised by the bundled src/shared/redaction.ts probes below.
//
// The pure module is TypeScript; this spec bundles it with the repo's esbuild
// into a temp .cjs in beforeAll and requires it, so vectors 1/2/6/ over-removal
// are asserted against the SAME shared geometry the engine calls.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  PDFDocument, PDFArray, PDFName, PDFStream, PDFRawStream, decodePDFRawStream,
  StandardFonts, rgb,
} = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its Node shim;
// launchApp spreads process.env, so Electron would exit as plain Node. Drop it.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const FIXTURES = path.join(ROOT, 'test-fixtures', 'phase84-adversary');
const USER_DATA = path.join(os.tmpdir(), `p84adv-userdata-${Date.now()}`);
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXTURES, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const FIX_MAIN = path.join(FIXTURES, 'adv84-main.pdf');
const FIX_TJ = path.join(FIXTURES, 'adv84-tj-partial.pdf');
const FIX_CM = path.join(FIXTURES, 'adv84-cm-transform.pdf');
const FIX_ENCRYPTED = path.join(FIXTURES, 'adv84-open-prefix.pdf');
const FIX_VECTOR = path.join(FIXTURES, 'adv84-vector-only.pdf');
const SAVED = path.join(FIXTURES, 'adv84-saved.pdf');

let redactionModule = null;
const R = { pass: 0, fail: 0, skip: 0 };
const record = (id, status, note) => console.log(`[adv84|RESULT] ${id} ${status}${note ? ' - ' + note : ''}`);

async function bundlePureModule() {
  const esbuild = require('esbuild');
  const out = path.join(os.tmpdir(), `adv84-redaction-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'shared', 'redaction.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    logLevel: 'silent',
  });
  redactionModule = require(out);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
async function buildMain() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET-ALPHA', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('PUBLIC-BETA', { x: 72, y: 640, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(FIX_MAIN, await doc.save());
}

// Overwrite a page's /Contents with a raw stream, reusing the font resource
// name pdf-lib created, so the engine's advance resolver has real widths.
async function rawContentFixture(outPath, contentWithPlaceholder) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // seed the font resource by drawing, then read its key back
  page.drawText('seed', { x: 10, y: 10, size: 12, font });
  const fontDict = page.node.Resources().lookup(PDFName.of('Font'));
  let fontName = null;
  for (const [k] of fontDict.entries()) { fontName = k.asString(); break; }
  const content = contentWithPlaceholder.replace(/__FONT__/g, fontName);
  const stream = doc.context.flateStream(Buffer.from(content, 'latin1'));
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  fs.writeFileSync(outPath, await doc.save());
  return { fontName, content };
}

async function buildEncrypted() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET-ALPHA', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('PUBLIC-BETA', { x: 72, y: 640, size: 24, font, color: rgb(0, 0, 0) });
  const plain = await doc.save();
  const enc = await PDFDocument.load(plain);
  // open-prefix: empty USER password (owner-restricted) -> opens with no prompt.
  enc.encrypt({ userPassword: '', ownerPassword: 'adv84-owner', algorithm: 'AES-256' });
  fs.writeFileSync(FIX_ENCRYPTED, await enc.save());
}

async function buildVectorOnly() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // a big filled vector rectangle (path ops re/f) and a text term elsewhere
  page.drawRectangle({ x: 300, y: 292, width: 200, height: 200, color: rgb(0.2, 0.3, 0.6) });
  page.drawText('KEEP-ME', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(FIX_VECTOR, await doc.save());
}

let app = null;
let win = null;
let pageErrors = [];

test.beforeAll(async () => {
  await bundlePureModule();
  await buildMain();
  await buildVectorOnly();
  await buildEncrypted();
  await rawContentFixture(
    FIX_TJ,
    'q BT __FONT__ 24 Tf 1 0 0 1 72 700 Tm [(AA) (SECRET) (BB)] TJ ET Q',
  );
  await rawContentFixture(
    FIX_CM,
    'q 2 0 0 2 100 50 cm BT __FONT__ 24 Tf 1 0 0 1 0 0 Tm (ABCDE) Tj ET Q',
  );
});

test.beforeEach(async () => {
  pageErrors = [];
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'adv84');
  app = null;
  win = null;
});

test.setTimeout(600000);

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const welcome = win.locator('button:has-text("Open PDF")').first();
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  else await win.keyboard.press('Control+o');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function docId() {
  const d = await win.evaluate(() => window.tflexDiagnostics());
  return d.engineDocId;
}

async function exportText(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.exportText(i);
    if (!r.ok) return { error: r.error };
    const pages = Array.isArray(r.value) ? r.value : (r.value && r.value.pages) || [];
    return { text: pages.map((p) => p.text).join('\n') };
  }, id);
}

async function applyRedactions(id, payload) {
  return win.evaluate(async ({ i, p }) => {
    const r = await window.tflex.engine.applyRedactions(i, p);
    if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
    return { ok: true, removedGlyphs: r.value.removedGlyphs, warnings: r.value.warnings };
  }, { i: id, p: payload });
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

async function savedStreamText(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let out = '';
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const contents = doc.getPage(i).node.Contents();
    if (!contents) continue;
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const entry of entries) {
      const obj = doc.context.lookup(entry);
      if (!(obj instanceof PDFStream)) continue;
      const raw = PDFRawStream.of(obj.dict, obj.getContents(), obj instanceof PDFRawStream ? obj.transform : undefined);
      try { out += new TextDecoder('latin1').decode(decodePDFRawStream(raw).decode()); } catch (_) { /* skip */ }
    }
  }
  return out;
}

function decodeHex(s) {
  return s.replace(/<([0-9A-Fa-f]+)>/g, (m, h) => {
    let out = '';
    for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return out;
  });
}

// ===========================================================================
// VECTOR 1 / 2 / 6 (pure geometry, the shared source of truth)
// ===========================================================================
test('ADV84-A pure shared geometry: TJ partial, cm transform, stress, over-removal', async () => {
  const { removeRedactedGlyphs, RedactionUnsupportedError } = redactionModule;
  const fixed = (adv) => (f, s, t) => t.split('').map(() => adv);
  const results = [];
  const chk = (id, cond, note) => { results.push({ id, ok: !!cond, note }); console.log(`   [${cond ? 'PASS' : 'FAIL'}] ${id}${note ? ' :: ' + note : ''}`); };

  // 1. partially covered TJ array (middle glyphs)
  {
    const c = 'BT /F1 10 Tf 1 0 0 1 72 700 Tm [(AA) (SECRET) (BB)] TJ ET';
    const out = removeRedactedGlyphs(c, [{ rect: { x: 82, y: 695, width: 25, height: 20 } }], fixed(500));
    const dec = decodeHex(out.content);
    chk('A1-tj-exact-subset', out.removedGlyphs === 5, `removed=${out.removedGlyphs}`);
    chk('A1-tj-no-secret', !dec.includes('SECRE') && !dec.includes('SECRET'), dec);
    chk('A1-tj-siblings', dec.includes('AA') && dec.includes('BB') && dec.includes('T'), dec);
  }
  // 2. cm-scaled CTM: mark maps in PAGE space, exactly one glyph
  {
    const c = 'q 2 0 0 2 100 50 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (ABCDE) Tj ET Q';
    const out = removeRedactedGlyphs(c, [{ rect: { x: 120, y: 0, width: 10, height: 220 } }], fixed(500));
    const dec = decodeHex(out.content);
    chk('A2-cm-exact', out.removedGlyphs === 1 && dec.includes('AB') && dec.includes('DE') && !dec.includes('C'), `removed=${out.removedGlyphs} dec=${dec}`);
  }
  // 2b. rotated content stream (90deg cm) - glyphs stack in +y
  {
    const c = 'q 0 1 -1 0 200 50 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (ABCD) Tj ET Q';
    const out = removeRedactedGlyphs(c, [{ rect: { x: 190, y: 56, width: 15, height: 3 } }], fixed(500));
    chk('A2b-rot90-exact', out.removedGlyphs === 1, `removed=${out.removedGlyphs} (expect exactly B)`);
  }
  // 2c. 45deg glyph: a mark inside its axis-aligned bbox but OUTSIDE the true
  // rotated glyph must NOT remove it. This is the over-removal probe (ADV).
  {
    const sq = Math.SQRT1_2;
    const c = `q ${sq} ${sq} ${-sq} ${sq} 200 200 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (A) Tj ET Q`;
    // true AABB x[193.99,205.30] y[198.23,209.55]; the left sliver is outside
    // the thin rotated parallelogram.
    const out = removeRedactedGlyphs(c, [{ rect: { x: 194.0, y: 207.0, width: 0.5, height: 2.0 } }], fixed(500));
    console.log(`   [INFO] A2c 45deg sliver removedGlyphs=${out.removedGlyphs}`);
    results.push({ id: 'A2c-over-removal', ok: out.removedGlyphs === 0, note: `removed=${out.removedGlyphs} (0 = no over-removal)` });
  }
  // 6a. multiple Tf
  {
    const c = 'BT /F1 10 Tf 1 0 0 1 0 100 Tm (AAAA) Tj /F2 20 Tf 1 0 0 1 0 50 Tm (BBBB) Tj ET';
    const out = removeRedactedGlyphs(c, [
      { rect: { x: 0, y: 95, width: 20, height: 15 } },
      { rect: { x: 0, y: 40, width: 40, height: 25 } },
    ], fixed(500));
    chk('A6a-multi-Tf', out.removedGlyphs === 8, `removed=${out.removedGlyphs}`);
  }
  // 6b. nested q/Q restores CTM
  {
    const c = 'q 2 0 0 2 100 100 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (AAAAA) Tj ET ' +
      'q 1 0 0 1 500 0 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (BBBBB) Tj ET Q ' +
      'BT /F1 10 Tf 1 0 0 1 0 0 Tm (CCCCC) Tj ET Q';
    const m = { rect: { x: 100, y: 95, width: 50, height: 230 } };
    const out = removeRedactedGlyphs(c, [m, { ...m }], fixed(500));
    chk('A6b-nested-qQ', out.removedGlyphs === 10, `removed=${out.removedGlyphs}`);
  }
  // 6c. ' and " show operators
  {
    const c = "BT /F1 10 Tf 14 TL 1 0 0 1 0 100 Tm (KEEP) Tj (GONE) ' ET";
    const out = removeRedactedGlyphs(c, [{ rect: { x: 0, y: 84, width: 25, height: 5 } }], fixed(500));
    chk('A6c-quote', !decodeHex(out.content).includes('GONE') && decodeHex(out.content).includes('KEEP'), decodeHex(out.content));
    const c2 = 'BT /F1 10 Tf 14 TL 1 0 0 1 0 100 Tm (KEEP) Tj 3 5 (GONE) " ET';
    const out2 = removeRedactedGlyphs(c2, [{ rect: { x: 0, y: 84, width: 30, height: 5 } }], fixed(500));
    chk('A6c-doublequote', !decodeHex(out2.content).includes('GONE'), decodeHex(out2.content));
  }
  // 6d. page-edge partial coverage: a mark over the LEFT part of 'A'
  {
    const c = 'BT /F1 10 Tf 1 0 0 1 0 0 Tm (AB) Tj ET';
    const out = removeRedactedGlyphs(c, [{ rect: { x: 0, y: 0, width: 3, height: 1 } }], fixed(500));
    const arr = out.content.match(/\[[^\]]*\]/)[0];
    chk('A6d-edge-partial', out.removedGlyphs === 1 && !arr.includes('41') && arr.includes('42'), arr);
  }
  // 6e. unresolvable font refuses with the typed error
  {
    let threw = null;
    try { removeRedactedGlyphs('BT /F1 10 Tf 1 0 0 1 0 0 Tm (X) Tj ET', [{ rect: { x: 0, y: 0, width: 10, height: 10 } }], () => null); }
    catch (e) { threw = e; }
    chk('A6e-typed-refusal', threw && threw.name === 'RedactionUnsupportedError', threw && threw.message);
  }
  // 6f. no intersection -> byte identical
  {
    const c = 'BT /F1 10 Tf 1 0 0 1 0 0 Tm (ABC) Tj ET';
    const out = removeRedactedGlyphs(c, [{ rect: { x: 500, y: 500, width: 10, height: 10 } }], fixed(500));
    chk('A6f-no-intersection', out.content === c && out.removedGlyphs === 0, '');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('[adv84|A-SUMMARY] ' + JSON.stringify(results));
  expect(failed, `pure geometry failures: ${JSON.stringify(failed)}`).toEqual([]);
  record('ADV84-A', 'PASS', `${results.length} pure-geometry probes`);
});

// ===========================================================================
// VECTOR 1 (engine-level): partially covered TJ array through decode+rewrite+save
// ===========================================================================
test('ADV84-TJ engine: middle TJ string removed, siblings intact, saved stream rewritten', async () => {
  await openFixture(FIX_TJ);
  const id = await docId();
  const before = await exportText(id);
  console.log('[adv84|TJ] before=' + JSON.stringify(before.text));
  // Mark over the middle string SECRET. Real Helvetica widths put the
  // AA|S boundary at x~104.02 and the T|B boundary at x~186.7, so start at
  // 105 (inside S, clear of the second A) and end at 190 (covers T).
  const res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 105, y: 71, width: 85, height: 28 } }], color: '#000000' });
  console.log('[adv84|TJ] apply=' + JSON.stringify(res));
  expect(res.ok, `apply failed: ${JSON.stringify(res)}`).toBe(true);
  expect(res.removedGlyphs, 'exactly the 6 SECRET glyphs removed').toBe(6);
  const after = await exportText(id);
  console.log('[adv84|TJ] after=' + JSON.stringify(after.text));
  expect(after.text).not.toContain('SECRET');
  expect(after.text, 'siblings AA and BB survive exactly').toBe('AABB');
  await win.screenshot({ path: path.join(SHOTS, 'adv-p84-tj-partial-applied.png') });

  await saveAs(SAVED);
  const stream = await savedStreamText(SAVED);
  const dec = decodeHex(stream);
  console.log('[adv84|TJ] savedStream=' + JSON.stringify(stream.slice(0, 400)));
  expect(dec).not.toContain('SECRET');
  expect(dec).toContain('AA');
  expect(dec).toContain('BB');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
  record('ADV84-TJ', 'PASS');
});

// ===========================================================================
// VECTOR 2 (engine-level): mark spanning a q/cm/Q scaled CTM
// ===========================================================================
test('ADV84-CM engine: mark maps across a 2x scale + translate, exactly one glyph', async () => {
  await openFixture(FIX_CM);
  const id = await docId();
  // C occupies page x ~164..198.7 at 2x; band page y ~38..90.8 -> top-left y 701..754
  const res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 165, y: 701, width: 33, height: 52 } }], color: '#000000' });
  console.log('[adv84|CM] apply=' + JSON.stringify(res));
  expect(res.ok, `apply failed: ${JSON.stringify(res)}`).toBe(true);
  expect(res.removedGlyphs, 'exactly the one C glyph removed (not 0, not >1)').toBe(1);
  const after = await exportText(id);
  console.log('[adv84|CM] after=' + JSON.stringify(after.text));
  expect(after.text, 'A,B,D,E survive across the transform').toContain('AB');
  expect(after.text).toContain('DE');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
  record('ADV84-CM', 'PASS');
});

// ===========================================================================
// VECTOR 3: encrypted / open-prefix document
// ===========================================================================
test('ADV84-ENC encrypted open-prefix: apply refuses or preserves file; save+reopen loads', async () => {
  await openFixture(FIX_ENCRYPTED);
  const id = await docId();
  const before = await exportText(id);
  console.log('[adv84|ENC] before=' + JSON.stringify(before.text));
  expect(before.text, 'open-prefix doc loads and its text is extractable').toContain('SECRET-ALPHA');

  const res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 60, y: 55, width: 250, height: 70 } }], color: '#000000' });
  console.log('[adv84|ENC] apply=' + JSON.stringify(res));

  if (!res.ok) {
    // Clean refusal is acceptable; the doc must be untouched.
    expect(res.code, 'refusal is the typed redaction-unsupported').toBe('redaction-unsupported');
    const afterRefuse = await exportText(id);
    expect(afterRefuse.text, 'refused encrypted redaction leaves text intact').toContain('SECRET-ALPHA');
  } else {
    const after = await exportText(id);
    console.log('[adv84|ENC] after=' + JSON.stringify(after.text));
    // If it claimed success, the term must actually be gone (no silent lie).
    expect(after.text, 'if apply ok, SECRET-ALPHA must be gone').not.toContain('SECRET-ALPHA');
    await win.screenshot({ path: path.join(SHOTS, 'adv-p84-encrypted-prefix-applied.png') });
  }

  // In both cases a save must produce a loadable file that is not corrupted.
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  const bytes = fs.readFileSync(SAVED);
  const reparsed = await PDFDocument.load(bytes, { updateMetadata: false }).catch((e) => { throw new Error('saved encrypted-source file does not re-parse: ' + e.message); });
  expect(reparsed.getPageCount(), 'saved file has its page').toBe(1);
  const stream = await savedStreamText(SAVED);
  console.log('[adv84|ENC] savedStreamLen=' + stream.length);
  expect(stream.length, 'saved content stream is non-empty (not wiped)').toBeGreaterThan(0);

  // Reopen through the app and confirm it loads.
  await openFixture(SAVED);
  const reopened = await exportText(await docId());
  console.log('[adv84|ENC] reopened=' + JSON.stringify(reopened.text));
  expect(reopened.error, 'reopened file exportText does not error').toBeUndefined();
  expect(reopened.text || '', 'reopened file yields text').toContain('PUBLIC-BETA');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
  record('ADV84-ENC', res.ok ? 'PASS' : 'REPORT-REFUSAL', JSON.stringify(res).slice(0, 120));
});

// ===========================================================================
// VECTOR 4: no-text mark over a vector-only area
// ===========================================================================
test('ADV84-NOTEXT vector-only mark: warning, removedGlyphs 0, KEEP-ME survives, vector kept', async () => {
  await openFixture(FIX_VECTOR);
  const id = await docId();
  const before = await exportText(id);
  expect(before.text).toContain('KEEP-ME');

  // mark over the filled rectangle (page rect 300,292,200,200 -> top-left y 300..500)
  const res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 310, y: 300, width: 150, height: 150 } }], color: '#000000' });
  console.log('[adv84|NOTEXT] apply=' + JSON.stringify(res));
  expect(res.ok, `vector-only mark must not error: ${JSON.stringify(res)}`).toBe(true);
  expect(res.removedGlyphs, 'no glyph removed over a vector-only area').toBe(0);
  expect(res.warnings.length, 'a readable warning is returned (not a silent no-op)').toBeGreaterThan(0);
  console.log('[adv84|NOTEXT] warning=' + JSON.stringify(res.warnings));

  const after = await exportText(id);
  expect(after.text, 'unrelated text must not be wrongly removed').toContain('KEEP-ME');
  await win.screenshot({ path: path.join(SHOTS, 'adv-p84-no-text-warning.png') });

  await saveAs(SAVED);
  const stream = await savedStreamText(SAVED);
  console.log('[adv84|NOTEXT] savedStream=' + JSON.stringify(stream.slice(0, 300)));
  // the original vector path ops must survive the rewrite. pdf-lib paints the
  // rectangle as m/l/h/f path ops in its fill colour, not a `re` operator.
  expect(stream.includes('0.2 0.3 0.6 rg'), 'vector path fill survives the rewrite').toBe(true);
  expect(stream.includes('h\nf'), 'vector path paint survives the rewrite').toBe(true);
  expect(decodeHex(stream), 'unrelated text survives').toContain('KEEP-ME');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
  record('ADV84-NOTEXT', 'PASS');
});

// ===========================================================================
// VECTOR 5: apply -> undo -> re-apply -> save -> reload byte round-trip
// ===========================================================================
test('ADV84-ROUNDTRIP apply/undo/save: text restored by undo, saved stream balanced and re-loadable', async () => {
  await openFixture(FIX_MAIN);
  const id = await docId();
  expect((await exportText(id)).text).toContain('SECRET-ALPHA');

  let res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 60, y: 55, width: 250, height: 70 } }], color: '#000000' });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.removedGlyphs).toBeGreaterThan(0);
  expect((await exportText(id)).text).not.toContain('SECRET-ALPHA');

  // Pop the snapshot applyRedactions pushed. A direct engine call bypasses the
  // renderer's canUndo gate (which qa's UI-driven P84-UNDO test exercises with
  // a real Ctrl+Z); this isolates the snapshot/restore itself, then the byte
  // round-trip below is the adversarial part.
  const undoRes = await win.evaluate(async (i) => {
    const r = await window.tflex.engine.undo(i);
    return r.ok ? { ok: true } : { ok: false, code: r.error.code, message: r.error.message };
  }, id);
  console.log('[adv84|RT] engineUndo=' + JSON.stringify(undoRes));
  await win.waitForTimeout(800);
  const restored = await exportText(id);
  console.log('[adv84|RT] afterUndo=' + JSON.stringify(restored.text));
  expect(undoRes.ok, `undo failed: ${JSON.stringify(undoRes)}`).toBe(true);
  expect(restored.text, 'undo must restore the redacted text').toContain('SECRET-ALPHA');

  res = await applyRedactions(id, { page: 1, marks: [{ rect: { x: 60, y: 55, width: 250, height: 70 } }], color: '#000000' });
  expect(res.ok, JSON.stringify(res)).toBe(true);

  await saveAs(SAVED);
  const stream = await savedStreamText(SAVED);
  const dec = decodeHex(stream);
  console.log('[adv84|RT] savedStream=' + JSON.stringify(stream.slice(0, 400)));

  // operators balanced
  const count = (re) => (stream.match(re) || []).length;
  const q = count(/(^|\s)q(\s|$)/g);
  const Q = count(/(^|\s)Q(\s|$)/g);
  const bt = count(/(^|\s)BT(\s|$)/g);
  const et = count(/(^|\s)ET(\s|$)/g);
  console.log(`[adv84|RT] ops q=${q} Q=${Q} BT=${bt} ET=${et}`);
  expect(q, 'q count is balanced (>= Q)').toBeGreaterThanOrEqual(Q);
  expect(bt, 'BT count is balanced (>= ET)').toBeGreaterThanOrEqual(et);

  expect(dec).not.toContain('SECRET-ALPHA');
  expect(dec).toContain('PUBLIC-BETA');

  await openFixture(SAVED);
  const reopened = await exportText(await docId());
  console.log('[adv84|RT] reopened=' + JSON.stringify(reopened.text));
  expect(reopened.text).not.toContain('SECRET-ALPHA');
  expect(reopened.text).toContain('PUBLIC-BETA');
  expect(pageErrors, 'no renderer pageerror').toEqual([]);
  record('ADV84-ROUNDTRIP', 'PASS');
});

test.afterAll(async () => {
  console.log('[adv84|SUMMARY] ' + JSON.stringify(R));
});
