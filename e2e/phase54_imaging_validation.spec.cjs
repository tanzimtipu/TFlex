// Phase 54 phase-gate e2e (QA). Universal file handling II: imaging, print
// graphics, PDF/A + PDF/X validation. Covers success criteria 1-8 and the
// phase's CONTROL-INDEX. Launches ONLY through the canonical launchApp helper.
//
// The OS open dialog is native and cannot be driven by Playwright, so the
// standard repo pattern is used: `dialog.showOpenDialog` is stubbed in the main
// process to return the fixture path, then the app's real Open button is
// clicked. The create-from-images picker is a renderer <input type=file>, so it
// is driven through Playwright's real `filechooser` event.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, runTool, gotoStage } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFArray, PDFStream, PDFRawStream, decodePDFRawStream } = require('@cantoo/pdf-lib');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase54');
const P53 = path.resolve(__dirname, '..', 'test-fixtures', 'phase53');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  dpi72: path.join(FIX, 'dpi-72.png'),
  dpi300: path.join(FIX, 'dpi-300.png'),
  dpi300jpg: path.join(FIX, 'dpi-300.jpg'),
  noDpi: path.join(FIX, 'no-dpi.png'),
  frames3: path.join(FIX, 'frames-3.tiff'),
  framesCorrupt: path.join(FIX, 'frames-corrupt.tiff'),
  framesG4: path.join(FIX, 'frames-g4.tiff'),
  frames200: path.join(FIX, 'frames-200.tiff'),
  nativeSvg: path.join(FIX, 'native.svg'),
  fallbackSvg: path.join(FIX, 'fallback.svg'),
  textSvg: path.join(FIX, 'text.svg'),
  pdfaOk: path.join(FIX, 'pdfa-1b-ok.pdf'),
  pdfaBad: path.join(FIX, 'pdfa-1b-bad.pdf'),
  pdfxCmyk: path.join(FIX, 'pdfx-1a-cmyk.pdf'),
  pdfxRgb: path.join(FIX, 'pdfx-1a-rgb.pdf'),
  p53md: path.join(P53, 'sample.md'),
  p53csv: path.join(P53, 'sample.csv'),
};

let app = null;
let win = null;
let consoleLog = [];

test.beforeEach(async () => {
  consoleLog = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase54');
  app = null;
  win = null;
});

test.setTimeout(300000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function clickOpen() {
  await win.locator('[aria-label="Open PDF document"]').first().click();
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function tabCount() {
  return win.locator('[data-tab-id]').count();
}

async function waitImportOutcome(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) return { ok: true };
    const err = consoleLog.find((l) => l.startsWith('[pageerror]'));
    if (err) return { ok: false, error: err };
    await win.waitForTimeout(200);
  }
  return { ok: false, error: 'timeout waiting for conversion notice' };
}

async function openFixture(filePath, timeout = 30000) {
  await stubOpen(filePath);
  await clickOpen();
  return waitImportOutcome(timeout);
}

// Read the active document's serialized bytes back through the app's own
// engine bridge, then parse them in Node with pdf-lib.
async function activeDocBytes() {
  const res = await win.evaluate(async () => {
    const d = window.tflexDiagnostics();
    const r = await window.tflex.engine.getDocumentBytes(d.engineDocId);
    if (!r.ok) return { error: r.error };
    const bytes = new Uint8Array(r.value);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return { b64: btoa(bin), size: bytes.length };
  });
  if (res.error) throw new Error(`getDocumentBytes failed: ${JSON.stringify(res.error)}`);
  return Buffer.from(res.b64, 'base64');
}

async function activePageSizes() {
  const bytes = await activeDocBytes();
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const s = p.getSize();
    return { w: s.width, h: s.height };
  });
}

