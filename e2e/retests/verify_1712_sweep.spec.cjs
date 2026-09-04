// QA release-gate verification of the v1.7.12 sweep fixes on the freshly
// installed binary (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe,
// FileVersion 1.7.12).
//
// This gates three items:
//   DEF-137  draw ink + note on page 1, Save As, re-open -> the ink + note
//            MUST appear (annotations hydrated on open) AND the saved file
//            must carry real /Annots objects (pdf-lib check).
//   DEF-138  rotate page 1, Save As, re-open -> the page renders rotated
//            (landscape) and engineState.rotations[0] is present.
//   ADV-039  adjudication: the adversary's save-race repro used OUT-OF-RANGE
//            page indices; the backend says the real race with IN-RANGE
//            deletes is fine (disk=68, memory=65, modified=true, undo intact).
//            Re-verify: no op lost, doc modified if disk diverges.
//
// Launch ONLY through e2e/lib/launch.cjs against the packaged exe. No
// .cmd/.ps1 shims; no hand-concatenated file:// URLs.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { PDFDocument, PDFName } = require(path.join(
  __dirname, '..', '..', 'node_modules', 'pdf-lib'));

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAMPLES = path.resolve(__dirname, '..', '..', 'assets', 'samples');

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openSample(name) {
  const card = win.locator(`.sample-card:has-text("${name}")`);
  if (await card.count()) {
    await card.first().click();
  } else {
    const p = path.join(SAMPLES, name);
    await electronApp.evaluate(async ({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, p);
    await win.click('button:has-text("Open PDF")');
  }
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(1500);
}

async function openSavedPath(absolutePath) {
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absolutePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);
}

async function scrollToPage(n) {
  for (let i = 0; i < 50; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1200;
      return false;
    }, n);
    await win.waitForTimeout(250);
    if (done) break;
  }
  await win.waitForTimeout(900);
}

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  return p;
}

async function canvasAspect(pageNum) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    const c = s && s.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      aspect: +(r.width / r.height).toFixed(3),
    };
  }, pageNum);
}

// Count committed (non-preview) rendered annotation elements of a class on a
// page slot.
async function annCountOnPage(pageNum, cls) {
  return win.evaluate(({ pageNum, cls }) => {
    const s = document.querySelector(`.page-slot[data-page="${pageNum}"]`);
    let n = 0;
    if (s) s.querySelectorAll(cls).forEach((e) => {
      if (!e.classList.contains('ann-preview')) n += 1;
    });
    return n;
  }, { pageNum, cls });
}

