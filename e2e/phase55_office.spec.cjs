// Phase 55 phase-gate e2e (QA). Universal file handling III: bidirectional
// office conversion. Covers success criteria 1-8 and the CONTROL-INDEX rows.
// Launches ONLY through the canonical launchApp helper.
//
// The OS open dialog is native and cannot be driven by Playwright, so the
// standard repo pattern is used: `dialog.showOpenDialog` is stubbed in the main
// process to return the fixture path, then the app's real Open button is
// clicked. Exports are driven through the REAL dialogs; the produced file is
// captured from the default session's `will-download` event.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, clickDockVerb, gotoStage } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase55');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  docx: path.join(FIX, 'sample.docx'),
  odt: path.join(FIX, 'sample.odt'),
  doc: path.join(FIX, 'legacy.doc'),
  ppt: path.join(FIX, 'legacy.ppt'),
  xlsx: path.join(FIX, 'sample.xlsx'),
  rows20k: path.join(FIX, 'rows20000.xlsx'),
  rowsOver: path.join(FIX, 'rows_over_ceiling.xlsx'),
  pptx: path.join(FIX, 'sample.pptx'),
  imageOnly: path.join(FIX, 'image-only.pdf'),
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
  if (app) await hardClose(app, 'phase55');
  app = null;
  win = null;
});

test.setTimeout(600000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__p55Filters = null;
    dialog.showOpenDialog = async (opts) => {
      globalThis.__p55Filters = opts && opts.filters ? opts.filters : null;
      return { canceled: false, filePaths: [p] };
    };
  }, filePath);
}

async function lastFilters() {
  return app.evaluate(async () => globalThis.__p55Filters);
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

async function noticeInfo() {
  const notice = win.locator('[data-conversion-notice]');
  if ((await notice.count()) === 0) return null;
  return {
    source: await notice.locator('[data-conversion-source]').innerText(),
    fidelity: await notice.locator('[data-conversion-fidelity-label]').innerText(),
    fidelityAttr: await notice.getAttribute('data-conversion-fidelity'),
    codes: await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-conversion-warning'))),
    warnings: await notice.locator('[data-conversion-warning]').allInnerTexts(),
  };
}

async function engineText(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return { error: r.error };
    return { pages: r.value };
  }, docId);
}

async function engineBytesBase64(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.getDocumentBytes(id);
    if (!r.ok) return null;
    const bytes = new Uint8Array(r.value);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, docId);
}

function fromBase64(b64) {
  return Buffer.from(b64, 'base64');
}

// PDF text items with their font size (transform[3]) via the independent
// pdfjs-dist reader.
async function pdfTextItems(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ({
      str: it.str,
      size: it.transform ? Math.abs(it.transform[3]) : 0,
      x: it.transform ? it.transform[4] : 0,
    })));
  }
  return pages;
}

// Count stroked path operators on page 1 (table borders). Gridlines on -> many
// strokes; gridlines off -> few. Content-based, independent of PDF byte noise.
async function pdfStrokeCount(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  const names = {};
  for (const fn of ops.fnArray) {
    const name = Object.keys(pdfjs.OPS).find((k) => pdfjs.OPS[k] === fn) || String(fn);
    names[name] = (names[name] || 0) + 1;
  }
  return { strokes: names.stroke || 0, constructPath: names.constructPath || 0, fill: names.fill || 0, names };
}

async function pdfPageBoxes(bytes) {
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const boxes = [];
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const b = doc.getPage(i).getMediaBox();
    boxes.push({ width: b.width, height: b.height });
  }
  return boxes;
}

// The PDF's real text layer, read by the independent pdfjs reader. The app's
// own engine.exportText is a regex extractor that does not apply a font's
// ToUnicode CMap, so it garbles the offscreen-printed office PDFs; pdfjs is
// the authoritative reader for the text layer.
async function pdfTextPages(docId) {
  const b64 = await engineBytesBase64(docId);
  const items = await pdfTextItems(fromBase64(b64));
  return items.map((pg) => pg.map((it) => it.str).join(' '));
}

function allText(pages) {
  return pages.map((p) => (typeof p === 'string' ? p : p.text)).join('\n');
}

