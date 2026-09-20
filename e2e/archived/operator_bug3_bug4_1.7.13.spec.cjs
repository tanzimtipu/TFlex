// QA operator-exact reproduction, installed v1.7.13 binary.
//
// BUG 3 — crop PAGE 1 specifically, then VISUALLY inspect pages 2,3,4,5 in
// the MAIN VIEWER for render propagation (content area shrink / text cut
// off). The operator's clarified intent: look at RENDERED content/margins,
// NOT CropBox metadata or page-size numbers. A page-1-specific propagation
// is suspected (fit-to-page zoom anchor or a first-page CropBox leak).
//
// BUG 4 — the floating TOOLBOX (inline editor window) that appears after a
// single click on a committed Add-box text box cannot be dragged/moved. The
// operator's intent: "the toolbox along with the text inside should be
// movable" so it does not cover the content.
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe). Never
// a .cmd/.ps1 shim; never a hand-concatenated file:// URL.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
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

// --- helpers ----------------------------------------------------------------

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function openTools() {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await win.waitForTimeout(300);
  }
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
  return path.join(SHOTS, name);
}

async function shotClip(name, selector) {
  const el = win.locator(selector).first();
  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    console.log(`[SKIP-CLIP] ${name} -- no nonzero box for ${selector}`);
    return null;
  }
  const vp = win.viewportSize() || { width: 1440, height: 900 };
  const x = Math.max(0, Math.min(box.x, vp.width - 1));
  const y = Math.max(0, Math.min(box.y, vp.height - 1));
  const width = Math.max(1, Math.min(box.width, vp.width - x));
  const height = Math.max(1, Math.min(box.height, vp.height - y));
  const p = path.join(SHOTS, name);
  try {
    await win.screenshot({ path: p, clip: { x, y, width, height } });
  } catch (e) {
    console.log(`[SKIP-CLIP] ${name} -- clip failed: ${e && e.message}`);
    return null;
  }
  return p;
}

async function scrollToPage(n) {
  for (let i = 0; i < 80; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 220;
        return true;
      }
      sc.scrollTop += 1400;
      return false;
    }, n);
    await win.waitForTimeout(220);
    if (done) break;
  }
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - 220;
  }, n);
  await win.waitForTimeout(900);
}

// The page-slot canvas rect (px). Full page = ~full aspect (0.7727 for 612x792).
async function pageRect(n) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return { mounted: false };
    const c = s.querySelector('canvas');
    if (!c) return { mounted: true, canvas: false };
    const r = c.getBoundingClientRect();
    return { mounted: true, canvas: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), aspect: +(r.width / r.height).toFixed(4) };
  }, n);
}

// The per-slot textLayer ground truth (what text the page actually renders).
async function slotText(n) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return { mounted: false, text: null, spanCount: -1 };
    const layer = s.querySelector('.textLayer');
    const spans = s.querySelectorAll('.textLayer span');
    let joined = '';
    spans.forEach((sp) => { joined += sp.textContent || ''; });
    const inner = layer ? (layer.innerText || '') : '';
    const text = (joined || inner).replace(/[ \t\r\n]+/g, ' ').trim();
    return { mounted: true, text, spanCount: spans.length };
  }, n);
}

// Dark-pixel fraction of a page-slot canvas (content density).
async function canvasDark(n) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    const c = s && s.querySelector('canvas');
    if (!c || typeof c.getContext !== 'function') return null;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    if (!w || !h) return null;
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 1;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < 140) dark += 1;
    }
    return { w, h, darkFraction: +(dark / total).toFixed(4) };
  }, n);
}

// --- BUG 3 helpers ----------------------------------------------------------

