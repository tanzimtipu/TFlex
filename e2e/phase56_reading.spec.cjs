// Phase 56 phase-gate e2e (QA). Universal file handling IV: digital publishing
// and reading modes. Covers success criteria 1-8 and the CONTROL-INDEX rows for
// the controls this phase added. Launches ONLY through e2e/lib/launch.cjs.
//
// The OS open dialog is native, so `dialog.showOpenDialog` is stubbed in the
// main process and the app's real Open button is clicked - the same pattern the
// Phase 53-55 gate specs use.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  epub: path.join(FIX, 'phase56-book.epub'),
  mobi: path.join(FIX, 'phase56-book.mobi'),
  drm: path.join(FIX, 'phase56-drm.mobi'),
  cbz: path.join(FIX, 'phase56-comic.cbz'),
  cbt: path.join(FIX, 'phase56-comic.cbt'),
  corruptCbz: path.join(FIX, 'phase56-comic-corrupt.cbz'),
  truncatedCbt: path.join(FIX, 'phase56-truncated.cbt'),
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
  if (app) await hardClose(app, 'phase56');
  app = null;
  win = null;
});

test.setTimeout(300000);

// --- helpers ---------------------------------------------------------------
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

async function closeAllTabs() {
  const closers = win.locator('[data-tab-id] .tab-close');
  for (let i = await closers.count(); i > 0; i -= 1) {
    await closers.first().click().catch(() => {});
    await win.waitForTimeout(250);
  }
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
    fidelityAttr: await notice.getAttribute('data-conversion-fidelity'),
    fidelity: await notice.locator('[data-conversion-fidelity-label]').innerText(),
    codes: await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-conversion-warning'))),
    warnings: await notice.locator('[data-conversion-warning]').allInnerTexts(),
  };
}

async function engineBytes(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.getDocumentBytes(id);
    if (!r.ok) return { error: r.error };
    const bytes = new Uint8Array(r.value);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return { b64: btoa(bin) };
  }, docId);
}

async function toDocument(filePath, options) {
  return win.evaluate(async ({ p, o }) => {
    const docId = crypto.randomUUID();
    const r = await window.tflex.convert.toDocument(docId, p, o);
    if (!r.ok) return { error: r.error };
    return { docId, pageCount: r.value.pageCount, sourceFormat: r.value.sourceFormat, fidelity: r.value.fidelity, warnings: r.value.warnings, title: r.value.title };
  }, { p: filePath, o: options });
}

async function pdfPages(b64) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(b64, 'base64')),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const ops = await page.getOperatorList();
    const names = new Set(ops.fnArray.map((fn) => Object.keys(pdfjs.OPS).find((k) => pdfjs.OPS[k] === fn) || String(fn)));
    pages.push({
      text: tc.items.map((it) => it.str).join(' '),
      hasImage: [...names].some((n) => n.startsWith('paintImage') || n.includes('Image')),
      opNames: [...names],
    });
  }
  return pages;
}

// Read the OPF spine from the fixture, independently of the app, so criterion 1
// compares the converted text order against the SPINE (not the filenames).
function epubSpineOrder(filePath) {
  const { unzipSync, strFromU8 } = require('fflate');
  const zip = unzipSync(new Uint8Array(fs.readFileSync(filePath)));
  const opfName = Object.keys(zip).find((n) => n.endsWith('.opf'));
  const opf = strFromU8(zip[opfName]);
  const manifest = {};
  for (const m of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"[^>]*>/g)) manifest[m[1]] = m[2];
  const spine = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)) spine.push({ idref: m[1], href: manifest[m[1]] });
  return spine;
}

async function closeReadingView() {
  const close = win.locator('[aria-label="Close reading view"]');
  if ((await close.count()) > 0) { await close.first().click().catch(() => {}); await win.waitForTimeout(400); }
}