// Drive the real Create-from-images dialog: welcome button -> renderer file
// picker (Playwright filechooser) -> confirm.
async function createFromImages(files) {
  await win.locator('[data-welcome-create]').click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  await win.waitForFunction(
    (n) => document.querySelectorAll('[data-create-image-row]').length === n,
    files.length,
    { timeout: 15000 },
  );
  await win.locator('[data-create-confirm]').click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 30000 });
  await win.waitForTimeout(600);
}

async function noticeWarnings() {
  const notice = win.locator('[data-conversion-notice]');
  const codes = await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-conversion-warning')),
  );
  const texts = await notice.locator('[data-conversion-warning]').allInnerTexts();
  return { codes, texts };
}

async function openValidateDialog() {
  await runTool(win, 'validateDocument');
  await win.waitForSelector('[data-validate-document-dialog]', { timeout: 10000 });
}

async function runValidation(target) {
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

async function zoomTo(percent) {
  for (let i = 0; i < 40; i += 1) {
    const text = await win.locator('.zoom-percent').first().innerText().catch(() => '0%');
    const cur = Number.parseInt(text, 10);
    if (Number.isFinite(cur) && cur >= percent) return cur;
    await win.locator('[aria-label="Zoom in"]').first().click();
    await win.waitForTimeout(180);
  }
  return Number.parseInt(await win.locator('.zoom-percent').first().innerText(), 10);
}

// Count device colour operators in the active document's decoded content
// streams, to prove validation never converted colour.
async function contentColorOps() {
  const bytes = await activeDocBytes();
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  let text = '';
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    try {
      const c = doc.getPage(i).node.normalizedEntries().Contents;
      if (c === undefined) continue;
      const els = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, k) => c.get(k)) : [c];
      for (const e of els) {
        const s = doc.context.lookupMaybe(e, PDFStream);
        if (s === undefined) continue;
        const raw = PDFRawStream.of(s.dict, s.getContents(), s instanceof PDFRawStream ? s.transform : undefined);
        text += Buffer.from(decodePDFRawStream(raw).decode()).toString('latin1') + '\n';
      }
    } catch {
      // undecodable page: skip
    }
  }
  const toks = text.split(/\s+/);
  return {
    rg: toks.filter((t) => t === 'rg' || t === 'RG').length,
    k: toks.filter((t) => t === 'k' || t === 'K').length,
  };
}


// ---------------------------------------------------------------------------
// Criterion 1 � mixed PNG/JPEG selection sizes each page from its own DPI.
// ---------------------------------------------------------------------------
test('criterion 1: create-from-images sizes each page from its own DPI metadata', async () => {
  await createFromImages([F.dpi72, F.dpi300jpg, F.noDpi]);
  const d = await diag();
  expect(d.openTabs, 'exactly one tab').toBe(1);
  const sizes = await activePageSizes();
  expect(sizes.length, 'three pages').toBe(3);
  // dpi-72.png: 720x360 px at 72.009 DPI (pHYs 2835 px/m).
  expect(sizes[0].w).toBeCloseTo((720 / 72.009) * 72, 1);
  expect(sizes[0].h).toBeCloseTo((360 / 72.009) * 72, 1);
  // dpi-300.jpg: 720x360 px at 300 DPI (JFIF density).
  expect(sizes[1].w).toBeCloseTo((720 / 300) * 72, 1);
  expect(sizes[1].h).toBeCloseTo((360 / 300) * 72, 1);
  // no-dpi.png: 720x360 px at the documented 96 DPI assumption.
  expect(sizes[2].w).toBeCloseTo((720 / 96) * 72, 1);
  expect(sizes[2].h).toBeCloseTo((360 / 96) * 72, 1);
  const { codes, texts } = await noticeWarnings();
  expect(codes, 'no-metadata image warns the 96 DPI assumption').toContain('dpi-assumed');
  expect(texts.join(' ')).toContain('96 DPI');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c1-create-from-images.png') });
  console.log('P54_C1 ' + JSON.stringify({ sizes, codes, texts }));
});

