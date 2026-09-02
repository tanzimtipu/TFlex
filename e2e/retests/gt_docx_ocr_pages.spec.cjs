// QA ground-truth reproduction — installed v1.7.5 app.
// Group 2: Bug 3 (DOCX exports all pages even when page 1 selected),
// Bug 4 (OCR does not make form.pdf "John Doe" searchable),
// Bug 7 (insert blank page visually adds 2 pages / blank page has marks).
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await electronApp.close().catch(() => {}); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}
async function diag() { return await window.evaluate(() => window.tflexDiagnostics()); }
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

async function openToolsPalette() {
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.waitForTimeout(300);
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// ---------------------------------------------------------------------------
// Bug 3 — DOCX export: succeeds but exports ALL pages even when page 1 selected
// ---------------------------------------------------------------------------
test('GT-03: DOCX export respects the selected page range', async () => {
  test.setTimeout(180000);
  const savePath = path.join(os.tmpdir(), `gt-docx-${Date.now()}.docx`);
  console.log('GT-03 savePath=', savePath);

  await electronApp.evaluate(({ BrowserWindow }, opts) => {
    const win = BrowserWindow.getAllWindows()[0];
    const sess = win && win.webContents ? win.webContents.session : null;
    global.__GT03__ = { started: false, state: null, savePath: opts.savePath };
    if (!sess) return;
    sess.on('will-download', (event, item) => {
      global.__GT03__.started = true;
      item.setSavePath(opts.savePath);
      item.once('done', (e, state) => { global.__GT03__.state = state; });
    });
  }, { savePath });

  await openSample('report.pdf');
  const d0 = await diag();
  console.log('GT-03 initial pageCount=', d0.engineState ? d0.engineState.pageCount : d0.pageCount);

  await openToolsPalette();
  await window.click('[data-tool-id="exportDocx"]');
  await window.waitForSelector('[data-docx-export-dialog]');
  await window.waitForTimeout(400);

  // Set the page range to exactly "1"
  await window.locator('[data-docx-export-range]').fill('1');
  await window.waitForTimeout(200);
  const rangeVal = await window.locator('[data-docx-export-range]').inputValue();
  console.log('GT-03 page range set to=', JSON.stringify(rangeVal));
  await snap('gt-bug3-docx-dialog');

  await window.click('[data-docx-export-confirm]');

  let info = null;
  for (let i = 0; i < 60; i++) {
    await window.waitForTimeout(1000);
    info = await electronApp.evaluate(() => global.__GT03__);
    if (info && info.state) break;
    // stop early if the dialog surfaced an error
    const err = await window.evaluate(() => {
      const s = document.querySelector('[data-docx-export-dialog] .optimize-error');
      return s ? s.textContent : null;
    }).catch(() => null);
    if (err) { console.log('GT-03 dialog error=', err); break; }
  }
  console.log('GT-03 will-download info=', JSON.stringify(info));
  const status = await window.evaluate(() => {
    const s = document.querySelector('[data-docx-export-dialog] .modal-status');
    return s ? s.textContent : null;
  }).catch(() => null);
  console.log('GT-03 dialog status=', status);
  await snap('gt-bug3-docx-after-export');

  let size = 0, exists = false;
  if (info && info.state === 'completed' && fs.existsSync(savePath)) {
    exists = true;
    size = fs.statSync(savePath).size;
  }
  console.log('GT-03 saved-file exists=', exists, 'size=', size);
  // Write a side marker with the savePath so a follow-up step can parse it.
  fs.writeFileSync(path.join(os.tmpdir(), 'gt-docx-last-path.txt'), savePath);
  console.log('GT-03 DONE savePath=', savePath, 'started=', info && info.started, 'state=', info && info.state);
});

// ---------------------------------------------------------------------------
// Bug 4 — OCR does not make form.pdf "John Doe" searchable
// ---------------------------------------------------------------------------
test('GT-04: OCR makes the form.pdf "John Doe" value searchable', async () => {
  test.setTimeout(240000);
  await openSample('form.pdf');
  const d0 = await diag();
  console.log('GT-04 form pages=', d0.engineState ? d0.engineState.pageCount : d0.pageCount);
  // Ground truth of what page 1 shows (what OCR would rasterise)
  await snap('gt-bug4-form-before-ocr');

  // Any existing selectable "John Doe" text before OCR?
  const before = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => out.push(s.textContent || ''));
    return out;
  });
  console.log('GT-04 textLayer BEFORE OCR=', JSON.stringify(before));

  await openToolsPalette();
  await window.click('[data-tool-id="recognizeText"]');
  await window.waitForSelector('.ocr-dialog');
  await window.waitForTimeout(400);

  // Current page scope
  const curPage = window.locator('[data-ocr-scope="currentPage"]');
  if (await curPage.count()) { await curPage.check(); }
  await snap('gt-bug4-ocr-dialog');
  await window.click('[data-ocr-confirm]');

  // Wait for the OCR run to finish (dialog closes; suspects panel opens)
  let completed = false;
  for (let i = 0; i < 120; i++) {
    await window.waitForTimeout(1000);
    const dialogOpen = await window.locator('.ocr-dialog').count();
    if (dialogOpen === 0) { completed = true; break; }
  }
  console.log('GT-04 OCR completed=', completed);
  await snap('gt-bug4-after-ocr');

  // Post-OCR: rebuild the doc proxy and re-read the textLayer
  await window.waitForTimeout(1500);
  const after = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => out.push(s.textContent || ''));
    return out;
  });
  const hasJohn = after.some((t) => /john\s*doe/i.test(t));
  console.log('GT-04 textLayer AFTER OCR=', JSON.stringify(after), ' hasJohnDoe=', hasJohn);

  // Also try the search bar
  await window.evaluate(() => {
    const input = document.querySelector('[data-search-input], .search-bar input, input[placeholder*="Search" i]');
    if (input) { input.focus(); }
  });
  await window.keyboard.press('Control+f').catch(() => {});
  await window.waitForTimeout(600);
  const searchInput = window.locator('[data-search-input], .search-bar input, input[placeholder*="Search" i]');
  if (await searchInput.count()) {
    await searchInput.first().fill('John Doe');
    await window.waitForTimeout(1200);
    const searchInfo = await window.evaluate(() => {
      const hitsEl = document.querySelector('[data-search-hits], .search-hits, [class*="search-result"], [class*="match-count"]');
      const diag = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
      return { hitsText: hitsEl ? hitsEl.textContent : null, searchHits: diag && diag.searchHits };
    });
    console.log('GT-04 search for John Doe=', JSON.stringify(searchInfo));
  }
  await snap('gt-bug4-search-john-doe');
});

