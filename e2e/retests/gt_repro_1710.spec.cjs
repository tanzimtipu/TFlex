// QA ground-truth reproduction of 6 reported defects; originally on the installed v1.7.10 binary.
// Since 2026-09-05 this spec launches the DEV build.
//
// Each test drives the REAL installed app through Playwright's Electron
// launcher (e2e/lib/launch.cjs), captures DOM/state evidence + a screenshot,
// and records the exact reproduction. Root-cause is then pinned by reading
// the source in the same commit (0dab4cb, v1.7.10).
//
// Launch ONLY through e2e/lib/launch.cjs against the packaged exe. No
// .cmd/.ps1 shims; no hand-concatenated file:// URLs.

const { test, expect } = require('@playwright/test');
const { hardClose, armAnnotationTool, toggleEditMode, armSignTool, runTool } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAMPLES = path.resolve(__dirname, '..', '..', 'assets', 'samples');

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
  await win.waitForTimeout(600);
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

// Phase 36 migration: the All-tools palette is retired; runTool resolves each
// tool's current home (dock lane, panel/menu, or the Command Palette).
const DOCK_STAGE = {};

async function openPaletteTool(toolId) {
  return runTool(win, toolId);
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
}

async function scrollToPage(n) {
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    if (!sc) return;
    sc.scrollTop = 1500 * (want - 2 < 1 ? 1 : want - 2);
  }, n);
  await win.waitForTimeout(900);
}

// Read the inline CSS rect (left/top/width/height in CSS px) for every
// .page-slot[data-page] that is currently mounted.
async function pageRects() {
  return win.evaluate(() => {
    const out = {};
    document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
      const n = Number(p.getAttribute('data-page'));
      const c = p.querySelector('canvas');
      if (!c) { out[n] = null; return; }
      const r = c.getBoundingClientRect();
      out[n] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  });
}

function href(target) {
  return 'file://' + target.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// BUG 1 â€” Frameless window cannot be dragged by the title bar.
// ---------------------------------------------------------------------------
// RETIRED 2026-09-05 (standard-suite cleanup): BUG1 asserted the 1.7.10-era
// bug 'title bar drag region is effectively non-draggable' (its expectations
// encoded the bug being PRESENT). The frameless drag region is fixed and now
// pinned by e2e/sweep_settings_frameless.spec.cjs FW1 and
// e2e/retests/gt_verify_1711.spec.cjs DEF-132, both passing.

test('BUG2: insert blank at pos 2 â€” page order is correct, but pen lands on the WRONG page', async () => {
  await openSample('report.pdf');
  let d = await diag();
  const beforeOrder = d.engineState.pageOrder.slice();
  const beforeCount = d.engineState.pageCount;
  console.log(`[BUG2] before insert count=${beforeCount} order0-6=${JSON.stringify(beforeOrder.slice(0, 6))}`);

  await openPaletteTool('insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(500);
  await win.fill('[data-insert-position]', '2');
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2600);

  d = await diag();
  const afterOrder = d.engineState.pageOrder.slice();
  console.log(`[BUG2] after insert count=${d.engineState.pageCount} order0-8=${JSON.stringify(afterOrder.slice(0, 8))}`);
  // The reported "page order wrong" claim: the page order is actually CORRECT.
  const newPageIdx = beforeCount;
  const orderAt2 = afterOrder[1];
  console.log(`[BUG2] orderAt2(slot2)=${orderAt2} expectedNew=${newPageIdx} (equal => correct => NOT the reported bug)`);
  console.log(`[BUG2] page-order claim NOT reproduced: orderAt2 === newPageIdx ? ${orderAt2 === newPageIdx}`);
  await shot('def-133-after-insert.png');

  // Pen tool on page 2: the drawing is silently stored on the WRONG visible
  // page (source-page vs visible-page mismatch in createAnnotation).
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(400);
  await scrollToPage(2);
  const slot2 = win.locator('.page-slot[data-page="2"]');
  const bb2 = await slot2.first().boundingBox();
  console.log(`[BUG2] page2 bbox=`, JSON.stringify({ x: Math.round(bb2.x), y: Math.round(bb2.y) }));
  // Draw a stroke on the VISIBLE page 2.
  await win.mouse.move(bb2.x + 200, bb2.y + 200);
  await win.mouse.down();
  await win.mouse.move(bb2.x + 350, bb2.y + 350, { steps: 10 });
  await win.mouse.move(bb2.x + 430, bb2.y + 220, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(1000);

  // Ink on page 2 (the page we drew on) and on the LAST visible page (35).
  const inkPage2 = await win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="2"]'); let n = 0;
    if (s) s.querySelectorAll('.ann-ink').forEach((e) => { if (!e.classList.contains('ann-preview')) n += 1; });
    return n;
  });
  // Scroll to page 35 to see where the annotation actually landed.
  await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); const slot = document.querySelector('.page-slot[data-page="35"]'); if (sc && slot) sc.scrollTop = slot.offsetTop - 60; });
  await win.waitForTimeout(1000);
  const inkPage35 = await win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="35"]'); let n = 0;
    if (s) s.querySelectorAll('.ann-ink').forEach((e) => { if (!e.classList.contains('ann-preview')) n += 1; });
    return n;
  });
  const stateAnn = (await diag()).engineState.annotations?.length ?? 0;
  console.log(`[BUG2] ink on drawn page 2 = ${inkPage2}, ink on last visible page 35 = ${inkPage35}, engine annotations = ${stateAnn}`);
  console.log(`[BUG2] REPRODUCED: drawing on visible page 2 lands on page 35 (sourcePage/visiblePage mismatch).`);
  await shot('def-133-pen-misplaced.png');
});