// ---------------------------------------------------------------------------
// Criterion 1 — DOCX import: headings, table cells, distinct heading sizes.
// ---------------------------------------------------------------------------
test('criterion 1: DOCX imports with headings, table cells and distinct heading sizes', async () => {
  const outcome = await openFixture(F.docx);
  expect(outcome.ok, `docx import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase55-docx-render.png') });

  const text = await engineText(d.engineDocId);
  expect(text.error, 'exportText failed').toBeUndefined();
  const joined = allText(text.pages);

  const b64 = await engineBytesBase64(d.engineDocId);
  const items = await pdfTextItems(fromBase64(b64));
  const pdfText = items.map((pg) => pg.map((it) => it.str).join(' ')).join('\n');
  console.log('P55_DOCX_ENGINE_TEXT ' + JSON.stringify(joined.slice(0, 200)));
  console.log('P55_DOCX_PDFJS_TEXT ' + JSON.stringify(pdfText.slice(0, 300)));
  for (const needle of ['Quarterly Report', 'Financial Summary', 'North region', 'South region', 'East region', 'Region', 'Sales', 'North', '1200', 'South', '980']) {
    expect(pdfText, `docx PDF text missing "${needle}"`).toContain(needle);
  }

  const flat = items.flat();
  const h1 = flat.find((it) => it.str.includes('Quarterly Report'));
  const h2 = flat.find((it) => it.str.includes('Financial Summary'));
  expect(h1, 'H1 text item not found').toBeTruthy();
  expect(h2, 'H2 text item not found').toBeTruthy();
  console.log('P55_DOCX ' + JSON.stringify({ source: info.source, fidelity: info.fidelity, h1Size: h1.size, h2Size: h2.size, pageCount: d.pageCount }));
  expect(h1.size, 'H1 and H2 must render at distinct sizes').not.toBeCloseTo(h2.size, 1);
  expect(h1.size).toBeGreaterThan(h2.size);
});

// ---------------------------------------------------------------------------
// Criterion 2 — ODT equivalent content yields the same extracted text set.
// ---------------------------------------------------------------------------
test('criterion 2: ODT yields the same extracted text set as DOCX', async () => {
  const outcome = await openFixture(F.odt);
  expect(outcome.ok, `odt import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase55-odt-render.png') });
  const pageText = await pdfTextPages(d.engineDocId);
  const joined = pageText.join('\n');
  const expected = ['Quarterly Report', 'Financial Summary', 'North region', 'South region', 'East region', 'Region', 'Sales', 'North', '1200', 'South', '980'];
  const missing = expected.filter((n) => !joined.includes(n));
  console.log('P55_ODT ' + JSON.stringify({ source: info.source, fidelity: info.fidelity, missing, pageCount: d.pageCount }));
  expect(missing, 'ODT text set differs from DOCX').toEqual([]);
});

// ---------------------------------------------------------------------------
// Criterion 3 — legacy .doc degrades to text with the warning, no crash.
// ---------------------------------------------------------------------------
test('criterion 3: legacy .doc imports as text with legacy-format-degraded', async () => {
  const outcome = await openFixture(F.doc);
  expect(outcome.ok, `legacy .doc import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.screenshot({ path: path.join(SHOTS, 'phase55-legacy-doc.png') });
  const joined = (await pdfTextPages(d.engineDocId)).join('\n');
  console.log('P55_LEGACY_DOC ' + JSON.stringify({ source: info.source, fidelity: info.fidelity, codes: info.codes, warnings: info.warnings, recovered: joined }));
  expect(info.codes, 'legacy-format-degraded warning missing').toContain('legacy-format-degraded');
  expect(info.warnings.join(' ').toLowerCase()).toContain('headings');
  expect(joined).toContain('Legacy Word Document');
  expect(joined).toContain('recovered paragraph');
  const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]'));
  expect(pageErr, 'renderer crashed on legacy .doc').toBeUndefined();
});

// ---------------------------------------------------------------------------
// Criterion 4 — XLSX: one page group per sheet, header repeated, cached
// formula values, date in the cell's own format.
// ---------------------------------------------------------------------------
test('criterion 4: XLSX sheets, repeated header, cached formula, date format', async () => {
  const outcome = await openFixture(F.xlsx);
  expect(outcome.ok, `xlsx import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(SHOTS, 'phase55-xlsx-render.png') });
  const pageText = await pdfTextPages(d.engineDocId);

  // One page group per sheet: each sheet name heads the first page of its group.
  function firstPageStartingWith(name) {
    for (let i = 0; i < pageText.length; i += 1) {
      if (pageText[i].trim().startsWith(name)) return i;
    }
    return -1;
  }
  const salesStart = firstPageStartingWith('Sales');
  const invStart = firstPageStartingWith('Inventory');
  const notesStart = firstPageStartingWith('Notes');
  const ranges = {
    Sales: [salesStart + 1, invStart >= 0 ? invStart : pageText.length],
    Inventory: [invStart + 1, notesStart >= 0 ? notesStart : pageText.length],
    Notes: [notesStart + 1, pageText.length],
  };
  console.log('P55_XLSX ' + JSON.stringify({ source: info.source, fidelity: info.fidelity, pageCount: d.pageCount, ranges }));

  expect(salesStart, 'Sales sheet group not found').toBeGreaterThanOrEqual(0);
  expect(invStart, 'Inventory sheet group not found').toBeGreaterThan(salesStart);
  expect(notesStart, 'Notes sheet group not found').toBeGreaterThan(invStart);

  // Header row repeated on every page of the Sales group (which spans >1 page).
  const salesPages = pageText.slice(salesStart, invStart);
  expect(salesPages.length, 'Sales group must span more than one page').toBeGreaterThan(1);
  const pagesWithHeader = salesPages.filter((t) => t.includes('Region') && t.includes('Q1')).length;
  expect(pagesWithHeader, 'header row not repeated on every Sales page').toBe(salesPages.length);

  const joined = pageText.join('\n');
  // Formula CACHED RESULTS as values; the formula string must be absent.
  expect(joined, 'cached formula result 460 missing').toContain('460');
  expect(joined, 'formula string leaked into the output').not.toContain('SUM(');
  // Date rendered in the cell's own yyyy-mm-dd format.
  expect(joined, 'date not rendered in the cell format').toMatch(/\d{4}-\d{2}-\d{2}/);
});

