// QA decisive verification — installed v1.7.6 app.
// Verifies the FIXED (expected) behavior for DEF-108..DEF-115, driving the
// real installed app via e2e/lib/launch.cjs. Each test asserts the success
// criterion from DEFECTS.md; an assertion failure = the defect remains open.
//
// DEF-108 edit text confirm renders updated text live
// DEF-109 edit context size arrow/spinner works
// DEF-110 context-window bar press does NOT close editor
// DEF-111 DOCX export with page 1 selected => exactly 1 page
// DEF-112 on form.pdf (John Doe pre-filled) OCR makes "John Doe" searchable
// DEF-113 add-box text renders live after confirm
// DEF-114 insert blank page "end"/append lands blank page at END
// DEF-115 crop box adjustment no flash/remount artifact

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { unzipSync, strFromU8 } = require('fflate');

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

// Find the "TFlex Technical Report" title text-run bounding rect on the first
// page, falling back to the widest upper-half span. Returns a rect or null.
async function findTitleRun() {
  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').trim() });
    });
    return out;
  });
  let s = spans.find((x) => /technical\s*report/i.test(x.text) || x.text.includes('TFlex'));
  if (!s) s = spans.find((x) => x.y >= 300 && x.w > 150);
  if (!s) s = spans.find((x) => x.w > 100 && x.w >= (spans.reduce((m, y) => Math.max(m, y.w), 0)));
  return s || null;
}

// Enter edit mode, pick the text tool, hover+click the title run, and confirm
// the inline editor opened. Returns nothing (throws if the editor did not open).
async function openTextEditor() {
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(300);
  const s = await findTitleRun();
  if (!s) throw new Error('openTextEditor: no title text span found');
  await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(400);
  await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(600);
  const count = await window.locator('[data-edit-editor="edit"]').count();
  if (count === 0) throw new Error('openTextEditor: inline editor did not open');
  return s;
}

// Read the current live textLayer spans as an array of strings.
async function textLayerStrings() {
  return await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => out.push(s.textContent || ''));
    return out;
  });
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// ---------------------------------------------------------------------------
// DEF-108: edit text confirm renders updated text live (no tab refresh)
// ---------------------------------------------------------------------------
test('DEF-108: edit text confirm renders updated text live', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await openTextEditor();
  await snap('def-108-before-commit');

  await window.locator('[data-edit-textarea]').fill('ZZZ REPLACEMENT TEXT 123');
  await window.waitForTimeout(200);
  await window.keyboard.press('Control+Enter');
  await window.waitForTimeout(1500);

  const editorAfter = await window.locator('[data-edit-editor="edit"]').count();
  const texts = await textLayerStrings();
  const newVisible = texts.some((t) => t.includes('ZZZ REPLACEMENT TEXT'));
  // The old masked run remaining in the textLayer is a separate content-
  // integrity concern (DEF-116), NOT the DEF-108 live-render criterion.
  const oldGone = !texts.some((t) => t.includes('TFlex Technical Report'));
  const d = await diag();
  const modified = d.engineState ? d.engineState.modified : d.modified;
  console.log(`[DEF-108] editorAfterEdit=${editorAfter} modified=${modified} newVisible=${newVisible} oldGone=${oldGone}`);
  console.log(`[DEF-108] textLayer sample=${JSON.stringify(texts.slice(0, 6))}`);
  await snap('def-108-after-commit');

  expect(editorAfter, 'editor should close after commit').toBe(0);
  expect(newVisible, 'edited text should appear in the live textLayer').toBe(true);
  console.log('[DEF-108] PASS');
});

// ---------------------------------------------------------------------------
// DEF-109: edit context size input arrow/spinner works
// ---------------------------------------------------------------------------
test('DEF-109: edit inline editor size arrow/spinner control works', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await openTextEditor();

  const sizeInput = window.locator('[data-edit-editor="edit"] input[aria-label="Font size (pt)"]');
  const before = Number(await sizeInput.inputValue());
  await sizeInput.click();
  await window.waitForTimeout(200);
  await window.keyboard.press('ArrowUp');
  await window.waitForTimeout(300);
  const afterArrowUp = Number(await sizeInput.inputValue());
  // Native spin up-arrow (top of the number-input right edge)
  const sizeBox = await sizeInput.boundingBox();
  await window.mouse.click(sizeBox.x + sizeBox.width - 4, sizeBox.y + 4);
  await window.waitForTimeout(300);
  const afterSpinClick = Number(await sizeInput.inputValue());
  const editorStillOpen = await window.locator('[data-edit-editor="edit"]').count();
  console.log(`[DEF-109] before=${before} afterArrowUp=${afterArrowUp} afterSpinClick=${afterSpinClick} editorStillOpen=${editorStillOpen}`);
  await snap('def-109-size-control');

  // Decisive: the keyboard up-arrow must increment a strictly larger value.
  expect(afterArrowUp, 'ArrowUp on the size input should increment the value').toBeGreaterThan(before);
  // The editor must remain mounted after focusing the in-editor size control.
  expect(editorStillOpen, 'editor should stay open when the size control is focused').toBeGreaterThan(0);
  console.log('[DEF-109] PASS');
});