// Range inputs reject Playwright's fill typing; set the value through the
// prototype setter so React's value tracker sees the change, then dispatch the
// input event React's onChange listens for.
async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await win.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Criterion 1 — EPUB -> paginated PDF in spine order, cover first.
// ---------------------------------------------------------------------------
test('criterion 1: EPUB converts in OPF spine order with the cover on page 1', async () => {
  const spine = epubSpineOrder(F.epub);
  const outcome = await openFixture(F.epub, 60000);
  expect(outcome.ok, `epub import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase56-epub-import.png') });

  const bytes = await engineBytes(d.engineDocId);
  expect(bytes.error, 'getDocumentBytes failed').toBeUndefined();
  const pages = await pdfPages(bytes.b64);
  const joined = pages.map((p) => p.text).join('\n');

  console.log('P56_EPUB_SPINE ' + JSON.stringify(spine));
  console.log('P56_EPUB ' + JSON.stringify({
    source: info && info.source,
    fidelity: info && info.fidelityAttr,
    pageCount: d.pageCount,
    page1Text: pages[0] && pages[0].text,
    page1HasImage: pages[0] && pages[0].hasImage,
    firstTextPage: pages.findIndex((p) => p.text.trim().length > 0),
  }));

  // Filenames are a.xhtml (Chapter Two) then b.xhtml (Chapter One); alphabetical
  // filename order would put Chapter Two first. The OPF spine is ch1 -> ch2.
  expect(spine.map((s) => s.idref)).toEqual(['ch1', 'ch2']);
  expect(joined.indexOf('Chapter One'), 'Chapter One missing').toBeGreaterThanOrEqual(0);
  expect(joined.indexOf('Chapter Two'), 'Chapter Two missing').toBeGreaterThanOrEqual(0);
  expect(joined.indexOf('Chapter One'), 'text order is filename order, not spine order')
    .toBeLessThan(joined.indexOf('Chapter Two'));
  expect(joined.indexOf('First chapter content'), 'chapter one body missing').toBeGreaterThanOrEqual(0);
  expect(joined.indexOf('Second chapter content'), 'chapter two body missing').toBeGreaterThanOrEqual(0);
  // Heading hierarchy: an h1 and an h2 from the fixture both survive.
  expect(joined).toContain('Section One A');

  // The FIRST page is the cover: it carries the image and no chapter text.
  const firstTextPage = pages.findIndex((p) => p.text.trim().length > 0);
  expect(pages[0].hasImage, 'page 1 does not contain the cover image').toBe(true);
  expect(pages[0].text.trim(), 'page 1 is not a cover-only page').toBe('');
  expect(firstTextPage, 'no chapter text on any page').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Criterion 2 — Reading view paginates, font-size and theme changes.
// ---------------------------------------------------------------------------
test('criterion 2: reading view paginates and honours font size and theme', async () => {
  const outcome = await openFixture(F.epub, 60000);
  expect(outcome.ok, `epub import failed: ${outcome.error}`).toBe(true);
  const openBtn = win.locator('[aria-label="Open reading view"]');
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await win.waitForSelector('[data-reading-view]', { state: 'visible', timeout: 15000 });
  await win.waitForSelector('[data-reading-chapter]', { timeout: 15000 });
  await win.waitForTimeout(500);

  const surface = win.locator('[data-reading-view]');
  const progress = win.locator('[aria-label="Reading progress"]');
  const chapters = await win.locator('[data-reading-chapter]').count();
  expect(chapters, 'reading view did not paginate both chapters').toBe(2);
  expect(await progress.getAttribute('aria-valuenow')).toBe('1');
  await win.screenshot({ path: path.join(SHOTS, 'phase56-reading-light.png') });

  // Pagination: Next advances the chapter index and the progress label.
  await win.locator('[data-reading-view] [data-reading-next]').click();
  await win.waitForTimeout(400);
  expect(await progress.getAttribute('aria-valuenow'), 'Next did not advance the chapter').toBe('2');
  expect(await progress.innerText()).toContain('Chapter 2 of 2');

  // Font-size change must visibly re-style the chapter content.
  const beforePt = await win.locator('.reading-chapter-content').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await setRange(win.locator('[data-reading-font-size]'), 28);
  await win.waitForTimeout(300);
  const afterStyle = await win.locator('.reading-chapter-content').first().evaluate((el) => el.style.fontSize);
  const afterPt = await win.locator('.reading-chapter-content').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  console.log('P56_READING ' + JSON.stringify({
    chapters,
    beforePt,
    afterPt,
    afterStyle,
    theme: await surface.getAttribute('data-reading-theme'),
  }));
  expect(afterStyle, 'font-size change had no effect').toBe('28pt');
  expect(afterPt, 'font-size change did not grow the rendered text').toBeGreaterThan(beforePt);
  expect(await win.locator('.reading-control-value').first().innerText()).toContain('28');
  await win.screenshot({ path: path.join(SHOTS, 'phase56-reading-fontsize.png') });

  // Theme change must swap the reading surface theme (light -> dark).
  await win.locator('[data-reading-theme-select]').selectOption('dark');
  await win.waitForTimeout(500);
  expect(await surface.getAttribute('data-reading-theme'), 'theme change had no effect').toBe('dark');
  const bg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log('P56_READING_THEME ' + JSON.stringify({ theme: await surface.getAttribute('data-reading-theme'), bg }));
  await win.screenshot({ path: path.join(SHOTS, 'phase56-reading-dark.png') });
  await closeReadingView();
});

// ---------------------------------------------------------------------------
// Criterion 3 — unprotected MOBI text+images with the degraded warning visible;
//               DRM fixture refused with drm-protected and never partially parsed.
// ---------------------------------------------------------------------------
test('criterion 3a: MOBI imports text and images with the degraded warning visible', async () => {
  const outcome = await openFixture(F.mobi, 60000);
  expect(outcome.ok, `mobi import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase56-mobi.png') });

  console.log('P56_MOBI ' + JSON.stringify({ source: info && info.source, fidelity: info && info.fidelityAttr, codes: info && info.codes, pageCount: d.pageCount }));
  expect(info.codes, 'legacy-format-degraded warning missing').toContain('legacy-format-degraded');
  const warningText = (info.warnings || []).join(' ');
  expect(warningText.toLowerCase()).toContain('fidelity');
  expect(warningText.toLowerCase()).toContain('layout');

  const bytes = await engineBytes(d.engineDocId);
  const pages = await pdfPages(bytes.b64);
  const joined = pages.map((p) => p.text).join('\n');
  expect(joined, 'MOBI heading not recovered').toContain('Mobi Heading');
  expect(joined, 'MOBI body not recovered').toContain('Mobi body text');
  expect(pages.some((p) => p.hasImage), 'MOBI image was not embedded in the PDF').toBe(true);
});

test('criterion 3b: DRM MOBI is refused with drm-protected and never opens a document', async () => {
  const before = await tabCount();
  consoleLog = [];
  await stubOpen(F.drm);
  await clickOpen();

  const start = Date.now();
  let toasts = [];
  while (Date.now() - start < 30000) {
    toasts = await win.locator('.toast-text').allInnerTexts();
    if (toasts.length > 0) break;
    if (consoleLog.some((l) => l.startsWith('[pageerror]'))) break;
    await win.waitForTimeout(250);
  }
  const after = await tabCount();
  const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]')) || null;
  const noticeCount = await win.locator('[data-conversion-notice]').count();
  console.log('P56_DRM ' + JSON.stringify({ before, after, toasts, noticeCount, pageErr }));
  await win.screenshot({ path: path.join(SHOTS, 'phase56-drm.png') });

  expect(noticeCount, 'a document was produced for a DRM-protected book').toBe(0);
  expect(after, 'a tab was opened for a DRM-protected book').toBe(before);
  expect(pageErr, 'renderer crashed on the DRM fixture').toBeNull();
  expect(toasts.join(' '), 'no drm-protected refusal message').toMatch(/DRM/i);

  // The app stays usable: a normal PDF still opens.
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  expect(await win.locator('.workspace').isVisible()).toBe(true);
});