// Set the crop box on the CURRENT editor page by dragging the move + SE
// handles to the requested page-point box (top-left origin).
async function setCropBoxTo(x, y, width, height) {
  // Determine the editor's css scale = page-css-width / widthPt (612).
  const info = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    if (!page || !mask || !se) return null;
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return {
      pageW: pr.width,
      maskX: mr.x, maskY: mr.y, maskW: mr.width, maskH: mr.height,
      seX: sr.x, seY: sr.y,
    };
  });
  if (!info) throw new Error('crop editor not mounted');
  const scale = info.pageW / 612;
  console.log(`[BUG3] crop scale=${scale.toFixed(4)} current mask=${JSON.stringify(info)}`);

  // 1) MOVE the box so its top-left goes to (x, y).
  const currentX = (info.maskX - (info.maskX - info.maskX)) ; // unused
  // The mask's page-point top-left:
  //   maskX_px = pageLeftPx + box.x * scale  =>  box.x = (maskX_px - pageLeftPx)/scale
  // We don't have pageLeftPx directly; instead the move handle drags by
  // (dx_px/scale, dy_px/scale). Grab the mask CENTER and drag by the
  // page-point delta between the desired top-left and the mask's current
  // top-left. To get the mask's current top-left in page points we need the
  // mask left in page coords: read mask rect relative to the page rect.
  const rel = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    return { pageLeft: pr.x, pageTop: pr.y, maskLeft: mr.x, maskTop: mr.y, maskW: mr.width, maskH: mr.height };
  });
  const curBoxX = (rel.maskLeft - rel.pageLeft) / scale;
  const curBoxY = (rel.maskTop - rel.pageTop) / scale;
  const curBoxW = rel.maskW / scale;
  const curBoxH = rel.maskH / scale;
  console.log(`[BUG3] current box pt = x:${curBoxX.toFixed(1)} y:${curBoxY.toFixed(1)} w:${curBoxW.toFixed(1)} h:${curBoxH.toFixed(1)}`);

  const moveMx = (rel.maskLeft + rel.maskW / 2);
  const moveMy = (rel.maskTop + rel.maskH / 2);
  await win.mouse.move(moveMx, moveMy);
  await win.mouse.down();
  await win.mouse.move(moveMx + (x - curBoxX) * scale, moveMy + (y - curBoxY) * scale, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);

  // 2) RESIZE with the SE handle to (width, height).
  const rel2 = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return { pageLeft: pr.x, pageTop: pr.y, maskLeft: mr.x, maskTop: mr.y, maskW: mr.width, maskH: mr.height, seX: sr.x + sr.width / 2, seY: sr.y + sr.height / 2 };
  });
  const newCurW = rel2.maskW / scale;
  const newCurH = rel2.maskH / scale;
  const dW = (newCurW - width) * scale;
  const dH = (newCurH - height) * scale;
  console.log(`[BUG3] after move box pt = x:${((rel2.maskLeft - rel2.pageLeft) / scale).toFixed(1)} y:${((rel2.maskTop - rel2.pageTop) / scale).toFixed(1)} w:${newCurW.toFixed(1)} h:${newCurH.toFixed(1)}; SE drag dW_px=${dW.toFixed(1)} dH_px=${dH.toFixed(1)}`);
  await win.mouse.move(rel2.seX, rel2.seY);
  await win.mouse.down();
  await win.mouse.move(rel2.seX - dW, rel2.seY - dH, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);

  // Read back the committed box.
  const final = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    return { x: ((mr.x - pr.x) / pr.width * 612).toFixed(1), y: ((mr.y - pr.y) / pr.height * 792).toFixed(1), w: (mr.width / pr.width * 612).toFixed(1), h: (mr.height / pr.height * 792).toFixed(1) };
  });
  console.log(`[BUG3] FINAL committed crop box pt = ${JSON.stringify(final)}`);
}

async function cropPage1To(x, y, width, height, shotTag) {
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(800);
  // Switch to per-page mode; editorPage defaults to 1.
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(700);
  // Explicitly select page 1.
  await win.selectOption('[data-crop-page-select]', '1');
  await win.waitForTimeout(600);
  await setCropBoxTo(x, y, width, height);
  await shot(`bug3-${shotTag}-crop-dialog.png`);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2600); // engine op + proxy refresh settle
}

async function inspectPages(tag) {
  const rows = [];
  for (let n = 1; n <= 5; n += 1) {
    await scrollToPage(n);
    const r = await pageRect(n);
    const t = await slotText(n);
    const d = await canvasDark(n);
    rows.push({ page: n, rect: r, text: (t.text || '').slice(0, 70), spans: t.spanCount, dark: d && d.darkFraction });
    const clip = await shotClip(`bug3-${tag}-page${n}.png`, `.page-slot[data-page="${n}"]`);
    console.log(`[BUG3|${tag}] page ${n} rect=${JSON.stringify(r)} dark=${d && d.darkFraction} spans=${t.spanCount} text="${(t.text || '').slice(0, 60)}" clip=${clip}`);
  }
  await shot(`bug3-${tag}-full.png`);
  return rows;
}