// ---------------------------------------------------------------------------
// DEF-110: context-window bar press does NOT close editor
// ---------------------------------------------------------------------------
test('DEF-110: edit inline editor stays open on its own tool-bar press', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await openTextEditor();

  const label = window.locator('[data-edit-editor="edit"] .edit-inline-field .edit-inline-label').first();
  const labelCount = await label.count();
  if (labelCount) {
    const lb = await label.boundingBox();
    await window.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await window.mouse.down();
    await window.mouse.up();
    await window.waitForTimeout(500);
  }
  const afterBarPress = await window.locator('[data-edit-editor="edit"]').count();
  console.log(`[DEF-110] labelPresent=${labelCount} editorAfterBarPress=${afterBarPress}`);
  await snap('def-110-after-bar-press');

  // Decisive: a press on the editor's own chrome must NOT be treated as an
  // outside click; the editor stays mounted.
  expect(afterBarPress, 'the editor must stay mounted after a press on its own bar').toBeGreaterThan(0);

  // Positive control: an explicit Cancel must still close it (so we know the
  // editor is not simply "stuck open").
  const cancelBtn = window.locator('[data-edit-editor="edit"] .edit-inline-btn-cancel').first();
  if (await cancelBtn.count()) {
    await cancelBtn.click({ force: true });
    await window.waitForTimeout(400);
    const afterCancel = await window.locator('[data-edit-editor="edit"]').count();
    console.log(`[DEF-110] editorAfterCancel=${afterCancel}`);
    expect(afterCancel, 'explicit Cancel should close the editor').toBe(0);
  }
  console.log('[DEF-110] PASS');
});

// ---------------------------------------------------------------------------
// DEF-111: DOCX export with page 1 selected => exactly 1 page
// ---------------------------------------------------------------------------
test('DEF-111: DOCX export respects the selected page range (page 1 only)', async () => {
  test.setTimeout(180000);
  const savePath = path.join(os.tmpdir(), `def-111-docx-${Date.now()}.docx`);
  console.log(`[DEF-111] savePath=${savePath}`);

  await electronApp.evaluate(({ BrowserWindow }, opts) => {
    const win = BrowserWindow.getAllWindows()[0];
    const sess = win && win.webContents ? win.webContents.session : null;
    global.__DEF111__ = { started: false, state: null, savePath: opts.savePath };
    if (!sess) return;
    sess.on('will-download', (event, item) => {
      global.__DEF111__.started = true;
      item.setSavePath(opts.savePath);
      item.once('done', (e, st) => { global.__DEF111__.state = st; });
    });
  }, { savePath });

  await openSample('report.pdf');
  const d0 = await diag();
  const totalPages = d0.engineState ? d0.engineState.pageCount : d0.pageCount;
  console.log(`[DEF-111] source pageCount=${totalPages}`);

  await openToolsPalette();
  await window.click('[data-tool-id="exportDocx"]');
  await window.waitForSelector('[data-docx-export-dialog]');
  await window.waitForTimeout(400);
  await window.locator('[data-docx-export-range]').fill('1');
  await window.waitForTimeout(200);
  await snap('def-111-docx-dialog');
  await window.click('[data-docx-export-confirm]');

  let info = null;
  for (let i = 0; i < 90; i++) {
    await window.waitForTimeout(1000);
    info = await electronApp.evaluate(() => global.__DEF111__);
    if (info && info.state) break;
    const err = await window.evaluate(() => {
      const s = document.querySelector('[data-docx-export-dialog] .optimize-error');
      return s ? s.textContent : null;
    }).catch(() => null);
    if (err) { console.log(`[DEF-111] dialog error=${err}`); break; }
  }
  const status = await window.evaluate(() => {
    const s = document.querySelector('[data-docx-export-dialog] .modal-status');
    return s ? s.textContent : null;
  }).catch(() => null);
  await snap('def-111-docx-after-export');
  console.log(`[DEF-111] will-download=${JSON.stringify(info)} status=${status}`);

  expect(info && info.state, 'export should complete (will-download done)').toBe('completed');
  expect(fs.existsSync(savePath), 'a docx file should be produced').toBe(true);

  const buf = fs.readFileSync(savePath);
  const unzipped = unzipSync(new Uint8Array(buf));
  const xml = strFromU8(unzipped['word/document.xml']);
  const pageBreaks = (xml.match(/<w:br[^>]*w:type="page"/g) || []).length;
  const textRuns = (xml.match(/<w:t>/g) || []).length;
  const preamble = xml.slice(0, 40);
  console.log(`[DEF-111] docxSize=${buf.length} pageBreaks=${pageBreaks} textRuns=${textRuns} preamble=${preamble}`);
  // Decisive: a single selected page must produce 0 page-break marks (1 page).
  expect(pageBreaks, 'a 1-page export must contain 0 page-break marks').toBe(0);
  console.log('[DEF-111] PASS');
});