// ---------------------------------------------------------------------------
// Criterion 5 — 20,000-row workbook: all rows present, no row-limit warning.
// ---------------------------------------------------------------------------
test('criterion 5: 20,000-row XLSX imports every row with no row-limit warning', async () => {
  const t0 = Date.now();
  const outcome = await openFixture(F.rows20k, 300000);
  const wall = Date.now() - t0;
  expect(outcome.ok, `20k xlsx import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  const joined = (await pdfTextPages(d.engineDocId)).join('\n');
  const bodyRows = (joined.match(/name \d+/g) || []).length;
  console.log('P55_20K ' + JSON.stringify({ wallMs: wall, pageCount: d.pageCount, bodyRows, codes: info.codes }));
  await win.screenshot({ path: path.join(SHOTS, 'phase55-20k.png') });
  expect(bodyRows, '20,000-row import was truncated').toBe(20000);
  expect(info.codes, 'row-limit warning on a below-ceiling sheet').not.toContain('row-limit');
});

// ---------------------------------------------------------------------------
// Criterion 5 (ceiling) — a sheet above CONVERT_LIMITS.sheetRows (100,000)
// warns with row-limit naming the sheet and the true count.
// ---------------------------------------------------------------------------
test('criterion 5b: above-ceiling sheet warns with row-limit naming sheet and count', async () => {
  const t0 = Date.now();
  const direct = await win.evaluate(async (p) => {
    const docId = crypto.randomUUID();
    const r = await window.tflex.convert.toDocument(docId, p);
    return r.ok
      ? { ok: true, pageCount: r.value.pageCount, warnings: r.value.warnings }
      : { error: r.error };
  }, F.rowsOver);
  console.log('P55_OVER_DIRECT ' + JSON.stringify({ wallMs: Date.now() - t0, direct }));
  await stubOpen(F.rowsOver);
  await clickOpen();
  let info = null;
  let toasts = [];
  const start = Date.now();
  while (Date.now() - start < 240000) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) { info = await noticeInfo(); break; }
    toasts = await win.locator('.toast-text').allInnerTexts();
    if (toasts.length > 0) break;
    await win.waitForTimeout(500);
  }
  const wall = Date.now() - t0;
  console.log('P55_OVER ' + JSON.stringify({ wallMs: wall, notice: info, toasts }));
  await win.screenshot({ path: path.join(SHOTS, 'phase55-over-ceiling.png') });
  expect(info, `above-ceiling import produced no conversion notice (toasts: ${JSON.stringify(toasts)})`).toBeTruthy();
  expect(info.codes, 'row-limit warning missing above the ceiling').toContain('row-limit');
  const joined = info.warnings.join(' ');
  expect(joined).toContain('Big');
  // The fixture is built with a header row plus 100,001 body rows, so the
  // sheet's true total row count is 100,002; the adapter reports the sheet's
  // true count (DEF-389), not the body-row count.
  expect(joined).toContain('100002');
});

// ---------------------------------------------------------------------------
// Criterion 6 — PPTX: one page per slide, slide aspect ratio, notes page.
// ---------------------------------------------------------------------------
test('criterion 6: PPTX one page per slide, slide box preserved, notes optional', async () => {
  const outcome = await openFixture(F.pptx);
  expect(outcome.ok, `pptx import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(SHOTS, 'phase55-pptx-render.png') });
  const b64 = await engineBytesBase64(d.engineDocId);
  const boxes = await pdfPageBoxes(fromBase64(b64));
  console.log('P55_PPTX ' + JSON.stringify({ source: info.source, fidelity: info.fidelity, pageCount: d.pageCount, boxes, codes: info.codes }));
  // 10 x 5.625 inches = 720 x 405 pt.
  expect(d.pageCount, 'default (no notes) must be one page per slide').toBe(2);
  for (const b of boxes) {
    expect(b.width).toBeCloseTo(720, 0);
    expect(b.height).toBeCloseTo(405, 0);
  }
  // The animation/transition warning is unconditional.
  expect(info.codes).toContain('approx-render');

  // Notes ON via the real adapter option: a following notes page per slide.
  const withNotes = await win.evaluate(async ({ p }) => {
    const docId = crypto.randomUUID();
    const r = await window.tflex.convert.toDocument(docId, p, { presentationIncludeNotes: true });
    if (!r.ok) return { error: r.error };
    const bytes = await window.tflex.engine.getDocumentBytes(docId);
    return { pageCount: r.value.pageCount, hasBytes: bytes.ok };
  }, { p: F.pptx });
  console.log('P55_PPTX_NOTES ' + JSON.stringify(withNotes));
  expect(withNotes.error, 'notes-on conversion failed').toBeUndefined();
  expect(withNotes.pageCount, 'notes page not appended when includeNotes is on').toBeGreaterThan(2);
});

// ---------------------------------------------------------------------------
// Export helpers — capture the produced file from the OS download location.
// ---------------------------------------------------------------------------
async function armDownloadCapture() {
  await app.evaluate(({ session, app }) => {
    const ses = session.defaultSession;
    const dir = app.getPath('downloads');
    ses.removeAllListeners('will-download');
    globalThis.__p55Download = null;
    globalThis.__p55DownloadEvents = 0;
    ses.on('will-download', (event, item) => {
      globalThis.__p55DownloadEvents += 1;
      const target = dir + '\\' + item.getFilename();
      item.setSavePath(target);
      globalThis.__p55Download = { path: target, filename: item.getFilename(), state: 'started' };
      item.once('done', (e, state) => {
        globalThis.__p55Download = { path: target, filename: item.getFilename(), state };
      });
    });
  });
}

async function resetDownload() {
  await app.evaluate(() => { globalThis.__p55Download = null; });
}

async function waitDownload(timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const info = await app.evaluate(() => globalThis.__p55Download);
    if (info && info.state === 'completed' && info.path && fs.existsSync(info.path) && fs.statSync(info.path).size > 0) return info;
    await win.waitForTimeout(300);
  }
  const dbg = await app.evaluate(() => ({ info: globalThis.__p55Download, events: globalThis.__p55DownloadEvents }));
  console.log('P55_DOWNLOAD_DEBUG ' + JSON.stringify(dbg));
  return null;
}