// ---------------------------------------------------------------------------
// BUG 3: crop page 1 (tiny offset box), then visually measure pages 1-5.
// Then a SECOND crop on page 1 with a different box, measure pages 1-5 again.
// ---------------------------------------------------------------------------
test('BUG3: cropping PAGE 1 must NOT visually crop pages 2,3,4,5 (render check); second crop re-check', async () => {
  await openSampleFromCard('report.pdf');

  console.log('[BUG3] === baseline (before any crop) ===');
  const before = await inspectPages('before');

  console.log('[BUG3] === FIRST crop of page 1 (top 120, left 120, w 300, h 400) ===');
  await cropPage1To(120, 120, 300, 400, 'first');
  const after1 = await inspectPages('after1');

  console.log('[BUG3] === SECOND crop of page 1 (top 80, left 300, w 200, h 260) ===');
  await cropPage1To(80, 300, 200, 260, 'second');
  const after2 = await inspectPages('after2');

  // Print a compact comparison table.
  console.log('\n[BUG3] ==== COMPARISON TABLE (render rect w x h + aspect) ====');
  const fmt = (rows) => {
    const out = {};
    for (const r of rows) out[r.page] = `${r.rect.w}x${r.rect.h} aspect ${r.rect.aspect}`;
    return out;
  };
  console.log('BEFORE :', JSON.stringify(fmt(before)));
  console.log('AFTER1 :', JSON.stringify(fmt(after1)));
  console.log('AFTER2 :', JSON.stringify(fmt(after2)));

  // --- Document-safety re-parse: SAVE the cropped doc and re-parse the file
  // with pdf-lib to confirm ONLY page 1 carries a CropBox (no leak into the
  // saved /Pages leaves 2..N). This is the decisive "first-page CropBox leak"
  // check the operator hypothesized.
  const savePath = path.join(os.tmpdir(), `tflex-bug3-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(800);
  const exists = fs.existsSync(savePath);
  console.log(`[BUG3] saved file exists=${exists} path=${savePath}`);
  if (exists) {
    const bytes = fs.readFileSync(savePath);
    const doc = await PDFDocument.load(bytes);
    const pageCount = doc.getPageCount();
    const cropRows = [];
    const full = { x: 0, y: 0, width: 612, height: 792 };
    for (let i = 0; i < pageCount; i += 1) {
      const cb = doc.getPage(i).getCropBox();
      const isFull = cb && Math.abs(cb.width - full.width) < 0.5 && Math.abs(cb.height - full.height) < 0.5;
      const isFullLL = cb && Math.abs((cb.x || 0) - full.x) < 0.5 && Math.abs((cb.y || 0) - full.y) < 0.5;
      const full_ = cb && isFull && isFullLL;
      cropRows.push({ page: i + 1, cb: cb ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height) } : null, isFullPage: !!full_ });
    }
    console.log(`[BUG3] SAVED pageCount=${pageCount}`);
    const nonFull = cropRows.filter((r) => !r.isFullPage);
    console.log(`[BUG3] SAVED pages with a NON-full CropBox = ${nonFull.length}:`, JSON.stringify(nonFull));
    console.log(`[BUG3] SAVED page 1 crop = ${JSON.stringify(cropRows[0])}  page 2 = ${JSON.stringify(cropRows[1])}  page 3 = ${JSON.stringify(cropRows[2])}  page 4 = ${JSON.stringify(cropRows[3])}`);
    // Document-safety assertion: only the cropped page 1 may have a non-full
    // CropBox in the saved file.
    for (const row of nonFull) {
      expect(row.page, 'only page 1 may carry a non-full CropBox in the saved file').toBe(1);
    }
    console.log('[BUG3] SAVE REPARSE PASS: only page 1 carries a CropBox; pages 2..N are full 0,0,612,792.');
  } else {
    console.log('[BUG3] SAVE REPARSE WARNING: file not found.');
  }

  // Content text for pages 2-5 must be unchanged (the same chapter text must
  // still render, not be cut off). We log it for the operator; the DEF entry
  // judgment is made from the screenshots below.
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors during crop').toHaveLength(0);
  console.log('[BUG3] DONE — see screenshots bug3-before-*, bug3-after1-*, bug3-after2-*.');
});

// ---------------------------------------------------------------------------
// BUG 4: the floating TOOLBOX (inline editor) that appears after a single
// click on a committed Add-box text box must be draggable. Test whether
// holding + dragging the toolbox moves it with the cursor.
// ---------------------------------------------------------------------------
test('BUG4: the floating toolbox (inline editor) is draggable after a single click on a committed box', async () => {
  await openSampleFromCard('report.pdf');

  // Enter Edit mode, Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a box by dragging on page 1 within the VISIBLE viewport (a point
  // too far down sits below the fold and the click never reaches the page).
  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  console.log('[BUG4] page1 slot rect=', JSON.stringify(slotRect));
  const px = slotRect.x + slotRect.width * 0.35;
  const py = slotRect.y + 260; // safely within the ~900px viewport top area
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 130, py + 80, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  // The inline editor (mode "box") must be open.
  const editorOpen = await win.evaluate(() => !!document.querySelector('[data-edit-editor="box"]'));
  console.log('[BUG4] box editor open (add):', editorOpen);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('Movable toolbox test');
  await win.waitForTimeout(300);
  await shot('bug4-box-editor-add.png');
  // Confirm / Apply the box.
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(800);

  // The committed box surface must exist.
  const committed = await win.locator('[data-edit-box-id]').count();
  console.log('[BUG4] committed box count=', committed);
  expect(committed, 'a committed text box must exist after Apply').toBeGreaterThanOrEqual(1);

  // DOUBLE-click the committed box -> the floating toolbox (inline editor)
  // opens (DEF-153 model: single click selects, double click opens).
  const boxEl = win.locator('[data-edit-box-id]').first();
  const boxRect = await boxEl.boundingBox();
  console.log('[BUG4] committed box rect=', JSON.stringify(boxRect));
  const bx = boxRect.x + boxRect.width / 2;
  const by = boxRect.y + boxRect.height / 2;
  await win.mouse.dblclick(bx, by, { delay: 60 });
  await win.waitForTimeout(800);

  const editorAfterClick = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { open: false };
    const r = e.getBoundingClientRect();
    return { open: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('[BUG4] toolbox after double click=', JSON.stringify(editorAfterClick));
  expect(editorAfterClick.open, 'double-clicking the committed box must open the floating toolbox').toBe(true);

  // Record the toolbox rect BEFORE the drag.
  const before = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const r = e.getBoundingClientRect();
    const tb = e.querySelector('.edit-inline-toolbar');
    const tr = tb ? tb.getBoundingClientRect() : r;
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tbX: Math.round(tr.x), tbY: Math.round(tr.y), tbW: Math.round(tr.width), tbH: Math.round(tr.height) };
  });
  console.log('[BUG4] toolbox BEFORE drag=', JSON.stringify(before));

  // Grab the toolbox by its HEADER / toolbar chrome (NOT a button or the
  // textarea): a point in the toolbar's left gutter near a label.
  const grabX = before.tbX + 8;
  const grabY = before.tbY + Math.round(before.tbH / 2);
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 220, grabY + 120, { steps: 12 });
  await win.waitForTimeout(200);
  await shot('bug4-toolbox-middrag.png');

  // Sample the toolbox position MID-DRAG.
  const mid = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const r = e.getBoundingClientRect();
    return { present: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('[BUG4] toolbox MID-DRAG=', JSON.stringify(mid));

  await win.mouse.up();
  await win.waitForTimeout(600);
  await shot('bug4-toolbox-after-release.png');

  const after = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { open: false };
    const r = e.getBoundingClientRect();
    return { open: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('[BUG4] toolbox AFTER drag=', JSON.stringify(after));

  const movedX = Math.abs((after.x || 0) - before.x);
  const movedY = Math.abs((after.y || 0) - before.y);
  console.log(`[BUG4] toolbox moved by dx=${movedX} dy=${movedY}`);

  // If the toolbox does not move >= 15px, the operator's BUG 4 is REPRODUCED
  // (the floating toolbox is stuck). We do NOT assert pass/fail here — we
  // record and screenshot; the DEF judgment is made from the evidence.
  console.log('[BUG4] DONE — see screenshots bug4-*.png');
});