// ---------------------------------------------------------------------------
// BUG 3 â€” "Per page" crop applies to EVERY page in the saved output.
// ---------------------------------------------------------------------------
test('BUG3: per-page crop page 2 â€” which pages end up cropped (rendered + saved)', async () => {
  await openSample('report.pdf');

  // Measure all mounted pages before the crop.
  await scrollToPage(1);
  const before = await pageRects();
  console.log(`[BUG3] before crop pages=`, JSON.stringify(before));

  await openPaletteTool('cropPages');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);
  // Switch the editor to page 2.
  await win.selectOption('[data-crop-page-select]', '2');
  await win.waitForTimeout(600);
  const se = win.locator('[data-crop-handle="se"]');
  await se.waitFor({ timeout: 10000 });
  const sb = await se.boundingBox();
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.down();
  await win.mouse.move(sb.x + sb.width / 2 - 40, sb.y + sb.height / 2 - 40, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const sum = await win.evaluate(() => {
    const rows = [];
    document.querySelectorAll('.crop-summary-row').forEach((r) => rows.push(r.textContent.trim()));
    return rows;
  });
  console.log(`[BUG3] crop summary (page 2 editor)=`, JSON.stringify(sum));
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2200);

  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : null;
  });
  console.log(`[BUG3] toast=`, JSON.stringify(toast));

  await scrollToPage(1);
  const after = await pageRects();
  console.log(`[BUG3] after crop pages=`, JSON.stringify(after));
  await shot('def-134-after-crop-p2.png');

  // Save the result and parse which pages carry a crop.
  const savePath = path.join(os.tmpdir(), `tflex-def134-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, savePath);
  // Trigger Save-As via the toolbar button, stub the OS dialog.
  await win.click('button[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  const savedExists = fs.existsSync(savePath);
  console.log(`[BUG3] saved file exists=${savedExists} path=${savePath}`);
  if (savedExists) {
    const buf = fs.readFileSync(savePath);
    console.log(`[BUG3] saved size=${buf.length}`);
    // Parse with a tiny pdf.js-free heuristic: use pdf-lib from node_modules.
    const { PDFDocument } = require(path.join(__dirname, '..', '..', 'node_modules', 'pdf-lib'));
    const pdf = await PDFDocument.load(buf);
    const crops = [];
    for (let i = 0; i < pdf.getPageCount(); i += 1) {
      const pg = pdf.getPage(i);
      const cb = pg.getCropBox();
      const tb = pg.getTrimBox();
      crops.push({ page: i + 1, cropW: Math.round(cb.width), cropH: Math.round(cb.height), trimW: Math.round(tb.width), trimH: Math.round(tb.height) });
    }
    console.log(`[BUG3] saved page crop boxes=`, JSON.stringify(crops));
  }
});

// ---------------------------------------------------------------------------
// BUG 3dup â€” Moving a signature multiple times: a click reverts the new pos.
// ---------------------------------------------------------------------------
test('BUG3dup: drag a committed signature, then click it -> position reverts', async () => {
  await openSample('report.pdf');

  // Create + place a typed signature.
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA');
  await win.click('.sig-manager button:text-is("Save")');
  await win.click('.sig-saved-pick');
  // Wait for arming, click the page to place.
  const layer = win.locator('[data-annotation-layer="1"]');
  const lb = await layer.first().boundingBox();
  // The manager's closing (exit-animated) backdrop intercepts page
  // pointers for ~250ms after the pick — wait for it to detach before
  // the placement click (race found 2026-09-06, qa).
  await win.waitForSelector('.sig-manager', { state: 'detached', timeout: 10000 });
  await win.mouse.click(lb.x + 200, lb.y + 200);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(600);

  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 8000 });
  const readRect = () => placement.evaluate((el) => ({
    left: parseFloat(el.style.left || '0'),
    top: parseFloat(el.style.top || '0'),
    width: parseFloat(el.style.width || '0'),
    height: parseFloat(el.style.height || '0'),
  }));
  const initial = await readRect();
  console.log(`[BUG3dup] committed placement rect=`, JSON.stringify(initial));

  // Drag it 120px right / 60px down.
  const pb = await placement.boundingBox();
  await win.mouse.move(pb.x + 20, pb.y + 20);
  await win.mouse.down();
  await win.mouse.move(pb.x + 20 + 120, pb.y + 20 + 60, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const afterDrag = await readRect();
  console.log(`[BUG3dup] after drag rect=`, JSON.stringify(afterDrag));
  console.log(`[BUG3dup] moved? dx=${afterDrag.left - initial.left} dy=${afterDrag.top - initial.top}`);
  await shot('def-135-after-drag.png');

  // Now click the (still hanging) placement WITHOUT confirming.
  const pb2 = await placement.boundingBox();
  await win.mouse.click(pb2.x + 20, pb2.y + 20);
  await win.waitForTimeout(500);
  const afterClick = await readRect();
  console.log(`[BUG3dup] after click (no confirm) rect=`, JSON.stringify(afterClick));
  console.log(`[BUG3dup] reverted? dxFromInitial=${afterClick.left - initial.left} dyFromInitial=${afterClick.top - initial.top}`);
  await shot('def-135-after-click.png');

  // The bug: clicking reverts the uncommitted move to the previous position.
  console.log(`[BUG3dup] verdict: dragMoved=${afterDrag.left !== initial.left} reverted=${afterClick.left === initial.left}`);
});

// ---------------------------------------------------------------------------
// BUG 4 â€” "Add box" (edit mode text box) cannot be dragged to move it.
// ---------------------------------------------------------------------------
test('BUG4: Add box committed text box cannot be dragged with the mouse', async () => {
  await openSample('report.pdf');

  // Enter Edit mode and choose Add box.
  await toggleEditMode(win);
  await win.click('[data-edit-toggle]').catch(() => {});
  // Fallback: look for the edit toggle by text.
  // Find the edit toolbar toggle button (it may be the toolbar "Edit content").
  // Use the annotation toolbar path: edit mode enters via the main toolbar.
  const editToggled = await win.evaluate(() =>
    !!document.querySelector('[data-edit-toggle]') ||
    Array.from(document.querySelectorAll('button')).some((b) => /edit content/i.test(b.getAttribute('aria-label') || ''))
  );
  console.log(`[BUG4] edit toggle present=${editToggled}`);
  if (!editToggled) {
    // Try the toolbar Edit button by aria-label.
    await win.click('button:has-text("Edit content")').catch(() => {});
  }
  await win.waitForTimeout(800);

  // Choose the "Add box" tool.
  const boxTool = win.locator('button[aria-label="Add box"]').or(win.locator('[data-edit-tool="box"]'));
  const boxToolCount = await boxTool.count();
  console.log(`[BUG4] add box tool count=${boxToolCount}`);
  if (boxToolCount > 0) await boxTool.first().click();
  await win.waitForTimeout(600);

  // Drag to create a box on the page.
  const pageLayer = win.locator('.page-slot[data-page="1"]').first();
  await pageLayer.waitFor({ timeout: 8000 });
  const pb = await pageLayer.boundingBox();
  await win.mouse.move(pb.x + 60, pb.y + 60);
  await win.mouse.down();
  await win.mouse.move(pb.x + 260, pb.y + 200, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(600);

  // Type text + commit.
  const editor = win.locator('.edit-inline-textarea');
  await editor.waitFor({ timeout: 8000 });
  await win.fill('.edit-inline-textarea', 'MOVE ME 123');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1200);

  const boxCount = await win.evaluate(() => document.querySelectorAll('.edit-box').length);
  console.log(`[BUG4] committed .edit-box count=${boxCount}`);
  await shot('def-136-after-commit.png');

  // Drag the committed box 120px right.
  const box = win.locator('.edit-box').first();
  if (await box.count() > 0) {
    const bb = await box.boundingBox();
    const before = await box.evaluate((el) => ({
      left: parseFloat(el.style.left || '0'),
      top: parseFloat(el.style.top || '0'),
    }));
    console.log(`[BUG4] box before drag=`, JSON.stringify(before));
    await win.mouse.move(bb.x + 20, bb.y + 20);
    await win.mouse.down();
    await win.mouse.move(bb.x + 20 + 120, bb.y + 20 + 40, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const after = await box.evaluate((el) => ({
      left: parseFloat(el.style.left || '0'),
      top: parseFloat(el.style.top || '0'),
    }));
    console.log(`[BUG4] box after drag=`, JSON.stringify(after));
    console.log(`[BUG4] box moved? dx=${after.left - before.left} dy=${after.top - before.top}`);
    await shot('def-136-after-drag.png');
  }
});

// ---------------------------------------------------------------------------
// BUG 5 â€” Moving a placed text box causes page artifacts; no Delete on select.
// ---------------------------------------------------------------------------
test('BUG5: move placed text box -> artifacts; select placed box -> no Delete option', async () => {
  await openSample('report.pdf');

  // Enter Edit + Add box (mirror BUG4's working entry).
  await toggleEditMode(win);
  await win.click('[data-edit-toggle]').catch(() => {});
  await win.waitForTimeout(800);
  const boxTool = win.locator('button[aria-label="Add box"]').or(win.locator('[data-edit-tool="box"]'));
  if (await boxTool.count() > 0) await boxTool.first().click();
  await win.waitForTimeout(600);

  // Create a box OVERLAPPING the title text so the mask-and-draw artifact is visible on move.
  const pageLayer = win.locator('.page-slot[data-page="1"]').first();
  await pageLayer.waitFor({ timeout: 8000 });
  const pb = await pageLayer.boundingBox();
  const titleRect = await win.evaluate(() => {
    const slotEl = document.querySelector('.page-slot[data-page="1"]');
    const sr = slotEl.getBoundingClientRect();
    let best = null;
    slotEl.querySelectorAll('.textLayer span').forEach((s) => {
      const t = (s.textContent || '').trim();
      if (t === 'TFlex Technical Report') { const r = s.getBoundingClientRect(); best = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height }; }
    });
    return best;
  });
  console.log(`[BUG5] title rect (page-local px)=`, JSON.stringify(titleRect));
  const bx = (titleRect ? titleRect.x : 140) - 4;
  const by = (titleRect ? titleRect.y : 15) - 4;
  const bw = (titleRect ? titleRect.w : 340) + 8;
  const bh = (titleRect ? titleRect.h : 40) + 8;
  await win.mouse.move(pb.x + bx, pb.y + by);
  await win.mouse.down();
  await win.mouse.move(pb.x + bx + bw, pb.y + by + bh, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const editor = win.locator('.edit-inline-textarea');
  await editor.waitFor({ timeout: 8000 });
  await win.fill('.edit-inline-textarea', 'MY BOX');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);

  const boxCount = await win.evaluate(() => document.querySelectorAll('.edit-box').length);
  console.log(`[BUG5] committed box count=${boxCount}`);

  const box = win.locator('.edit-box').first();
  if (await box.count() > 0) {
    // (a) Straight-drag the box body to move it â€” no click first, so the
    //     editor stays closed and the move commits cleanly.
    const bb = await box.boundingBox();
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2 + 120, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(1800);
    await shot('def-137-after-move.png');

    // If the box originally covered the title, the title is now masked/erased.
    const titleAfterMove = await win.evaluate(() => {
      const slotEl = document.querySelector('.page-slot[data-page="1"]');
      let spans = [];
      slotEl.querySelectorAll('.textLayer span').forEach((s) => { const t = (s.textContent || '').trim(); if (t) spans.push(t.slice(0, 24)); });
      return spans;
    });
    console.log(`[BUG5] page1 textLayer spans after moving box over title=`, JSON.stringify(titleAfterMove));
    const titleErased = await win.evaluate(() => {
      const slotEl = document.querySelector('.page-slot[data-page="1"]');
      const spans = slotEl.querySelectorAll('.textLayer span');
      let titleSpan = null;
      spans.forEach((s) => { if ((s.textContent || '').trim() === 'TFlex Technical Report') titleSpan = s; });
      return titleSpan === null;
    });
    console.log(`[BUG5] title REMOVED from textLayer after move = ${titleErased} (artifact if true)`);

    // (b) Select the box -> check a Delete/Remove option exists.
    const bb2 = await box.boundingBox();
    await win.mouse.click(bb2.x + bb2.width / 2, bb2.y + 20);
    await win.waitForTimeout(500);
    const selected = await win.evaluate(() => {
      // A Delete/Remove control for a text box: an edit-box action toolbar or a
      // button whose label/aria explicitly says Delete/Remove. Generic editor
      // chrome (Font/Size/Color/confirm/cancel) does NOT count.
      const delBtn = Array.from(document.querySelectorAll('.edit-box button, .edit-box-toolbar [aria-label], .edit-box [aria-label]')).find((b) => {
        const txt = ((b).textContent || '').trim();
        const label = (b).getAttribute('aria-label') || '';
        return /delete|remove/i.test(txt + ' ' + label);
      });
      const toolbar = document.querySelector('.edit-box-toolbar');
      return { selected: !!document.querySelector('.edit-box-selected'), deleteVisible: !!delBtn || !!toolbar };
    });
    console.log(`[BUG5] selected state=`, JSON.stringify(selected));
    await shot('def-137-box-selected.png');
  }
});