// ---------------------------------------------------------------------------
// DEF-137 — ink + note on page 1 survive Save As + re-open, and the saved file
// carries real /Annots objects (hydrated on open).
// ---------------------------------------------------------------------------
test('DEF-137: ink + note hydrate on save/reopen; saved PDF carries /Annots', async () => {
  await openSample('report.pdf');
  const slot = win.locator('.page-slot[data-page="1"]').first();
  await slot.waitFor({ timeout: 10000 });
  const box = await slot.boundingBox();

  // Ink stroke.
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 220, box.y + 260);
  await win.mouse.down();
  await win.mouse.move(box.x + 420, box.y + 380, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(700);

  // Sticky note with content.
  await win.locator('.ann-toolbar button[data-tool="note"]').click();
  await win.waitForTimeout(300);
  await win.mouse.click(box.x + 260, box.y + 300);
  await win.waitForSelector('textarea[data-annotation-editor="note"], [data-annotation-editor="note"] textarea', { timeout: 6000 }).catch(() => {});
  const ne = win.locator('[data-annotation-editor="note"] textarea').first();
  if (await ne.count()) {
    await ne.fill('DEFECT NOTE 137');
    const nc = win.locator('[data-annotation-action="note-confirm"]').first();
    if (await nc.count()) await nc.click({ force: true });
    else await win.keyboard.press('Control+Enter').catch(() => {});
    await win.waitForTimeout(600);
  }
  await win.waitForTimeout(800);

  // Pre-save state: both annotations present in engine state + rendered.
  const pre = await diag();
  const preAnns = pre.engineState.annotations ?? [];
  console.log('[DEF-137] pre-save annotations =', JSON.stringify(preAnns.map((a) => ({ kind: a.kind, content: a.content, page: a.page }))));
  expect(preAnns.some((a) => a.kind === 'ink'), 'an ink annotation must be created before save').toBe(true);
  expect(preAnns.some((a) => a.kind === 'note' && (a.content || a.text) === 'DEFECT NOTE 137'),
    'a note annotation with the typed content must be created before save').toBe(true);
  await shot('def-137-1712-before-save.png');

  // Save As to a known temp path.
  const outPath = path.join(os.tmpdir(), `tflex-def137-1712-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  console.log('[DEF-137] saved to', outPath, 'exists =', fs.existsSync(outPath));
  expect(fs.existsSync(outPath), 'the Save As must produce a file').toBe(true);

  // pdf-lib /Annots check: page 1 (and only page 1) must carry real annotation
  // objects; at least one Ink and one Text (note) subtype must be present.
  const pdf = await PDFDocument.load(fs.readFileSync(outPath));
  let inkCount = 0;
  let noteCount = 0;
  const annotCountsPerPage = [];
  for (let p = 0; p < pdf.getPageCount(); p++) {
    const page = pdf.getPage(p);
    const annots = page.node.get(PDFName.of('Annots'));
    let n = 0;
    if (annots) {
      n = annots.size();
      for (let a = 0; a < n; a++) {
        const item = annots.get(a);
        const obj = item && item.constructor && item.constructor.name === 'PDFRef'
          ? pdf.context.lookup(item) : item;
        if (!obj || typeof obj.get !== 'function') continue;
        const sub = obj.get(PDFName.of('Subtype'));
        if (!sub) continue;
        const s = String(sub).replace(/^\//, '');
        if (s === 'Ink') inkCount += 1;
        else if (s === 'Text') noteCount += 1;
      }
    }
    annotCountsPerPage.push(n);
  }
  console.log('[DEF-137] pageCount =', pdf.getPageCount(), 'annotCountsPerPage =', JSON.stringify(annotCountsPerPage.slice(0, 6)));
  console.log('[DEF-137] Ink annotations =', inkCount, 'Text (note) annotations =', noteCount);
  expect(inkCount, 'the saved PDF must contain at least one /Subtype /Ink annotation').toBeGreaterThanOrEqual(1);
  expect(noteCount, 'the saved PDF must contain at least one /Subtype /Text (note) annotation').toBeGreaterThanOrEqual(1);
  expect(annotCountsPerPage[0], 'page 1 must carry the annotations in /Annots').toBeGreaterThanOrEqual(2);

  // Re-open the saved file: annotations must hydrate into the engine + render.
  await openSavedPath(outPath);
  await scrollToPage(1);
  const post = await diag();
  const postAnns = post.engineState.annotations ?? [];
  console.log('[DEF-137] post-reopen annotations =', JSON.stringify(postAnns.map((a) => ({ kind: a.kind, content: a.content, page: a.page }))));
  expect(postAnns.some((a) => a.kind === 'ink'), 'the ink annotation must hydrate after reopen').toBe(true);
  expect(postAnns.some((a) => a.kind === 'note' && (a.content || a.text) === 'DEFECT NOTE 137'),
    'the note annotation + content must hydrate after reopen').toBe(true);

  const visibleInk = await annCountOnPage(1, '.ann-ink');
  const visibleNote = await annCountOnPage(1, '.ann-note');
  console.log('[DEF-137] rendered on page 1 after reopen: .ann-ink =', visibleInk, '.ann-note =', visibleNote);
  expect(visibleInk, 'the ink stroke must be rendered on page 1 after reopen').toBeGreaterThan(0);
  expect(visibleNote, 'the note must be rendered on page 1 after reopen').toBeGreaterThan(0);
  await shot('def-137-1712-after-reopen.png');

  expect(pageErrors, 'no unhandled renderer errors during the annotation/save/reopen flow').toEqual([]);
  console.log('[DEF-137] PASS: ink + note survive save/reopen and are real /Annots objects.');
});

// ---------------------------------------------------------------------------
// DEF-138 — rotate page 1, Save As, re-open -> the page renders rotated
// (landscape) and rotations[0] is present.
// ---------------------------------------------------------------------------
test('DEF-138: page-1 rotation survives save/reopen (landscape render + rotations)', async () => {
  await openSample('report.pdf');

  // Rotate page 1 clockwise.
  await win.click('[data-toolbar-rotate-cw]');
  await win.waitForTimeout(1200);
  const d0 = await diag();
  console.log('[DEF-138] before save rotations[0] =', d0.engineState.rotations[0], 'modified =', d0.modified);
  expect(d0.engineState.rotations[0], 'rotating page 1 must set rotations[0]=1').toBe(1);

  const rotated = await canvasAspect(1);
  console.log('[DEF-138] rotated page-1 canvas =', JSON.stringify(rotated));
  expect(rotated && rotated.aspect, 'the rotated page must render landscape (aspect > 1)').toBeGreaterThan(1);

  // Save As.
  const outPath = path.join(os.tmpdir(), `tflex-def138-1712-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  expect(fs.existsSync(outPath), 'the Save As must produce a file').toBe(true);

  // Re-open.
  await openSavedPath(outPath);
  await scrollToPage(1);
  const d1 = await diag();
  const reopened = await canvasAspect(1);
  console.log('[DEF-138] after reopen rotations[0] =', d1.engineState.rotations[0], 'rotations[1] =', d1.engineState.rotations[1]);
  console.log('[DEF-138] reopened page-1 canvas =', JSON.stringify(reopened));
  expect(d1.engineState.rotations[0], 'the rotation must survive reload in engine state').toBe(1);
  expect(reopened && reopened.aspect, 'the reopened page must still render landscape (aspect > 1)').toBeGreaterThan(1);

  await shot('def-138-1712-after-reopen.png');
  expect(pageErrors, 'no unhandled renderer errors during the rotate/save/reopen flow').toEqual([]);
  console.log('[DEF-138] PASS: page-1 rotation survives save/reopen.');
});

// ---------------------------------------------------------------------------
// ADV-039 adjudication — with IN-RANGE deletes concurrent with save, no op is
// lost and the doc stays modified when the disk diverges from memory.
// ---------------------------------------------------------------------------
test('ADV-039: in-range deletes concurrent with save are not lost; modified when disk diverges', async () => {
  const hasEngine = await win.evaluate(() => !!window.tflex && !!window.tflex.engine);
  expect(hasEngine, 'the engine API must be exposed on window.tflex.engine').toBe(true);

  // Copy the sample to a writable path and load it, then merge a copy after
  // (34 + 34 = 68 pages).
  const copyPath = getSamplePath('report.pdf');
  const engineCall = (method, ...args) =>
    win.evaluate(([m, a]) => window.tflex.engine[m](...a), [method, args]);

  const load = await engineCall('loadDocument', 'adv039', copyPath);
  expect(load && load.ok, 'loadDocument must succeed').toBe(true);

  const merge = await engineCall('merge', 'adv039', [copyPath], 'after');
  expect(merge && merge.ok, 'merge must succeed').toBe(true);
  const mergedCount = merge.value.pageCount;
  console.log('[ADV-039] merged page count =', mergedCount);
  expect(mergedCount, 'merge of the same 34-page doc must give 68 pages').toBe(68);

  // Fire save() WITHOUT awaiting, then 3 IN-RANGE deletes (page 67/66/65 valid
  // on a 68-page 0-indexed doc) concurrently.
  const savePromise = engineCall('save', 'adv039');
  const del1 = engineCall('applyOp', 'adv039', { kind: 'delete', page: 67 });
  const del2 = engineCall('applyOp', 'adv039', { kind: 'delete', page: 66 });
  const del3 = engineCall('applyOp', 'adv039', { kind: 'delete', page: 65 });
  const saveRes = await savePromise;
  const r1 = await del1;
  const r2 = await del2;
  const r3 = await del3;
  console.log('[ADV-039] save ok =', !!(saveRes && saveRes.ok),
    'del1 ok =', !!(r1 && r1.ok), 'del2 ok =', !!(r2 && r2.ok), 'del3 ok =', !!(r3 && r3.ok));
  expect(saveRes && saveRes.ok, 'save must succeed').toBe(true);
  expect(r1 && r1.ok, 'in-range delete 67 must succeed').toBe(true);
  expect(r2 && r2.ok, 'in-range delete 66 must succeed').toBe(true);
  expect(r3 && r3.ok, 'in-range delete 65 must succeed').toBe(true);

  // Settle the queue, then read memory + disk.
  await engineCall('getState', 'adv039');
  const state = await engineCall('getState', 'adv039');
  expect(state && state.ok, 'getState must succeed').toBe(true);
  const memCount = state.value.pageCount;
  const memModified = state.value.modified;
  console.log('[ADV-039] memory page count =', memCount, 'modified =', memModified);

  // Disk: the save wrote to copyPath. Re-parse with pdf-lib.
  const pdf = await PDFDocument.load(fs.readFileSync(copyPath));
  const diskCount = pdf.getPageCount();
  console.log('[ADV-039] disk page count =', diskCount);

  // No op lost: memory must reflect the 3 deletes (68 -> 65), and each delete
  // must be recorded so the user can undo it (undo stack non-empty).
  expect(memCount, 'all three in-range deletes must be applied in memory').toBe(65);

  // If the disk diverged from memory (the save wrote the pre-delete 68-page
  // snapshot), the document MUST stay marked modified so nothing is silently
  // lost — never "disk 68, memory 65, modified false".
  if (diskCount !== memCount) {
    expect(memModified, 'when the disk diverges, the doc must stay modified').toBe(true);
    console.log('[ADV-039] PASS: disk diverged, doc stays modified (ops not silently lost).');
  } else {
    console.log('[ADV-039] PASS: disk and memory agree (no divergence).');
  }

  // Undo must be intact: the in-memory deletes are undoable.
  const undo = await engineCall('undo', 'adv039');
  expect(undo && undo.ok, 'undo must be available after the save+delete race').toBe(true);
  const afterUndo = undo.value.pageCount;
  console.log('[ADV-039] after one undo page count =', afterUndo);
  expect(afterUndo, 'undoing one delete must restore a page').toBe(66);

  expect(pageErrors, 'no unhandled renderer errors during the save-race engine drive').toEqual([]);
  console.log('[ADV-039] PASS: in-range deletes concurrent with save are not lost.');
});