// ---------------------------------------------------------------------------
// Bug 7 — add blank page visually adds 2 pages / blank page has marks
// ---------------------------------------------------------------------------
test('GT-07: insert blank page adds exactly one page', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const d0 = await diag();
  console.log('GT-07 initial pageCount=', d0.engineState ? d0.engineState.pageCount : d0.pageCount);
  const pagesBefore = await window.locator('.pdf-page').count();
  console.log('GT-07 .pdf-page count before=', pagesBefore);
  await snap('gt-bug7-before');

  await openToolsPalette();
  await window.click('[data-tool-id="insertPages"]');
  await window.waitForSelector('[data-insert-pages-dialog]');
  await window.waitForTimeout(400);
  // ensure blank mode
  const blankRadio = window.locator('[data-insert-mode="blank"]');
  if (await blankRadio.count()) { await blankRadio.check(); }
  // append at end — use the DEFAULT numeric position (leave as-is) vs the "end" keyword
  const DEFAULT_POS = false; // true = leave default numeric; false = literal "end" (the reproducing path)
  if (!DEFAULT_POS) {
    await window.locator('[data-insert-position]').fill('end');
    await window.waitForTimeout(200);
  } else {
    const posVal = await window.locator('[data-insert-position]').inputValue();
    console.log('GT-07 default insert position=', JSON.stringify(posVal));
  }
  await snap('gt-bug7-insert-dialog');
  await window.click('[data-insert-confirm]');
  await window.waitForTimeout(2500);

  const d1 = await diag();
  const pagesAfter = await window.locator('.pdf-page').count();
  const thumbCount = await window.locator('.page-thumb, .rail-thumb, [class*="thumb"]').count();
  console.log('GT-07 after insert pageCount=', d1.engineState ? d1.engineState.pageCount : d1.pageCount,
    ' .pdf-page=', pagesAfter, ' thumb=', thumbCount);
  const es = d1.engineState || d1;
  console.log('GT-07 engineState=', JSON.stringify({ pageCount: es.pageCount, pageOrder: es.pageOrder, deleted: es.deleted, rotations: es.rotations, modified: es.modified, annotations: (es.annotations||[]).length }));
  // Current page indicator + first 6 rail thumb labels
  const railInfo = await window.evaluate(() => {
    const pager = document.querySelector('[data-page-input], [class*="page-input"], input[aria-label*="page" i]');
    const thumbs = Array.from(document.querySelectorAll('.page-thumb, .rail-thumb, [class*="thumb"]')).slice(0, 6).map((t) => {
      const lbl = t.getAttribute('data-page') || t.getAttribute('data-label') || (t.querySelector('[class*="page-num"],[class*="label"]') || {}).textContent || '';
      return String(lbl).trim();
    });
    return { pager: pager ? pager.value : null, thumbs };
  });
  console.log('GT-07 rail=', JSON.stringify(railInfo));
  await snap('gt-bug7-after');
});