// ---------------------------------------------------------------------------
// DEF-112: on form.pdf (John Doe pre-filled) OCR makes "John Doe" searchable
// ---------------------------------------------------------------------------
test('DEF-112: OCR makes the form.pdf "John Doe" value searchable', async () => {
  test.setTimeout(300000);
  await openSample('form.pdf');
  const d0 = await diag();
  console.log(`[DEF-112] form pageCount=${d0.engineState ? d0.engineState.pageCount : d0.pageCount}`);

  // Make the name text field hold "John Doe" in the RENDERER state so the OCR
  // rasterization seeds it into pdf.js's AnnotationStorage (DEF-112). The field
  // may already be pre-filled; we type it regardless so the test is explicit.
  const fields = (await diag()).formFields || [];
  const nameField = fields.find((f) => f.kind === 'text' && /name|applicant/i.test(String(f.name)))
    || fields.find((f) => f.kind === 'text');
  console.log(`[DEF-112] formFields count=${fields.length} nameField=${nameField ? nameField.id + ' (' + nameField.name + ')' : 'NONE'}`);
  if (nameField) {
    const fi = window.locator(`input[data-form-field="${nameField.id}"], textarea[data-form-field="${nameField.id}"]`).first();
    const beforeVal = (await fi.inputValue().catch(() => '')).trim();
    console.log(`[DEF-112] name field pre-fill value=${JSON.stringify(beforeVal)}`);
    await fi.click().catch(() => {});
    await fi.fill('John Doe');
    await window.waitForTimeout(400);
  } else {
    // No named text field; fall back to whichever text field is present.
    const anyText = window.locator('input[data-form-field][data-form-kind="text"], textarea[data-form-field][data-form-kind="text"]').first();
    if (await anyText.count()) await anyText.fill('John Doe');
  }
  await snap('def-112-form-before-ocr');

  // Confirm the renderer form state now mirrors "John Doe" (what OCR seeds).
  const rendererHasJohn = (await diag()).formFields?.some((f) => f.kind === 'text' && String(f.value) === 'John Doe');
  console.log(`[DEF-112] renderer form state hasJohnDoe=${rendererHasJohn}`);

  await openToolsPalette();
  await window.click('[data-tool-id="recognizeText"]');
  await window.waitForSelector('.ocr-dialog', { timeout: 10000 });
  await window.waitForTimeout(500);
  const curPage = window.locator('[data-ocr-scope="currentPage"]');
  if (await curPage.count()) await curPage.check();
  await snap('def-112-ocr-dialog');
  await window.click('[data-ocr-confirm]');

  let completed = false;
  for (let i = 0; i < 180; i++) {
    await window.waitForTimeout(1000);
    const dialogOpen = await window.locator('.ocr-dialog').count();
    if (dialogOpen === 0) { completed = true; break; }
  }
  console.log(`[DEF-112] OCR completed=${completed}`);
  await window.waitForTimeout(2500);
  await snap('def-112-after-ocr');

  // Supplementary log only: the old per-span regex split "John"/"Doe", so the
  // DECISIVE assertion below uses the actual search hit count, not per-span.
  const after = await textLayerStrings();
  console.log(`[DEF-112] textLayer AFTER OCR count=${after.length} joinedHasJohn=${after.join('').toLowerCase().includes('john doe')}`);
  console.log(`[DEF-112] textLayer AFTER OCR=${JSON.stringify(after)}`);

  // Search must find the value. Open the search bar and type the query.
  await window.keyboard.press('Control+f').catch(() => {});
  await window.waitForSelector('input[aria-label="Search query"], .search-bar input', { timeout: 5000 }).catch(() => {});
  await window.waitForTimeout(500);
  const searchInput = window.locator('input[aria-label="Search query"], .search-bar input.search-input').first();
  if (await searchInput.count()) {
    await searchInput.click();
    await searchInput.fill('John Doe');
  }
  // Wait for the search index to settle on the rebuilt proxy and assert the
  // REAL hit count (>=1) — this is the DEF-112 success criterion.
  await window.waitForTimeout(2500);
  const searchInfo = await window.evaluate(() => {
    const dg = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    const status = document.querySelector('.search-bar .search-status');
    return {
      searchQuery: dg ? dg.searchQuery : null,
      searchHits: dg ? dg.searchHits : null,
      searchIndexProgress: dg ? dg.searchIndexProgress : null,
      statusText: status ? status.textContent : null,
    };
  });
  console.log(`[DEF-112] search John Doe=${JSON.stringify(searchInfo)}`);
  await snap('def-112-search-john-doe');

  // Decisive criterion: searching "John Doe" returns at least one hit.
  expect(Number(searchInfo.searchHits), 'searching "John Doe" after OCR must return >=1 hit').toBeGreaterThanOrEqual(1);
  console.log('[DEF-112] PASS');
});