// ---------------------------------------------------------------------------
// Criterion 4 — CBZ 12 images and CBT same 12 images each produce 12 pages.
// The p1..p12 natural ordering (p10 after p9) is proven by the unit tests
//   test/unit/main/convertComicAdapters.test.ts:
//     - "orders p2 before p10 with numeric collation"
//     - "sorts the scrambled page set into p1..p12 without mutating the input"
//     - "converts a 12-image CBZ to 12 pages in natural order (p10 after p9)"
//     - "reads a TAR of 12 images into 12 pages in natural order"
// ---------------------------------------------------------------------------
test('criterion 4: CBZ and CBT each produce a 12-page document in the app', async () => {
  const cbz = await toDocument(F.cbz);
  const cbt = await toDocument(F.cbt);
  console.log('P56_COMIC_COUNTS ' + JSON.stringify({ cbz, cbt }));
  expect(cbz.error, `cbz direct convert failed: ${JSON.stringify(cbz.error)}`).toBeUndefined();
  expect(cbt.error, `cbt direct convert failed: ${JSON.stringify(cbt.error)}`).toBeUndefined();
  expect(cbz.pageCount, 'CBZ is not 12 pages').toBe(12);
  expect(cbt.pageCount, 'CBT is not 12 pages').toBe(12);
  expect(cbz.sourceFormat).toBe('cbz');
  expect(cbt.sourceFormat).toBe('cbt');

  // Also through the real Open button, so the app-level path produces 12 pages.
  const outcome = await openFixture(F.cbz, 60000);
  expect(outcome.ok, `cbz UI import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  expect(d.pageCount, 'CBZ UI import is not 12 pages').toBe(12);
});

// ---------------------------------------------------------------------------
// Criterion 5 — the comic open/close path (SUPERSEDED shell).
//
// Phase 66 (chunk 1) removed the cbz/cbt "Open comic view" trigger and the
// comic reading-mode chrome. The canvas top-left "Book View" control supersedes
// it for every open document. The Phase 56 comic single/double/fit/RTL
// assertions are therefore SUPERSEDED by Phase 66 and are NOT asserted here
// (single/double + flip return with Book View chunks 2-3). What this test keeps
// is the shared open/close path: the cbz opens and its reader surface can be
// entered and dismissed without an uncaught renderer error or a React #185
// update-depth loop.
// ---------------------------------------------------------------------------
test('criterion 5: the cbz reader shell opens and closes without a renderer error', async () => {
  const outcome = await openFixture(F.cbz, 60000);
  expect(outcome.ok, `cbz import failed: ${outcome.error}`).toBe(true);
  const openBtn = win.locator('[aria-label="Book View"]');
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-comic-book-entry.png') });

  // The shell renders the read-only page surface.
  expect(await win.locator('[data-book-page]').count(), 'book view rendered no page').toBe(1);

  // Close with a REAL click unmounts the book surface.
  await win.locator('[aria-label="Close book view"]').click();
  await expect(win.locator('[data-book-view]'), 'close did not dismiss the book view').toHaveCount(0);

  // ACCEPTANCE: the reader must render WITHOUT an uncaught renderer error or a
  // React update-depth error (the DEF-395 render->effect->setState loop).
  const pageErrors = consoleLog.filter((l) => l.startsWith('[pageerror]'));
  const reactLoop = consoleLog.filter((l) => /#185|Maximum update depth/i.test(l));
  console.log('P56_COMIC ' + JSON.stringify({ pageErrors, reactLoop }));
  expect(pageErrors, 'comic view raised an uncaught renderer error').toEqual([]);
  expect(reactLoop, 'comic view logged a React update-depth error').toEqual([]);
});

// ---------------------------------------------------------------------------
// Criterion 6 — corrupt CBZ converts the rest and warns naming the bad entry.
// ---------------------------------------------------------------------------
test('criterion 6: a corrupt CBZ image is skipped with a warning naming it', async () => {
  const outcome = await openFixture(F.corruptCbz, 60000);
  expect(outcome.ok, `corrupt cbz import failed: ${outcome.error}`).toBe(true);
  const d = await diag();
  const info = await noticeInfo();
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase56-comic-corrupt.png') });

  console.log('P56_CORRUPT_COMIC ' + JSON.stringify({ pageCount: d.pageCount, codes: info && info.codes, warnings: info && info.warnings }));
  expect(info.codes, 'frame-decode-failed warning missing').toContain('frame-decode-failed');
  const joinedWarnings = (info.warnings || []).join(' ');
  expect(joinedWarnings, 'warning does not name the damaged entry').toContain('p7.png');
  expect(d.pageCount, 'remaining pages were not converted').toBe(11);
});

// ---------------------------------------------------------------------------
// Criterion 7 — truncated .cbt is a typed error, no crash.
// The typed-error unit test is:
//   test/unit/main/convertComicAdapters.test.ts
//     "returns a typed corrupt failure for a truncated TAR and never prints (criterion 7)"
// ---------------------------------------------------------------------------
test('criterion 7: a truncated .cbt fails with a readable error and no crash', async () => {
  const before = await tabCount();
  consoleLog = [];
  await stubOpen(F.truncatedCbt);
  await clickOpen();
  const start = Date.now();
  let toasts = [];
  while (Date.now() - start < 30000) {
    toasts = await win.locator('.toast-text').allInnerTexts();
    if (toasts.length > 0) break;
    if (consoleLog.some((l) => l.startsWith('[pageerror]'))) break;
    await win.waitForTimeout(250);
  }
  const after = await tabCount();
  const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]')) || null;
  const noticeCount = await win.locator('[data-conversion-notice]').count();
  console.log('P56_TRUNCATED_CBT ' + JSON.stringify({ before, after, toasts, noticeCount, pageErr }));
  await win.screenshot({ path: path.join(SHOTS, 'phase56-truncated-cbt.png') });
  expect(pageErr, 'renderer crashed on the truncated TAR').toBeNull();
  expect(after, 'a tab was created for a broken TAR').toBe(before);
  expect(noticeCount, 'a document was produced for a broken TAR').toBe(0);
  expect(toasts.length, 'no readable failure message for the truncated TAR').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX sweep — every aria-label this phase promises, in the format
// that owns it, with its promised action (standing rule 1: no dead control).
// ---------------------------------------------------------------------------
test('control-index: EPUB reading controls exist, are reachable and act', async () => {
  const outcome = await openFixture(F.epub, 60000);
  expect(outcome.ok, `epub import failed: ${outcome.error}`).toBe(true);
  await win.locator('[aria-label="Open reading view"]').waitFor({ state: 'visible', timeout: 15000 });
  await win.locator('[aria-label="Open reading view"]').click();
  await win.waitForSelector('[data-reading-chapter]', { timeout: 15000 });
  await win.waitForTimeout(400);

  const results = {};
  // Region + progress + close exist.
  for (const label of ['Reading view', 'Reading progress', 'Reading font size', 'Reading line height', 'Reading width', 'Reading theme', 'Previous page', 'Next page', 'Close reading view']) {
    results[label] = await win.locator(`[aria-label="${label}"]`).count();
  }
  console.log('P56_CI_EPUB_PRESENT ' + JSON.stringify(results));
  for (const [label, count] of Object.entries(results)) {
    expect(count, `${label} is missing`).toBeGreaterThan(0);
  }

  // Each control performs its promised action.
  const lineHeight = win.locator('[data-reading-line-height]');
  await setRange(lineHeight, 2.0);
  const lh = await win.locator('.reading-chapter-content').first().evaluate((el) => el.style.lineHeight);
  expect(lh, 'line height control had no effect').toBe('2');
  const width = win.locator('[data-reading-width]');
  await setRange(width, 40);
  const mw = await win.locator('.reading-chapter-content').first().evaluate((el) => el.style.maxWidth);
  expect(mw, 'width control had no effect').toBe('40ch');
  await win.locator('[data-reading-theme-select]').selectOption('sepia');
  await win.waitForTimeout(300);
  expect(await win.locator('[data-reading-view]').getAttribute('data-reading-theme'), 'theme control had no effect').toBe('sepia');
  console.log('P56_CI_EPUB_ACTIONS ' + JSON.stringify({ lh, mw }));

  await win.locator('[aria-label="Close reading view"]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-reading-view]').count(), 'close did not dismiss the reading view').toBe(0);
});

test('control-index: the cbz reader control is reachable and acts (Phase 66 shell)', async () => {
  const outcome = await openFixture(F.cbz, 60000);
  expect(outcome.ok, `cbz import failed: ${outcome.error}`).toBe(true);
  // SUPERSEDED by Phase 66 (chunk 1): the Phase 56 comic controls
  // (Comic single/double/fit width/fit height/RTL, Reading progress) were
  // removed with the "Open comic view" trigger. The canvas "Book View" entry
  // supersedes it; single/double + flip return with Book View chunks 2-3, and
  // their assertions are not run here.
  const entry = win.locator('[aria-label="Book View"]');
  await entry.waitFor({ state: 'visible', timeout: 15000 });
  expect(await entry.isVisible(), 'Book View entry is missing on the cbz').toBe(true);
  await entry.click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);

  // The control-index promise for the superseding control: it exists, is
  // reachable and acts (opens the shell), and Close acts (dismisses it).
  expect(await win.locator('[data-book-view]').count(), 'Book View did not open').toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-comic-book-control.png') });
  const close = win.locator('[aria-label="Close book view"]');
  await close.waitFor({ state: 'visible', timeout: 10000 });
  await close.click();
  await win.waitForTimeout(600);
  expect(await win.locator('[data-book-view]').count(), 'close did not dismiss the book view').toBe(0);
});

// The reader trigger is gated on NON-dismissible tab state: collapsing the
// conversion card must NOT remove the capability (standing rule 1).
test('control-index: the reading trigger survives collapsing the conversion notice', async () => {
  const outcome = await openFixture(F.epub, 60000);
  expect(outcome.ok, `epub import failed: ${outcome.error}`).toBe(true);
  const dismiss = win.locator('[data-conversion-collapse]');
  expect(await dismiss.count()).toBe(1);
  await dismiss.click();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-conversion-notice]').count(), 'notice was not dismissed').toBe(0);
  expect(await win.locator('[data-conversion-icon]').count(), 'collapsed icon missing').toBe(1);
  const trigger = win.locator('[aria-label="Open reading view"]');
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  expect(await trigger.isDisabled(), 'reading trigger disabled after dismissing the notice').toBe(false);
  await trigger.click();
  await win.waitForSelector('[data-reading-chapter]', { timeout: 15000 });
  expect(await win.locator('[data-reading-view]').count()).toBe(1);
  await closeReadingView();
});