// ---------------------------------------------------------------------------
// Criterion 2a � a 3-frame baseline TIFF becomes a 3-page document.
// ---------------------------------------------------------------------------
test('criterion 2a: frames-3.tiff converts to a 3-page document', async () => {
  const outcome = await openFixture(F.frames3);
  expect(outcome.ok, `tiff import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  expect(d.pageCount).toBe(3);
  const sizes = await activePageSizes();
  expect(sizes.length).toBe(3);
  expect(sizes[0].w).toBeCloseTo(300, 1);
  expect(sizes[0].h).toBeCloseTo(150, 1);
  expect(sizes[1].w).toBeCloseTo(72, 1);
  expect(sizes[1].h).toBeCloseTo(144, 1);
  expect(sizes[2].w).toBeCloseTo(72, 1);
  expect(sizes[2].h).toBeCloseTo(72, 1);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c2-frames3.png') });
  console.log('P54_C2A ' + JSON.stringify({ sizes }));
});

// ---------------------------------------------------------------------------
// Criterion 2b � one corrupt frame -> placeholder page + warning, others render.
// ---------------------------------------------------------------------------
test('criterion 2b: corrupt frame yields a placeholder page and a warning', async () => {
  const outcome = await openFixture(F.framesCorrupt);
  expect(outcome.ok, `corrupt tiff import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  expect(d.pageCount, 'same page count as the intact stack').toBe(3);
  const sizes = await activePageSizes();
  expect(sizes[1].w, 'placeholder page is A4').toBeCloseTo(595.28, 1);
  expect(sizes[1].h).toBeCloseTo(841.89, 1);
  const { codes, texts } = await noticeWarnings();
  expect(codes).toContain('frame-decode-failed');
  expect(texts.join(' ')).toContain('Frame 2');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c2-corrupt.png') });
  console.log('P54_C2B ' + JSON.stringify({ sizes, codes, texts }));
});

// ---------------------------------------------------------------------------
// Criterion 2c � 200-frame TIFF: page count + peak main-process RSS.
// ---------------------------------------------------------------------------
test('criterion 2c: 200-frame TIFF converts with peak memory recorded', async () => {
  const before = await app.evaluate(() => process.memoryUsage().rss);
  await stubOpen(F.frames200);
  await clickOpen();
  let peak = before;
  const start = Date.now();
  let done = false;
  while (Date.now() - start < 180000) {
    const rss = await app.evaluate(() => process.memoryUsage().rss);
    if (rss > peak) peak = rss;
    if ((await win.locator('[data-conversion-notice]').count()) > 0) { done = true; break; }
    await win.waitForTimeout(120);
  }
  expect(done, '200-frame import did not settle').toBe(true);
  const d = await diag();
  expect(d.pageCount).toBe(200);
  const peakMb = peak / (1024 * 1024);
  console.log('P54_C2C ' + JSON.stringify({ beforeMb: before / (1024 * 1024), peakMb, pageCount: d.pageCount }));
  // The documented main-process RSS budget is < 400MB (PERFORMANCE.md).
  expect(peakMb, 'peak main-process RSS under the 400MB budget').toBeLessThan(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c2-200frames.png') });
});

// ---------------------------------------------------------------------------
// Criterion 3 � CCITT G4 decodes and renders legibly.
// ---------------------------------------------------------------------------
test('criterion 3: CCITT G4 fixture decodes and renders legibly', async () => {
  const outcome = await openFixture(F.framesG4);
  expect(outcome.ok, `g4 import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  expect(d.pageCount).toBe(1);
  const sizes = await activePageSizes();
  expect(sizes[0].w).toBeCloseTo(144, 1);
  expect(sizes[0].h).toBeCloseTo(96, 1);
  const zoom = await zoomTo(400);
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c3-g4.png') });
  console.log('P54_C3 ' + JSON.stringify({ sizes, zoom }));
});

// ---------------------------------------------------------------------------
// Criterion 4a � native.svg translates natively, no fallback warning.
// ---------------------------------------------------------------------------
test('criterion 4a: native.svg imports natively with no engine-rendered warning', async () => {
  const outcome = await openFixture(F.nativeSvg);
  expect(outcome.ok, `native svg import failed: ${outcome.error}`).toBe(true);
  const notice = win.locator('[data-conversion-notice]');
  const fidelity = await notice.getAttribute('data-conversion-fidelity');
  expect(fidelity, 'native fidelity').toBe('native');
  const { codes } = await noticeWarnings();
  expect(codes, 'no engine-rendered fallback').not.toContain('engine-rendered');
  const zoom = await zoomTo(400);
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c4-native.png') });
  console.log('P54_C4A ' + JSON.stringify({ fidelity, codes, zoom }));
});

// ---------------------------------------------------------------------------
// Criterion 4b � fallback.svg reports engine-rendered naming filter + mask.
// ---------------------------------------------------------------------------
test('criterion 4b: fallback.svg reports engine-rendered naming filter and mask', async () => {
  const outcome = await openFixture(F.fallbackSvg);
  expect(outcome.ok, `fallback svg import failed: ${outcome.error}`).toBe(true);
  const notice = win.locator('[data-conversion-notice]');
  const fidelity = await notice.getAttribute('data-conversion-fidelity');
  expect(fidelity, 'layout fidelity').toBe('layout');
  const { codes, texts } = await noticeWarnings();
  expect(codes).toContain('engine-rendered');
  const joined = texts.join(' ');
  expect(joined, 'names filter').toContain('filter');
  expect(joined, 'names mask').toContain('mask');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c4-fallback.png') });
  console.log('P54_C4B ' + JSON.stringify({ fidelity, codes, texts }));
});

// ---------------------------------------------------------------------------
// Criterion 4c � text.svg reports engine-rendered naming text.
// ---------------------------------------------------------------------------
test('criterion 4c: text.svg reports engine-rendered naming text', async () => {
  const outcome = await openFixture(F.textSvg);
  expect(outcome.ok, `text svg import failed: ${outcome.error}`).toBe(true);
  const notice = win.locator('[data-conversion-notice]');
  const fidelity = await notice.getAttribute('data-conversion-fidelity');
  expect(fidelity).toBe('layout');
  const { codes, texts } = await noticeWarnings();
  expect(codes).toContain('engine-rendered');
  expect(texts.join(' ')).toContain('text');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c4-text.png') });
  console.log('P54_C4C ' + JSON.stringify({ fidelity, codes, texts }));
});

// ---------------------------------------------------------------------------
// Criterion 5a � pdfa-1b-ok reports the declared level and zero errors.
// ---------------------------------------------------------------------------
test('criterion 5a: pdfa-1b-ok reports declared level and zero errors', async () => {
  await stubOpen(F.pdfaOk);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await runValidation('pdfa-1b');
  const r = await inlineReport();
  console.log('P54_C5A ' + JSON.stringify(r));
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c5-pdfa-ok.png') });
  expect(r.target).toBe('pdfa-1b');
  expect(r.declared).toBe('PDF/A-1b');
  expect(r.conforms).toBe('true');
  expect(r.rules.filter((x) => x.severity === 'error')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Criterion 5b � pdfa-1b-bad reports each violation with its rule name.
// ---------------------------------------------------------------------------
test('criterion 5b: pdfa-1b-bad reports each violation with its rule name', async () => {
  await stubOpen(F.pdfaBad);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await runValidation('pdfa-1b');
  const r = await inlineReport();
  console.log('P54_C5B ' + JSON.stringify(r));
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c5-pdfa-bad.png') });
  expect(r.declared).toBe('PDF/A-1b');
  expect(r.conforms).toBe('false');
  const rules = r.rules.map((x) => x.rule);
  expect(rules).toContain('pdfa.output-intent');
  expect(rules).toContain('pdfa.font-embedding');
});

// ---------------------------------------------------------------------------
// Criterion 5 (rule set) — validateBytes on the raw fixture proves the rule set
// itself is correct, isolating the opened-document defect (DEF-378).
// ---------------------------------------------------------------------------
test('criterion 5 (rule set): validateBytes on the raw fixture reports the declared level', async () => {
  const bytes = Array.from(fs.readFileSync(F.pdfaOk));
  const res = await win.evaluate(async (arr) => {
    return window.tflex.validation.validateBytes(new Uint8Array(arr), 'pdfa-1b');
  }, bytes);
  expect(res.ok).toBe(true);
  expect(res.value.declared).toBe('PDF/A-1b');
  expect(res.value.conforms).toBe(true);
  expect(res.value.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
  console.log('P54_C5_RAWB ' + JSON.stringify(res.value));
});

// ---------------------------------------------------------------------------
// Criterion 5c — a blocked save is refused with the list and writes no file.
// ---------------------------------------------------------------------------
test('criterion 5c: blocked save is refused and writes no file', async () => {
  await stubOpen(F.pdfaBad);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await win.locator('[data-validation-target="pdfa-1b"]').check();
  await win.locator('[data-validation-on-violation="block"]').check();
  await win.locator('[data-validation-remember]').check();
  await win.waitForTimeout(1500);
  await win.locator('[data-validation-close]').click();
  await win.waitForTimeout(500);

  const outPath = path.join(os.tmpdir(), `tflex-p54-blocked-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(3500);

  const notice = win.locator('[data-validation-notice]').first();
  await expect(notice).toHaveCount(1);
  const variant = await notice.getAttribute('data-validation-variant');
  expect(variant, 'blocked notice').toBe('blocked');
  const rules = await notice.locator('[data-validation-violation]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-validation-rule')),
  );
  expect(rules).toContain('pdfa.output-intent');
  expect(rules).toContain('pdfa.font-embedding');
  expect(fs.existsSync(outPath), 'no file was written').toBe(false);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c5-blocked.png') });
  console.log('P54_C5C ' + JSON.stringify({ variant, rules, wrote: fs.existsSync(outPath) }));
});

// ---------------------------------------------------------------------------
// Criterion 6a � pdfx-1a-cmyk passes output-intent/CMYK/embedding checks.
// ---------------------------------------------------------------------------
test('criterion 6a: pdfx-1a-cmyk passes the output-intent/CMYK/embedding checks', async () => {
  await stubOpen(F.pdfxCmyk);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await runValidation('pdfx-1a');
  const r = await inlineReport();
  console.log('P54_C6A ' + JSON.stringify(r));
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c6-pdfx-cmyk.png') });
  expect(r.declared).toBe('PDF/X-1:2001');
  expect(r.conforms).toBe('true');
  expect(r.rules.filter((x) => x.severity === 'error')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Criterion 6b � pdfx-1a-rgb is non-conforming on device-rgb, never converted.
// ---------------------------------------------------------------------------
test('criterion 6b: pdfx-1a-rgb is non-conforming on device-rgb and not converted', async () => {
  await stubOpen(F.pdfxRgb);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await runValidation('pdfx-1a');
  const r = await inlineReport();
  expect(r.conforms).toBe('false');
  const rgb = r.rules.find((x) => x.rule === 'pdfx.device-rgb');
  expect(rgb, 'device-rgb rule reported').toBeTruthy();
  const detail = r.details.find((t) => t.includes('Device-RGB'));
  expect(detail, 'names the page').toContain('page(s) 1');
  expect(detail, 'states no conversion').toContain('No colour conversion was performed');
  // No silent conversion: the document still carries device-RGB operators and
  // no CMYK operators after validation.
  const ops = await contentColorOps();
  expect(ops.rg, 'device-RGB operators still present (no conversion)').toBeGreaterThan(0);
  expect(ops.k, 'no CMYK conversion happened').toBe(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c6-pdfx-rgb.png') });
  console.log('P54_C6B ' + JSON.stringify({ rules: r.rules, detail, ops }));
});

// ---------------------------------------------------------------------------
// Criterion 7 � 300 DPI PNG export dimensions match page inches x 300.
// ---------------------------------------------------------------------------
test('criterion 7: 300 DPI PNG export dimensions match page inches x 300', async () => {
  await createFromImages([F.dpi300]);
  const sizes = await activePageSizes();
  const pageW = sizes[0].w;
  const pageH = sizes[0].h;
  await win.evaluate(() => {
    window.__p54Blobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__p54Blobs.push(b); return orig(b); };
  });
  await runTool(win, 'exportPages');
  await win.waitForSelector('[data-export-dialog]', { timeout: 10000 });
  await win.locator('[data-export-format="png"]').check();
  await win.locator('[data-export-dpi]').fill('300');
  await win.locator('[data-export-dpi]').blur();
  await win.waitForTimeout(300);
  await win.locator('[data-export-confirm]').click();
  await win.waitForFunction(() => window.__p54Blobs && window.__p54Blobs.length > 0, null, { timeout: 90000 });
  const b64 = await win.evaluate(async () => {
    const b = window.__p54Blobs[0];
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const png = Buffer.from(b64, 'base64');
  expect(png.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const expW = Math.round((pageW / 72) * 300);
  const expH = Math.round((pageH / 72) * 300);
  console.log('P54_C7 ' + JSON.stringify({ pageW, pageH, width, height, expW, expH }));
  expect(width, 'exported PNG width').toBe(expW);
  expect(height, 'exported PNG height').toBe(expH);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-c7-export.png') });
});

// ---------------------------------------------------------------------------
// Item 4 � default target 'none' leaves a normal save completely unguarded.
// ---------------------------------------------------------------------------
test('item 4: default target none leaves a normal save unguarded', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  const outPath = path.join(os.tmpdir(), `tflex-p54-none-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(3500);
  expect(fs.existsSync(outPath), 'file written with no guard').toBe(true);
  expect(await win.locator('[data-validation-notice]').count(), 'no validation ran').toBe(0);
  console.log('P54_ITEM4 ' + JSON.stringify({ wrote: fs.existsSync(outPath), notices: await win.locator('[data-validation-notice]').count() }));
});

// ---------------------------------------------------------------------------
// Item 5 � the SVG fallback page box is the SVG's intrinsic size, not A4.
// ---------------------------------------------------------------------------
test('item 5: fallback.svg page box is the SVG intrinsic size, not A4', async () => {
  const outcome = await openFixture(F.fallbackSvg);
  expect(outcome.ok, `fallback svg import failed: ${outcome.error}`).toBe(true);
  const sizes = await activePageSizes();
  // Unitless SVG length is a CSS px at 96 DPI: 240x160 px -> 180x120 pt.
  expect(sizes[0].w).toBeCloseTo(180, 0);
  expect(sizes[0].h).toBeCloseTo(120, 0);
  expect(Math.abs(sizes[0].w - 595.28), 'not A4 width').toBeGreaterThan(10);
  console.log('P54_ITEM5 ' + JSON.stringify({ sizes }));
});

// ---------------------------------------------------------------------------
// Item 6 � Phase 53 .md and .csv import paths still work.
// ---------------------------------------------------------------------------
test('item 6: Phase 53 .md and .csv imports still work', async () => {
  const cases = [[F.p53md, 'Markdown document'], [F.p53csv, 'CSV spreadsheet']];
  const results = [];
  for (const [file, label] of cases) {
    const outcome = await openFixture(file);
    expect(outcome.ok, `${file} import failed: ${outcome.error}`).toBe(true);
    const source = await win.locator('[data-conversion-notice] [data-conversion-source]').innerText();
    const d = await diag();
    results.push({ file: path.basename(file), source, pageCount: d.pageCount });
    expect(source).toBe(label);
    expect(d.pageCount).toBeGreaterThanOrEqual(1);
    await win.locator('[data-tab-id] .tab-close').first().click();
    await win.waitForTimeout(600);
  }
  console.log('P54_ITEM6 ' + JSON.stringify(results));
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX � the validate dialog's controls and the verb.
// ---------------------------------------------------------------------------
test('control-index: validateDocument verb and dialog controls', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // The verb lives on the REVIEW dock and is enabled with a document open.
  await gotoStage(win, 3);
  const verb = win.locator('[data-dock-verb="validateDocument"]');
  await expect(verb).toHaveCount(1);
  const verbDisabled = await verb.first().isDisabled();
  expect(verbDisabled, 'verb enabled with a document').toBe(false);

  await verb.first().click();
  await win.waitForSelector('[data-validate-document-dialog]', { timeout: 10000 });

  // Target radios: exactly the six profiles plus the none opt-out.
  const targets = await win.locator('[data-validation-target]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-validation-target')),
  );
  expect(targets).toEqual(['pdfa-1b', 'pdfa-2b', 'pdfa-3b', 'pdfx-1a', 'pdfx-3', 'pdfx-4', 'none']);
  // onViolation radios.
  expect(await win.locator('[data-validation-on-violation]').count()).toBe(2);
  // Remember control.
  expect(await win.locator('[data-validation-remember]').count()).toBe(1);

  // Run is disabled with a reason while the target is 'none'.
  const run = win.locator('[data-validation-run]');
  expect(await run.isDisabled(), 'run disabled on none').toBe(true);
  const reason = await run.getAttribute('title');
  expect(reason, 'disabled reason present').toBe('Choose a target to validate against');

  // Choosing a target enables Run.
  await win.locator('[data-validation-target="pdfa-1b"]').check();
  expect(await run.isDisabled(), 'run enabled after choosing a target').toBe(false);

  // Run produces the inline report card.
  await run.click();
  await win.waitForSelector('[data-validation-inline-report] [data-validation-notice]', { timeout: 20000 });
  const inline = win.locator('[data-validation-inline-report] [data-validation-notice]').first();
  const title = await inline.locator('[data-validation-title]').innerText();
  const note = await inline.locator('[data-validation-note]').innerText();
  expect(title).toBe('Validation report');
  expect(note).toContain('reports what the file declares');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-ci-dialog.png') });

  // Close the dialog; the per-tab card is dismissible.
  await win.locator('[data-validation-close]').click();
  await win.waitForTimeout(400);
  const card = win.locator('.document-column [data-validation-notice]').first();
  await expect(card).toHaveCount(1);
  await card.locator('[data-validation-dismiss]').click();
  await win.waitForTimeout(400);
  expect(await win.locator('.document-column [data-validation-notice]').count(), 'card dismissed').toBe(0);
  console.log('P54_CI ' + JSON.stringify({ verbDisabled, targets, reason, title, note }));
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX � the warned-save notice writes the file and reports.
// ---------------------------------------------------------------------------
test('control-index: warned save writes the file and shows the warned notice', async () => {
  await stubOpen(F.pdfaBad);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await openValidateDialog();
  await win.locator('[data-validation-target="pdfa-1b"]').check();
  await win.locator('[data-validation-on-violation="warn"]').check();
  await win.locator('[data-validation-remember]').check();
  await win.waitForTimeout(1500);
  await win.locator('[data-validation-close]').click();
  await win.waitForTimeout(500);

  const outPath = path.join(os.tmpdir(), `tflex-p54-warned-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(3500);

  const notice = win.locator('[data-validation-notice]').first();
  await expect(notice).toHaveCount(1);
  const variant = await notice.getAttribute('data-validation-variant');
  expect(variant, 'warned notice').toBe('warned');
  expect(fs.existsSync(outPath), 'file written under warn').toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'phase54-ci-warned.png') });
  console.log('P54_CI_WARN ' + JSON.stringify({ variant, wrote: fs.existsSync(outPath) }));
});