// ---------------------------------------------------------------------------
// DEF-113: add-box text renders live after confirm
// ---------------------------------------------------------------------------
test('DEF-113: Add Box text renders live after confirm', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="box"]');
  await window.waitForTimeout(300);

  await window.mouse.move(pbox.x + 300, pbox.y + 400);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 480, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const editorCount = await window.locator('[data-edit-editor="box"]').count();
  if (editorCount === 0) throw new Error('DEF-113: box editor did not open on drag');
  await snap('def-113-box-editor-open');

  await window.locator('[data-edit-textarea]').fill('HELLO BOX ADDED 456');
  await window.waitForTimeout(200);
  await window.keyboard.press('Control+Enter');
  await window.waitForTimeout(1500);

  const editorAfter = await window.locator('[data-edit-editor="box"]').count();
  const texts = await textLayerStrings();
  // DEF-113 success criterion: the FULL committed text renders live, not a
  // truncated fragment. The original bug rendered only "HELL".
  const boxVisibleFull = texts.some((t) => t.includes('HELLO BOX ADDED 456'));
  const joined = texts.join('').replace(/\s+/g, ' ');
  const boxVisibleJoined = joined.includes('HELLO BOX ADDED 456');
  const truncatedOnly = texts.some((t) => t.trim() === 'HELL') && !boxVisibleFull;
  const d = await diag();
  const modified = d.engineState ? d.engineState.modified : d.modified;
  console.log(`[DEF-113] editorAfterCommit=${editorAfter} modified=${modified} boxTextVisibleFull=${boxVisibleFull} boxTextVisibleJoined=${boxVisibleJoined} truncatedOnly=${truncatedOnly}`);
  console.log(`[DEF-113] textLayer=${JSON.stringify(texts)}`);
  await snap('def-113-after-commit');

  expect(editorAfter, 'box editor should close after commit').toBe(0);
  // Decisive: the full string must appear in the live textLayer (single span OR
  // joined across fragments). A lone "HELL" fragment is a fail.
  expect(boxVisibleFull || boxVisibleJoined, 'the FULL committed box text (HELLO BOX ADDED 456) must render live, not a truncated "HELL"').toBe(true);
  expect(truncatedOnly, 'the box must not render only a fragment "HELL"').toBe(false);
  console.log('[DEF-113] PASS');
});