function tokenSet(text) {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) || []));
}

async function reimportText(filePath, options) {
  const r = await win.evaluate(async ({ p, o }) => {
    const docId = crypto.randomUUID();
    const res = await window.tflex.convert.toDocument(docId, p, o);
    if (!res.ok) return { error: res.error };
    const b = await window.tflex.engine.getDocumentBytes(docId);
    if (!b.ok) return { error: b.error };
    const bytes = new Uint8Array(b.value);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return { b64: btoa(bin) };
  }, { p: filePath, o: options });
  if (r.error) return { error: r.error };
  const items = await pdfTextItems(fromBase64(r.b64));
  return { text: items.map((pg) => pg.map((it) => it.str).join(' ')).join('\n') };
}

// ---------------------------------------------------------------------------
// Criterion 7 — the four exports through the REAL dialogs, verified by an
// independent parser and by re-import through our own adapter.
// ---------------------------------------------------------------------------
test('criterion 7: txt/docx/xlsx/pptx exports round-trip', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  const d = await diag();
  const srcB64 = await engineBytesBase64(d.engineDocId);
  const srcItems = await pdfTextItems(fromBase64(srcB64));
  const sourceText = srcItems.map((pg) => pg.map((it) => it.str).join(' ')).join('\n');
  const sourceTokens = tokenSet(sourceText);
  console.log('P55_EXPORT_SOURCE ' + JSON.stringify({ pageCount: d.pageCount, text: sourceText.slice(0, 300) }));
  await armDownloadCapture();

  const cases = [
    { fmt: 'txt', verb: 'exportText', dialog: '[data-text-export-dialog]', confirm: '[data-text-export-confirm]', notes: 2 },
    { fmt: 'docx', verb: 'exportDocx', dialog: '[data-docx-export-dialog]', confirm: '[data-docx-export-confirm]', notes: 3 },
    { fmt: 'xlsx', verb: 'exportXlsx', dialog: '[data-office-export-dialog="xlsx"]', confirm: '[data-office-export-confirm]', notes: 3 },
    { fmt: 'pptx', verb: 'exportPptx', dialog: '[data-office-export-dialog="pptx"]', confirm: '[data-office-export-confirm]', notes: 3 },
  ];
  const produced = {};
  for (const c of cases) {
    await clickDockVerb(win, 4, c.verb);
    await win.waitForSelector(c.dialog, { timeout: 15000 });
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(SHOTS, `phase55-export-${c.fmt}-dialog.png`) });
    const dialogHtml = await win.locator(c.dialog).innerHTML().catch(() => '');
    console.log(`P55_DIALOG_HTML_${c.fmt} len=${dialogHtml.length} hasFidelity=${dialogHtml.includes('fidelity')} hasNotes=${dialogHtml.includes('data-export-fidelity-notes')} tail=${JSON.stringify(dialogHtml.slice(-500))}`);
    const block = win.locator(`[data-export-fidelity-notes="${c.fmt}"]`);
    await expect(block, `${c.fmt} fidelity block missing`).toHaveCount(1);
    const noteCount = await block.locator('[data-export-fidelity-note]').count();
    const noteTexts = await block.locator('[data-export-fidelity-note]').allInnerTexts();
    expect(noteCount, `${c.fmt} fidelity note count`).toBe(c.notes);
    expect(noteTexts.every((t) => t.trim().length > 0), `${c.fmt} empty fidelity note`).toBe(true);
    await win.screenshot({ path: path.join(SHOTS, `phase55-export-${c.fmt}-dialog.png`) });
    await resetDownload();
    await win.locator(c.confirm).click();
    const dl = await waitDownload(120000);
    expect(dl, `${c.fmt} produced no file`).toBeTruthy();
    produced[c.fmt] = dl.path;
    console.log(`P55_EXPORT_${c.fmt.toUpperCase()} ` + JSON.stringify({ path: dl.path, size: fs.statSync(dl.path).size, notes: noteTexts }));
    await win.locator(c.dialog).locator('[data-text-export-close], [data-docx-export-close], [data-office-export-close]').first().click().catch(() => {});
    await win.waitForTimeout(500);
  }

  // (a) independent parser for each format.
  const mammoth = require('mammoth');
  const XLSX = require('xlsx');
  const { unzipSync, strFromU8 } = require('fflate');
  const independent = {};
  independent.txt = fs.readFileSync(produced.txt, 'utf8');
  independent.docx = (await mammoth.extractRawText({ path: produced.docx })).value;
  {
    const wb = XLSX.readFile(produced.xlsx);
    const parts = [];
    for (const name of wb.SheetNames) parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
    independent.xlsx = parts.join('\n');
  }
  {
    const zip = unzipSync(new Uint8Array(fs.readFileSync(produced.pptx)));
    const parts = [];
    for (const name of Object.keys(zip)) {
      if (!/^ppt\/(slides|notesSlides)\/.*\.xml$/.test(name)) continue;
      const xml = strFromU8(zip[name]);
      for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) parts.push(m[1]);
    }
    independent.pptx = parts.join('\n');
  }

  // (b) re-import through our own adapter. The pptx writer stores the page
  // text in the slide notes, so its round-trip re-imports with notes on.
  const reimported = {};
  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    reimported[fmt] = await reimportText(produced[fmt], fmt === 'pptx' ? { presentationIncludeNotes: true } : undefined);
  }

  const report = {};
  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    const indTokens = tokenSet(independent[fmt]);
    const reTokens = tokenSet(reimported[fmt].text || '');
    const missingInd = [...sourceTokens].filter((t) => !indTokens.has(t));
    const missingRe = [...sourceTokens].filter((t) => !reTokens.has(t));
    const overlap = (sourceTokens.size - missingRe.length) / sourceTokens.size;
    const indOverlap = (sourceTokens.size - missingInd.length) / sourceTokens.size;
    report[fmt] = { independentMissing: missingInd, reimportMissing: missingRe, overlap, indOverlap, reimportError: reimported[fmt].error || null };
  }
  console.log('P55_ROUNDTRIP ' + JSON.stringify(report));
  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    expect(report[fmt].reimportError, `${fmt} re-import failed`).toBeNull();
    // Reflow and pdfjs item concatenation make an exact token set too strict;
    // require the produced file and the re-imported text layer to cover at
    // least 90% of the source PDF's text-layer tokens.
    expect(report[fmt].indOverlap, `${fmt} independent parser diverges from the source`).toBeGreaterThanOrEqual(0.9);
    expect(report[fmt].overlap, `${fmt} re-import text layer diverges from the source`).toBeGreaterThanOrEqual(0.9);
  }
  // Clean up the downloaded files from the OS download location.
  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    try { fs.unlinkSync(produced[fmt]); } catch (_) { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Criterion 8 — empty / image-only pages export to a VALID file and the
// office dialogs name the pages without extractable text.
// ---------------------------------------------------------------------------
test('criterion 8: image-only pages export valid files and name the text-free pages', async () => {
  await stubOpen(F.imageOnly);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  const d = await diag();
  const src = await engineText(d.engineDocId);
  const srcText = src.error ? '' : allText(src.pages);
  console.log('P55_IMAGEONLY_SRC ' + JSON.stringify({ pageCount: d.pageCount, text: srcText }));
  await armDownloadCapture();

  const cases = [
    { fmt: 'txt', verb: 'exportText', dialog: '[data-text-export-dialog]', confirm: '[data-text-export-confirm]' },
    { fmt: 'docx', verb: 'exportDocx', dialog: '[data-docx-export-dialog]', confirm: '[data-docx-export-confirm]' },
    { fmt: 'xlsx', verb: 'exportXlsx', dialog: '[data-office-export-dialog="xlsx"]', confirm: '[data-office-export-confirm]' },
    { fmt: 'pptx', verb: 'exportPptx', dialog: '[data-office-export-dialog="pptx"]', confirm: '[data-office-export-confirm]' },
  ];
  const produced = {};
  const notices = {};
  for (const c of cases) {
    await clickDockVerb(win, 4, c.verb);
    await win.waitForSelector(c.dialog, { timeout: 15000 });
    // DEF-390 — the txt/docx surfaces fetch the text-free list on open, so the
    // notice is visible before export; capture the dialog with it (the
    // xlsx/pptx notice appears only after the build, captured post-export).
    await win.locator('[data-export-pages-without-text]').first()
      .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await win.screenshot({ path: path.join(SHOTS, `phase55-export-${c.fmt}-imageonly-dialog.png`) });
    await resetDownload();
    await win.locator(c.confirm).click();
    const dl = await waitDownload(120000);
    expect(dl, `${c.fmt} produced no file`).toBeTruthy();
    produced[c.fmt] = dl.path;
    const size = fs.statSync(dl.path).size;
    expect(size, `${c.fmt} produced a zero-byte file`).toBeGreaterThan(0);
    const notice = win.locator('[data-export-pages-without-text]');
    notices[c.fmt] = (await notice.count()) > 0 ? await notice.innerText() : null;
    await win.screenshot({ path: path.join(SHOTS, `phase55-export-${c.fmt}-imageonly.png`) });
    await win.locator(c.dialog).locator('[data-text-export-close], [data-docx-export-close], [data-office-export-close]').first().click().catch(() => {});
    await win.waitForTimeout(500);
  }
  console.log('P55_IMAGEONLY ' + JSON.stringify({ produced, notices }));

  // Every produced file must open in its independent parser (never corrupt).
  const mammoth = require('mammoth');
  const XLSX = require('xlsx');
  const { unzipSync } = require('fflate');
  expect(fs.readFileSync(produced.txt, 'utf8').length).toBeGreaterThanOrEqual(0);
  await mammoth.extractRawText({ path: produced.docx });
  XLSX.readFile(produced.xlsx);
  unzipSync(new Uint8Array(fs.readFileSync(produced.pptx)));

  // DEF-390 — ALL FOUR surfaces must name the text-free pages (criterion 8).
  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    expect(notices[fmt], `${fmt} did not name the text-free pages`).toBeTruthy();
    expect(notices[fmt], `${fmt} notice did not name page 1`).toContain('1');
    expect(notices[fmt], `${fmt} notice did not name page 2`).toContain('2');
  }
  console.log('P55_CRIT8_JUDGEMENT ' + JSON.stringify({ txtNotice: notices.txt, docxNotice: notices.docx }));

  for (const fmt of ['txt', 'docx', 'xlsx', 'pptx']) {
    try { fs.unlinkSync(produced[fmt]); } catch (_) { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Settings — each officeConvertDefaults key must change the output.
// ---------------------------------------------------------------------------
async function saveOfficeDefaults(patch) {
  return win.evaluate(async (p) => {
    const cur = await window.tflex.loadSettings();
    const s = cur && cur.ok ? cur.value : {};
    s.officeConvertDefaults = p;
    await window.tflex.saveSettings(s);
    return true;
  }, patch);
}

async function importAndSignature(filePath) {
  await stubOpen(filePath);
  await clickOpen();
  const outcome = await waitImportOutcome(120000);
  if (!outcome.ok) return { error: outcome.error };
  const d = await diag();
  const b64 = await engineBytesBase64(d.engineDocId);
  const bytes = fromBase64(b64);
  const boxes = await pdfPageBoxes(bytes);
  const items = await pdfTextItems(bytes);
  const maxX = Math.max(0, ...items.flat().map((it) => it.x));
  const strokes = (await pdfStrokeCount(bytes)).constructPath;
  const closers = win.locator('[data-tab-id] .tab-close');
  if ((await closers.count()) > 0) { await closers.last().click(); await win.waitForTimeout(400); }
  return { pageCount: d.pageCount, box: boxes[0], strokes, maxX };
}

test('settings: officeConvertDefaults spreadsheets/presentations change the output', async () => {
  const base = await importAndSignature(F.xlsx);
  await saveOfficeDefaults({ spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'portrait' }, presentations: { includeNotes: false }, exports: { includeImages: true } });
  const portrait = await importAndSignature(F.xlsx);
  await saveOfficeDefaults({ spreadsheets: { gridlines: false, fitToWidth: true, orientation: 'auto' }, presentations: { includeNotes: false }, exports: { includeImages: true } });
  const noGrid = await importAndSignature(F.xlsx);
  await saveOfficeDefaults({ spreadsheets: { gridlines: true, fitToWidth: false, orientation: 'auto' }, presentations: { includeNotes: false }, exports: { includeImages: true } });
  const noFit = await importAndSignature(F.xlsx);
  await saveOfficeDefaults({ spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' }, presentations: { includeNotes: true }, exports: { includeImages: true } });
  const pptxNotes = await importAndSignature(F.pptx);
  console.log('P55_SETTINGS ' + JSON.stringify({ base, portrait, noGrid, noFit, pptxNotes }));
  // Orientation must change the page box (auto -> landscape, portrait -> portrait).
  expect(portrait.box.height, 'spreadsheets.orientation had no observable effect').toBeGreaterThan(portrait.box.width);
  // Gridlines must change the stroked-border count.
  expect(noGrid.strokes, 'spreadsheets.gridlines had no observable effect').toBeLessThan(base.strokes);
  // Fit-to-width must change the layout (page count or the widest text x).
  expect(
    noFit.pageCount !== base.pageCount || Math.abs(noFit.maxX - base.maxX) > 5,
    'spreadsheets.fitToWidth had no observable effect',
  ).toBe(true);
  // includeNotes must add the notes page.
  expect(pptxNotes.pageCount, 'presentations.includeNotes had no observable effect').toBeGreaterThan(2);
});

test('settings: exports.includeImages changes the xlsx images sheet', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await armDownloadCapture();
  const XLSX = require('xlsx');
  async function exportXlsxSheets() {
    await clickDockVerb(win, 4, 'exportXlsx');
    await win.waitForSelector('[data-office-export-dialog="xlsx"]', { timeout: 15000 });
    await resetDownload();
    await win.locator('[data-office-export-confirm]').click();
    const dl = await waitDownload(120000);
    expect(dl, 'xlsx export produced no file').toBeTruthy();
    const wb = XLSX.readFile(dl.path);
    const names = wb.SheetNames.slice();
    try { fs.unlinkSync(dl.path); } catch (_) { /* ignore */ }
    await win.locator('[data-office-export-close]').click().catch(() => {});
    await win.waitForTimeout(500);
    return names;
  }
  await saveOfficeDefaults({ spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' }, presentations: { includeNotes: false }, exports: { includeImages: false } });
  const off = await exportXlsxSheets();
  await saveOfficeDefaults({ spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' }, presentations: { includeNotes: false }, exports: { includeImages: true } });
  const on = await exportXlsxSheets();
  console.log('P55_INCLUDEIMAGES ' + JSON.stringify({ off, on }));
  expect(off, 'includeImages=false still produced a Page images sheet').not.toContain('Page images');
  expect(on, 'includeImages=true did not produce a Page images sheet').toContain('Page images');
});

test('adapter options: spreadsheet/presentation options change output directly', async () => {
  async function direct(options) {
    const r = await win.evaluate(async ({ p, o }) => {
      const docId = crypto.randomUUID();
      const res = await window.tflex.convert.toDocument(docId, p, o);
      if (!res.ok) return { error: res.error };
      const b = await window.tflex.engine.getDocumentBytes(docId);
      const bytes = new Uint8Array(b.value);
      let bin = ''; for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return { pageCount: res.value.pageCount, b64: btoa(bin) };
    }, { p: F.xlsx, o: options });
    if (r.error) return r;
    const bytes = fromBase64(r.b64);
    const boxes = await pdfPageBoxes(bytes);
    const items = await pdfTextItems(bytes);
    return { pageCount: r.pageCount, box: boxes[0], strokes: (await pdfStrokeCount(bytes)).constructPath, maxX: Math.max(0, ...items.flat().map((it) => it.x)) };
  }
  const portrait = await direct({ spreadsheetOrientation: 'portrait', spreadsheetGridlines: true, spreadsheetFitToWidth: true });
  const landscape = await direct({ spreadsheetOrientation: 'landscape', spreadsheetGridlines: true, spreadsheetFitToWidth: true });
  const gridOn = await direct({ spreadsheetGridlines: true });
  const gridOff = await direct({ spreadsheetGridlines: false });
  const fitOn = await direct({ spreadsheetFitToWidth: true });
  const fitOff = await direct({ spreadsheetFitToWidth: false });
  console.log('P55_ADAPTER_OPTIONS ' + JSON.stringify({ portrait: portrait.box, landscape: landscape.box, gridOn: gridOn.strokes, gridOff: gridOff.strokes, fitOn: { pageCount: fitOn.pageCount, maxX: fitOn.maxX }, fitOff: { pageCount: fitOff.pageCount, maxX: fitOff.maxX } }));
  expect(portrait.box.height).toBeGreaterThan(portrait.box.width);
  expect(landscape.box.width).toBeGreaterThan(landscape.box.height);
  expect(gridOff.strokes).toBeLessThan(gridOn.strokes);
  expect(fitOff.pageCount !== fitOn.pageCount || Math.abs(fitOff.maxX - fitOn.maxX) > 5).toBe(true);
});

// ---------------------------------------------------------------------------
// Hostile-input basics (Phase 55 added ZIP/OLE/XML parsers).
// ---------------------------------------------------------------------------
async function importExpectFailure(filePath, timeout = 30000) {
  const before = await tabCount();
  consoleLog = [];
  await stubOpen(filePath);
  await clickOpen();
  const start = Date.now();
  let toasts = [];
  while (Date.now() - start < timeout) {
    toasts = await win.locator('.toast-text').allInnerTexts();
    if (toasts.length > 0) break;
    if (consoleLog.some((l) => l.startsWith('[pageerror]'))) break;
    await win.waitForTimeout(250);
  }
  const after = await tabCount();
  const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]')) || null;
  return { before, after, toasts, pageErr };
}

test('hostile: zip bombs, truncated archives, misnamed containers, truncated slide', async () => {
  const results = {};
  for (const [name, file] of [
    ['bomb.odt', path.join(FIX, 'bomb.odt')],
    ['bomb.ods', path.join(FIX, 'bomb.ods')],
    ['bomb.pptx', path.join(FIX, 'bomb.pptx')],
    ['truncated.odt', path.join(FIX, 'truncated.odt')],
    ['truncated.ods', path.join(FIX, 'truncated.ods')],
    ['truncated.pptx', path.join(FIX, 'truncated.pptx')],
  ]) {
    // Clear any toast from the previous case so the message is unambiguous.
    const preClosers = win.locator('.toast-close');
    for (let i = await preClosers.count(); i > 0; i -= 1) { await preClosers.first().click().catch(() => {}); await win.waitForTimeout(120); }
    const r = await importExpectFailure(file);
    results[name] = r;
    expect(r.pageErr, `${name}: renderer crashed`).toBeNull();
    expect(r.after, `${name}: a tab was created for a bad archive`).toBe(r.before);
    expect(r.toasts.length, `${name}: no readable failure message`).toBeGreaterThan(0);
  }

  // Misnamed containers route by content, not extension.
  const misDocx = await openFixture(path.join(FIX, 'misnamed.docx'));
  const misDocxInfo = await noticeInfo();
  const closeTabs = async () => {
    const closers = win.locator('[data-tab-id] .tab-close');
    for (let i = await closers.count(); i > 0; i -= 1) { await closers.first().click().catch(() => {}); await win.waitForTimeout(300); }
  };
  await closeTabs();
  const misOdt = await openFixture(path.join(FIX, 'misnamed.odt'));
  const misOdtInfo = await noticeInfo();
  results['misnamed.docx'] = { ok: misDocx.ok, source: misDocxInfo && misDocxInfo.source };
  results['misnamed.odt'] = { ok: misOdt.ok, source: misOdtInfo && misOdtInfo.source };
  expect(misDocx.ok, 'misnamed .docx (really ODT) failed').toBe(true);
  expect(misDocxInfo.source, 'misnamed .docx did not route to the ODT adapter').toBe('OpenDocument text');
  expect(misOdt.ok, 'misnamed .odt (really DOCX) failed').toBe(true);
  expect(misOdtInfo.source, 'misnamed .odt did not route to the DOCX adapter').toBe('Word document');

  // A PPTX whose slide 2 XML is truncated: placeholder page + warning, slide 1 renders.
  await closeTabs();
  const truncSlide = await openFixture(path.join(FIX, 'truncated-slide.pptx'));
  const truncInfo = await noticeInfo();
  const d = await diag();
  results['truncated-slide.pptx'] = { ok: truncSlide.ok, pageCount: d.pageCount, codes: truncInfo && truncInfo.codes, warnings: truncInfo && truncInfo.warnings };
  expect(truncSlide.ok, 'truncated-slide pptx failed entirely').toBe(true);
  expect(d.pageCount, 'placeholder page missing').toBe(2);
  expect(truncInfo.codes, 'no warning for the unrenderable slide').toContain('generic-fallback');
  expect(truncInfo.warnings.join(' ')).toContain('Slide 2');
  await win.screenshot({ path: path.join(SHOTS, 'phase55-truncated-slide.png') });

  console.log('P55_HOSTILE ' + JSON.stringify(results));
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX — the Open dialog filter list and each office import.
// ---------------------------------------------------------------------------
test('control-index: Open dialog advertises the eight office extensions', async () => {
  await stubOpen(F.docx);
  await clickOpen();
  await waitImportOutcome(30000);
  const filters = await lastFilters();
  const advertised = new Set((filters || []).flatMap((f) => f.extensions));
  console.log('P55_FILTERS ' + JSON.stringify(filters));
  for (const ext of ['docx', 'odt', 'doc', 'xls', 'xlsx', 'ods', 'pptx', 'ppt']) {
    expect(advertised.has(ext), `Open dialog does not advertise .${ext}`).toBe(true);
  }
});

test('control-index: each office import produces a tab with the right label and fidelity', async () => {
  const cases = [
    ['docx', F.docx, 'Word document', 'layout'],
    ['odt', F.odt, 'OpenDocument text', 'layout'],
    ['doc', F.doc, 'Legacy Word document (.doc)', 'degraded'],
    ['xls', path.join(FIX, 'sample.xls'), 'Excel workbook (legacy .xls)', 'layout'],
    ['xlsx', F.xlsx, 'Excel workbook', 'layout'],
    ['ods', path.join(FIX, 'sample.ods'), 'OpenDocument spreadsheet', 'layout'],
    ['pptx', F.pptx, 'PowerPoint presentation', 'layout'],
    ['ppt', F.ppt, 'Legacy PowerPoint presentation (.ppt)', 'degraded'],
  ];
  const results = [];
  for (const [name, file, label, fidelity] of cases) {
    const outcome = await openFixture(file, 60000);
    const info = await noticeInfo();
    const d = await diag();
    results.push({ name, ok: outcome.ok, error: outcome.error || null, source: info && info.source, fidelity: info && info.fidelityAttr, pageCount: d.pageCount });
    expect(outcome.ok, `${name} import failed: ${outcome.error}`).toBe(true);
    expect(info.source, `${name} source label`).toBe(label);
    expect(info.fidelityAttr, `${name} fidelity`).toBe(fidelity);
    expect(d.pageCount, `${name} pageCount`).toBeGreaterThanOrEqual(1);
    const closers = win.locator('[data-tab-id] .tab-close');
    if ((await closers.count()) > 0) { await closers.last().click(); await win.waitForTimeout(400); }
  }
  console.log('P55_IMPORTS ' + JSON.stringify(results));
});

test('control-index: export verbs disabled with an honest reason without a document', async () => {
  // The DELIVER dock is document-scoped (no verbs render on the start screen),
  // so the no-document disabled state is asserted on the Command Palette, the
  // universal surface that hosts the same verbs.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('Export as spreadsheet');
  await win.waitForTimeout(400);
  const xlsxRow = win.locator('.command-palette-row').filter({ hasText: 'Export as spreadsheet' }).first();
  const xlsxDisabled = await xlsxRow.getAttribute('data-palette-disabled');
  const xlsxReason = await xlsxRow.getAttribute('title');
  await win.locator('[data-command-palette-input]').fill('Export as presentation');
  await win.waitForTimeout(400);
  const pptxRow = win.locator('.command-palette-row').filter({ hasText: 'Export as presentation' }).first();
  const pptxDisabled = await pptxRow.getAttribute('data-palette-disabled');
  const pptxReason = await pptxRow.getAttribute('title');
  await win.screenshot({ path: path.join(SHOTS, 'phase55-verbs-nodoc.png') });
  await win.keyboard.press('Escape');
  console.log('P55_VERBS_NODOC ' + JSON.stringify({ xlsxDisabled, xlsxReason, pptxDisabled, pptxReason }));
  expect(xlsxDisabled, 'exportXlsx should be disabled with no document').toBe('true');
  expect(xlsxReason && xlsxReason.length, 'exportXlsx needs a disabled reason').toBeGreaterThan(0);
  expect(pptxDisabled, 'exportPptx should be disabled with no document').toBe('true');
  expect(pptxReason && pptxReason.length, 'exportPptx needs a disabled reason').toBeGreaterThan(0);

  // With a document open both dock verbs are enabled.
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await clickDockVerb(win, 4, 'exportXlsx').catch(() => {});
  const xlsxEnabled = await win.locator('[data-dock-verb="exportXlsx"]').first().isDisabled().catch(() => null);
  const pptxEnabled = await win.locator('[data-dock-verb="exportPptx"]').first().isDisabled().catch(() => null);
  console.log('P55_VERBS_DOC ' + JSON.stringify({ xlsxEnabled, pptxEnabled }));
  expect(xlsxEnabled, 'exportXlsx should be enabled with a document').toBe(false);
  expect(pptxEnabled, 'exportPptx should be enabled with a document').toBe(false);
});

// ---------------------------------------------------------------------------
// Regression — Phase 53/54 shared converter paths (.md and .tiff).
// ---------------------------------------------------------------------------
test('regression: Phase 53 .md and Phase 54 .tiff still import', async () => {
  const md = await openFixture(path.join(__dirname, '..', 'test-fixtures', 'phase53', 'sample.md'));
  const mdInfo = await noticeInfo();
  const mdDiag = await diag();
  const mdClosers = win.locator('[data-tab-id] .tab-close');
  for (let i = await mdClosers.count(); i > 0; i -= 1) { await mdClosers.first().click().catch(() => {}); await win.waitForTimeout(300); }
  const tiff = await openFixture(path.join(__dirname, '..', 'test-fixtures', 'phase54', 'frames-3.tiff'));
  const tiffInfo = await noticeInfo();
  const tiffDiag = await diag();
  console.log('P55_REGRESSION ' + JSON.stringify({ md: { ok: md.ok, source: mdInfo && mdInfo.source, pageCount: mdDiag.pageCount }, tiff: { ok: tiff.ok, source: tiffInfo && tiffInfo.source, pageCount: tiffDiag.pageCount } }));
  expect(md.ok, `md regression: ${md.error}`).toBe(true);
  expect(mdInfo.source).toBe('Markdown document');
  expect(tiff.ok, `tiff regression: ${tiff.error}`).toBe(true);
  expect(tiffDiag.pageCount).toBe(3);
});