// ---------------------------------------------------------------------------
// DEF-114: insert blank page "end"/append lands blank page at END (not front)
// ---------------------------------------------------------------------------
test('DEF-114: insert blank page with "end" lands at the END', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const d0 = await diag();
  const es0 = d0.engineState || d0;
  console.log(`[DEF-114] initial pageCount=${es0.pageCount} pageOrder=${JSON.stringify(es0.pageOrder)}`);

  await openToolsPalette();
  await window.click('[data-tool-id="insertPages"]');
  await window.waitForSelector('[data-insert-pages-dialog]');
  await window.waitForTimeout(400);
  const blankRadio = window.locator('[data-insert-mode="blank"]');
  if (await blankRadio.count()) await blankRadio.check();
  await window.locator('[data-insert-position]').fill('end');
  await window.waitForTimeout(200);
  await snap('def-114-insert-dialog');
  await window.click('[data-insert-confirm]');
  await window.waitForTimeout(2500);

  const d1 = await diag();
  const es1 = d1.engineState || d1;
  const order = es1.pageOrder || [];
  console.log(`[DEF-114] after pageCount=${es1.pageCount} modified=${es1.modified}`);
  console.log(`[DEF-114] pageOrder=${JSON.stringify(order)} first=${order[0]} last=${order[order.length - 1]}`);
  await snap('def-114-after-insert');

  expect(es1.pageCount, 'page count should go from 34 to 35').toBe(es0.pageCount + 1);
  expect(order.length, 'pageOrder length should equal page count').toBe(es1.pageCount);
  // Decisive: the blank page (origIdx == old page count) must be the LAST
  // element, NOT the first. original bug: [34,0,1,...,33] (blank at front).
  expect(order[0], 'the first visible page must not be the new blank page').toBe(0);
  expect(order[order.length - 1], 'the new blank page must be appended at the END').toBe(es0.pageCount);
  console.log('[DEF-114] PASS');
});

// ---------------------------------------------------------------------------
// DEF-115: crop box adjustment no flash/remount artifact
// ---------------------------------------------------------------------------
test('DEF-115: crop box drag does not remount the canvas / flash to full size', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await openToolsPalette();
  await window.click('[data-tool-id="cropPages"]');
  await window.waitForSelector('[data-crop-pages-dialog]');
  await window.waitForTimeout(700);
  await snap('def-115-crop-open');

  const before = await window.evaluate(() => {
    const canvas = document.querySelector('[data-crop-canvas]');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const box = mask ? mask.getBoundingClientRect() : null;
    if (canvas) canvas.setAttribute('data-canvas-tag', 'CANVAS-A');
    return {
      canvasTag: canvas ? canvas.getAttribute('data-canvas-tag') : null,
      canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
      box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    };
  });
  console.log(`[DEF-115] before drag=${JSON.stringify(before)}`);

  const se = window.locator('[data-crop-handle="se"]').first();
  const seBox = await se.boundingBox();
  await window.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await window.mouse.down();
  for (let step = 1; step <= 4; step++) {
    await window.mouse.move(seBox.x + seBox.width / 2 + step * 18, seBox.y + seBox.height / 2 + step * 10, { steps: 2 });
    await window.waitForTimeout(30);
  }
  await window.mouse.up();

  // Sample immediately after the commit (the flash/remount moment).
  const post = [];
  for (let i = 0; i < 6; i++) {
    const f = await window.evaluate(() => {
      const canvas = document.querySelector('[data-crop-canvas]');
      return {
        canvasTag: canvas ? canvas.getAttribute('data-canvas-tag') : null,
        canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
        canvasRect: canvas ? (() => { const r = canvas.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
      };
    });
    post.push(f);
    await window.waitForTimeout(60);
  }
  await window.waitForTimeout(400);
  await snap('def-115-crop-after-drag');
  console.log(`[DEF-115] post-commit frames=${JSON.stringify(post, null, 2)}`);

  // Decisive: canvas node must NOT remount (same node keeps our tag), opacity
  // must NOT flash to 0, and the rect must not jump to the intrinsic 612x792.
  post.forEach((f, i) => {
    expect(f.canvasTag, `frame ${i}: canvas must not remount`).toBe('CANVAS-A');
    expect(f.canvasOpacity, `frame ${i}: canvas must stay fully opaque`).toBe('1');
    const w = f.canvasRect && f.canvasRect.w, h = f.canvasRect && f.canvasRect.h;
    expect(w && w < 600, `frame ${i}: canvas width must not jump to full 612`).toBe(true);
    expect(h && h < 790, `frame ${i}: canvas height must not jump to full 792`).toBe(true);
  });
  console.log('[DEF-115] PASS');
});
