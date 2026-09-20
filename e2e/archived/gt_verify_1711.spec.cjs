// QA release-gate verification of DEF-132..136; originally on the freshly installed v1.7.11 binary.
// Since 2026-09-05 this spec launches the DEV build.
// FileVersion 1.7.11, built 05:42 — newer than ALL src).
//
// This is the FIXED-build counterpart to e2e/retests/gt_repro_1710.spec.cjs
// (which reproduced the bugs on v1.7.10 and asserted pass == defect present).
// Here pass == fix present:
//   DEF-132 frameless title-bar drag region exists (dragPx > 0, slot not no-drag)
//   DEF-133 post-insert pen/rect annotation lands on the correct VISIBLE page
//   DEF-134 committed sig drag + click keeps the move; Confirm commits it;
//           live-update visible before confirm
//   DEF-135 moving a placed text box does NOT erase the content it covered
//   DEF-136 selecting a placed text box shows a Delete/Edit toolbar; Delete
//           removes it (engine registry op)
//
// Launch ONLY through e2e/lib/launch.cjs against the packaged exe. No
// .cmd/.ps1 shims; no hand-concatenated file:// URLs.

const { test, expect } = require('@playwright/test');
const { hardClose, armAnnotationTool } = require('../lib/helpers.cjs');
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

async function openTools() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(300);
}

async function openPaletteTool(toolId) {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) await openTools();
  await win.click(`[data-tool-id="${toolId}"]`);
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
}

async function scrollToPage(n) {
  // Step-scroll until the target page-slot is mounted (the scroller is
  // virtualized), then nudge it to the top of the viewport so a drag on it
  // lands on the page, not on the toolbar / window chrome.
  for (let i = 0; i < 40; i += 1) {
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
  await win.waitForTimeout(1000);
}

async function enterEditBox() {
  // Enter Edit mode, choose the "Add box" tool.
  const editOpen = await win.evaluate(() =>
    (document.querySelector('[data-toolbar-edit-toggle]')?.getAttribute('aria-pressed') || 'false') === 'true'
  );
  if (!editOpen) {
    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(500);
}

// Count committed (non-preview) annotation elements of a class on a page slot.
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

// Return { left, top, width, height } from a placement's inline style.
function styleRect(e) {
  return {
    left: parseFloat(e.style.left || '0'),
    top: parseFloat(e.style.top || '0'),
    width: parseFloat(e.style.width || '0'),
    height: parseFloat(e.style.height || '0'),
  };
}

// Read the fraction of dark pixels in the "TFlex Technical Report" title
// region of the page-1 canvas. Returns null if the title/canvas is not found.
async function titleDarkFrac() {
  return win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (!slot) return { error: 'no page-1 slot' };
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { error: 'no canvas' };
    let titleSpan = null;
    slot.querySelectorAll('.textLayer span').forEach((s) => {
      if ((s.textContent || '').trim() === 'TFlex Technical Report') titleSpan = s;
    });
    if (!titleSpan) return { titleFound: false, error: 'title span not found' };
    const cr = canvas.getBoundingClientRect();
    const sr = titleSpan.getBoundingClientRect();
    const x0 = sr.left - cr.left;
    const y0 = sr.top - cr.top;
    const sx = canvas.width / cr.width;
    const sy = canvas.height / cr.height;
    const ix = Math.max(0, Math.floor(x0 * sx));
    const iy = Math.max(0, Math.floor(y0 * sy));
    const iw = Math.max(1, Math.floor(sr.width * sx));
    const ih = Math.max(1, Math.floor(sr.height * sy));
    const cw = Math.min(iw, canvas.width - ix);
    const ch = Math.min(ih, canvas.height - iy);
    if (cw < 1 || ch < 1) return { titleFound: true, error: 'region outside canvas', cw, ch };
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(ix, iy, cw, ch);
    let dark = 0;
    const total = img.data.length / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      if (lum < 160) dark += 1;
    }
    return { titleFound: true, dark, total, darkFrac: dark / total, region: { ix, iy, cw, ch } };
  });
}

// ---------------------------------------------------------------------------
// DEF-132 — frameless title bar is draggable.
// ---------------------------------------------------------------------------
test('DEF-132: title bar exposes a real drag region (frameless window movable)', async () => {
  await openSample('report.pdf');
  const evidence = await win.evaluate(() => {
    const bar = document.querySelector('.titlebar');
    if (!bar) return { error: 'no .titlebar' };
    const b = bar.getBoundingClientRect();
    const isDrag = (el) => getComputedStyle(el).webkitAppRegion;
    const regions = [];
    const stack = [bar];
    while (stack.length) {
      const el = stack.shift();
      const r = el.getBoundingClientRect();
      regions.push({
        sel: el.className && typeof el.className === 'string'
          ? ('.' + el.className.trim().split(/\s+/).join('.')).slice(0, 60)
          : el.tagName,
        region: isDrag(el) || 'inherit',
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
      for (const c of el.children) stack.push(c);
    }
    // Transitive drag resolution: a point is draggable if an ancestor has
    // `drag` and no closer ancestor/element in between has `no-drag`.
    const pointIsDrag = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (el === null) return false;
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const reg = getComputedStyle(cur).webkitAppRegion;
        if (reg === 'no-drag') return false;
        if (reg === 'drag') return true;
        cur = cur.parentElement;
      }
      return false;
    };
    let dragPx = 0;
    let noDragPx = 0;
    const step = 6;
    for (let y = b.top + 2; y < b.bottom - 2; y += step) {
      for (let x = b.left + 2; x < b.right - 2; x += step) {
        if (pointIsDrag(x, y)) dragPx += step * step;
        else noDragPx += step * step;
      }
    }
    // The titlebar-slot is the interactive host (brand + tabs). It must NOT
    // carry its own no-drag rule (the DEF-132 `.titlebar > * { no-drag }` was
    // the root cause). Empty areas inside it must resolve to a drag region.
    const slot = regions.find((r) => r.sel.includes('titlebar-slot'));
    const header = regions.find((r) => r.sel.includes('app-header'));
    return {
      barRect: { x: b.x, y: b.y, width: b.width, height: b.height },
      barRegion: isDrag(bar) || 'inherit',
      slotRegion: slot ? slot.region : null,
      headerRegion: header ? header.region : null,
      dragPx,
      noDragPx,
    };
  });
  console.log('[DEF-132] barRect=', JSON.stringify(evidence.barRect));
  console.log('[DEF-132] .titlebar region =', evidence.barRegion);
  console.log('[DEF-132] .titlebar-slot region =', evidence.slotRegion);
  console.log('[DEF-132] .app-header region =', evidence.headerRegion);
  console.log('[DEF-132] dragPx=', evidence.dragPx, 'noDragPx=', evidence.noDragPx);
  await shot('def-132-titlebar-draggable.png');

  expect(evidence.barRegion, '.titlebar must carry -webkit-app-region: drag').toBe('drag');
  expect(evidence.slotRegion, '.titlebar-slot must not be no-drag').not.toBe('no-drag');
  expect(evidence.headerRegion, '.app-header must not be no-drag').not.toBe('no-drag');
  expect(evidence.dragPx, 'there must be a real draggable caption surface').toBeGreaterThan(0);
  // A substantial fraction of the bar should be draggable (spaces around the
  // brand / tabs / between buttons) even with the interactive controls opted out.
  const barArea = evidence.barRect.width * evidence.barRect.height;
  const dragFrac = evidence.dragPx / Math.max(1, barArea);
  console.log('[DEF-132] drag fractional coverage =', dragFrac.toFixed(3));
  expect(dragFrac, 'a meaningful portion of the title bar must be drag-able').toBeGreaterThan(0.05);
  console.log('[DEF-132] PASS: the frameless title bar has a real drag region.');
});

// ---------------------------------------------------------------------------
// DEF-133 — after inserting a blank page, pen/rect annotations on the visible
// page 2 / page 3 land on the CORRECT visible page (source/visible mismatch
// was the root cause: overlays were stamped with the SOURCE page number).
// ---------------------------------------------------------------------------
test('DEF-133: post-insert pen on visible page 2 + rect on page 3 land correctly', async () => {
  await openSample('report.pdf');
  let d = await diag();
  const beforeCount = d.engineState.pageCount;
  const beforeOrder = d.engineState.pageOrder.slice();
  console.log(`[DEF-133] before insert count=${beforeCount} order0-6=${JSON.stringify(beforeOrder.slice(0, 6))}`);

  // Insert a blank page at position 2 (becomes visible page 2).
  await openPaletteTool('insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(500);
  await win.fill('[data-insert-position]', '2');
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2600);

  d = await diag();
  const afterOrder = d.engineState.pageOrder.slice();
  console.log(`[DEF-133] after insert count=${d.engineState.pageCount} order0-8=${JSON.stringify(afterOrder.slice(0, 8))}`);
  const expectCount = beforeCount + 1;
  expect(d.engineState.pageCount, 'page count must go 34 -> 35').toBe(expectCount);
  // Insert-blank regression: the blank (origIdx = beforeCount) must be visible
  // page 2 and every page must appear exactly once.
  expect(afterOrder.length, 'pageOrder length matches pageCount').toBe(expectCount);
  expect(new Set(afterOrder).size, 'pageOrder must have no duplicate origIdx').toBe(expectCount);
  expect(afterOrder[1], 'visible page 2 must be the new blank').toBe(beforeCount);

  // PEN on visible page 2.
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(400);
  await scrollToPage(2);
  const slot2 = win.locator('.page-slot[data-page="2"]');
  const bb2 = await slot2.first().boundingBox();
  await win.mouse.move(bb2.x + 200, bb2.y + 180);
  await win.mouse.down();
  await win.mouse.move(bb2.x + 350, bb2.y + 300, { steps: 10 });
  await win.mouse.move(bb2.x + 420, bb2.y + 210, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(1000);

  // RECT on visible page 3.
  await armAnnotationTool(win, 'rect');
  const activeTool = await win.evaluate(() => window.tflexDiagnostics().activeTool);
  console.log('[DEF-133] active annotation tool after rect click =', activeTool);
  await scrollToPage(3);
  const slot3 = win.locator('.page-slot[data-page="3"]');
  const bb3 = await slot3.first().boundingBox();
  console.log('[DEF-133] page3 bbox =', JSON.stringify(bb3));
  await win.mouse.move(bb3.x + 160, bb3.y + 160);
  await win.mouse.down();
  await win.mouse.move(bb3.x + 320, bb3.y + 300, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(1000);

  d = await diag();
  const anns = d.engineState.annotations ?? [];
  const inkPages = anns.filter((a) => a.kind === 'ink').map((a) => a.page);
  const rectPages = anns.filter((a) => a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'shape').map((a) => a.page);
  console.log('[DEF-133] engine annotations =', anns.length, JSON.stringify(anns.map((a) => ({ kind: a.kind, page: a.page }))));
  console.log('[DEF-133] ink annotation pages =', JSON.stringify(inkPages), 'rect pages =', JSON.stringify(rectPages));

  // The ink drawn on VISIBLE page 2 must be recorded on page 2 (was page 35).
  expect(inkPages, 'the pen stroke must be stored on visible page 2').toContain(2);
  // The rect drawn on VISIBLE page 3 must be recorded on page 3.
  expect(rectPages.length, 'the rectangle annotation must exist').toBeGreaterThan(0);
  expect(rectPages, 'the rectangle must be stored on visible page 3').toContain(3);

  // Rendered commitment check: ink rendered on the visible page-2 slot.
  const inkRender2 = await annCountOnPage(2, '.ann-ink');
  console.log('[DEF-133] committed ink rendered on visible page 2 =', inkRender2);
  expect(inkRender2, 'the ink must be rendered on the visible page-2 slot').toBeGreaterThan(0);
  await shot('def-133-pen-correct-page.png');

  // No annotation may have landed on the last visible page (page 35).
  expect(inkPages, 'no ink should land on page 35').not.toContain(afterOrder.length);
  console.log('[DEF-133] PASS: post-insert pen/rect land on the correct visible page.');
});

// ---------------------------------------------------------------------------
// DEF-134 — dragging a committed signature, then clicking it, must NOT revert
// the new position; Confirm commits it; the move is visible live before confirm.
// ---------------------------------------------------------------------------
test('DEF-134: committed sig drag + click keeps move; Confirm commits', async () => {
  await openSample('report.pdf');

  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA');
  await win.click('.sig-manager button:text-is("Save")');
  await win.click('.sig-saved-pick');
  // The manager's closing (exit-animated) backdrop intercepts page
  // pointers for ~250ms after the pick — wait for it to detach before
  // the placement click (race found 2026-09-06, qa).
  await win.waitForSelector('.sig-manager', { state: 'detached', timeout: 10000 });
  const layer = win.locator('[data-annotation-layer="1"]');
  const lb = await layer.first().boundingBox();
  await win.mouse.click(lb.x + 200, lb.y + 200);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(600);

  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 8000 });
  const readRect = () => placement.evaluate(styleRect);
  const initial = await readRect();
  console.log('[DEF-134] committed placement rect=', JSON.stringify(initial));

  // Drag 120px right / 60px down.
  const pb = await placement.boundingBox();
  await win.mouse.move(pb.x + 20, pb.y + 20);
  await win.mouse.down();
  await win.mouse.move(pb.x + 20 + 120, pb.y + 20 + 60, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const afterDrag = await readRect();
  const dragDx = afterDrag.left - initial.left;
  const dragDy = afterDrag.top - initial.top;
  console.log('[DEF-134] after drag rect=', JSON.stringify(afterDrag), `dx=${dragDx} dy=${dragDy}`);
  // Live-update visible before confirm: the held rect must reflect the drag.
  expect(dragDx, 'the move must be applied live (right)').toBeGreaterThan(50);
  expect(dragDy, 'the move must be applied live (down)').toBeGreaterThan(30);
  await shot('def-134-after-drag.png');

  // Click the placement WITHOUT confirming — must NOT revert the move.
  const pb2 = await placement.boundingBox();
  await win.mouse.click(pb2.x + 20, pb2.y + 20);
  await win.waitForTimeout(500);
  const afterClick = await readRect();
  const revertDx = afterClick.left - initial.left;
  console.log('[DEF-134] after click (no confirm) rect=', JSON.stringify(afterClick), `dxFromInitial=${revertDx}`);
  expect(afterClick.left, 'click must NOT revert the dragged X').toBeGreaterThan(initial.left + 50);
  expect(afterClick.top, 'click must NOT revert the dragged Y').toBeGreaterThan(initial.top + 30);
  await shot('def-134-after-click-no-revert.png');

  // Confirm must commit the new position.
  const confirmBtn = win.locator('[data-sig-action="confirm"]');
  await confirmBtn.click();
  await win.waitForTimeout(500);
  const afterConfirm = await readRect();
  console.log('[DEF-134] after Confirm rect=', JSON.stringify(afterConfirm));
  expect(afterConfirm.left, 'Confirm commits the dragged X').toBeGreaterThan(initial.left + 50);
  expect(afterConfirm.top, 'Confirm commits the dragged Y').toBeGreaterThan(initial.top + 30);
  await shot('def-134-after-confirm-commit.png');
  console.log('[DEF-134] PASS: click keeps the drag; Confirm commits the new position.');
});

// ---------------------------------------------------------------------------
// DEF-135 — moving a placed text box must NOT erase the document content it
// covered. The old mask-and-draw erased the title where the box sat.
// ---------------------------------------------------------------------------
test('DEF-135: moving a text box that covered the title does not erase it', async () => {
  await openSample('report.pdf');
  const baseline = await titleDarkFrac();
  console.log('[DEF-135] baseline title dark fraction =', JSON.stringify(baseline));
  expect(baseline && baseline.titleFound, 'the title must be present before the box').toBeTruthy();
  const baselineDark = baseline.darkFrac;
  expect(baselineDark, 'the title must be painted (has dark glyphs) before the box').toBeGreaterThan(0.005);

  await enterEditBox();
  // Position a box directly over the title.
  const page1 = win.locator('.page-slot[data-page="1"]').first();
  await page1.waitFor({ timeout: 8000 });
  const pb = await page1.boundingBox();
  const titleRect = await win.evaluate(() => {
    const slotEl = document.querySelector('.page-slot[data-page="1"]');
    const sr = slotEl.getBoundingClientRect();
    let best = null;
    slotEl.querySelectorAll('.textLayer span').forEach((s) => {
      const t = (s.textContent || '').trim();
      if (t === 'TFlex Technical Report') {
        const r = s.getBoundingClientRect();
        best = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
      }
    });
    return best;
  });
  console.log('[DEF-135] title rect (page-local px)=', JSON.stringify(titleRect));
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
  expect(boxCount, 'the text box must be committed').toBe(1);
  console.log('[DEF-135] committed box count =', boxCount);

  // Drag the box body 120px right / 120px down — away from the title.
  // DEF-153/152 model: the drag leaves the box PENDING with a Confirm bar;
  // clicking Confirm commits the move to the engine (commit-on-release is gone).
  const box = win.locator('.edit-box').first();
  const bb = await box.boundingBox();
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.mouse.down();
  await win.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2 + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const confirmBtn = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.edit-box-toolbar button')) {
      if (/confirm/i.test(b.textContent || '')) {
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  expect(confirmBtn, 'the moved box must offer Confirm (pending bar)').toBeTruthy();
  await win.mouse.click(confirmBtn.x, confirmBtn.y);
  await win.waitForTimeout(1800);
  await shot('def-135-after-move.png');

  // The box must have moved (its registry rect changed).
  const boxRect = await box.evaluate((el) => ({ left: parseFloat(el.style.left || '0'), top: parseFloat(el.style.top || '0') }));
  console.log('[DEF-135] box rect after move =', JSON.stringify(boxRect));
  expect(boxRect.left, 'the box must move right').toBeGreaterThan(bx + 80);
  expect(boxRect.top, 'the box must move down').toBeGreaterThan(by + 80);

  // The title must STILL be painted (not white-masked) after the box moved away.
  const afterMove = await titleDarkFrac();
  console.log('[DEF-135] after-move title dark fraction =', JSON.stringify(afterMove));
  expect(afterMove && afterMove.titleFound, 'the title must still exist after the move').toBeTruthy();
  expect(afterMove.darkFrac, 'the title must still be painted (no white mask)').toBeGreaterThan(0.005);
  // The painted ink must not have materially dropped relative to the baseline.
  expect(afterMove.darkFrac, 'title glyphs must not be erased by the move').toBeGreaterThan(baselineDark * 0.7);

  // Document safety: save the result and re-parse — must be a valid 34-page
  // PDF and the moved box text must survive.
  const savePath = path.join(os.tmpdir(), `tflex-def135-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, savePath);
  await win.click('button[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  const savedExists = fs.existsSync(savePath);
  console.log('[DEF-135] saved file exists =', savedExists, 'path =', savePath);
  expect(savedExists, 'the edited document must save').toBeTruthy();
  const { PDFDocument } = require(path.join(__dirname, '..', '..', 'node_modules', 'pdf-lib'));
  const pdf = await PDFDocument.load(fs.readFileSync(savePath));
  expect(pdf.getPageCount(), 'saved PDF must be valid and 34 pages').toBe(34);
  console.log('[DEF-135] PASS: moving the box leaves the underlying content intact; save is valid.');
});

// ---------------------------------------------------------------------------
// DEF-136 — selecting a placed text box shows a Delete/Edit toolbar; Delete
// removes it through the engine registry.
// ---------------------------------------------------------------------------
test('DEF-136: selected text box shows Delete/Edit toolbar; Delete removes it', async () => {
  await openSample('report.pdf');
  await enterEditBox();
  const page1 = win.locator('.page-slot[data-page="1"]').first();
  await page1.waitFor({ timeout: 8000 });
  const pb = await page1.boundingBox();
  // Create a box.
  await win.mouse.move(pb.x + 120, pb.y + 120);
  await win.mouse.down();
  await win.mouse.move(pb.x + 360, pb.y + 260, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const editor = win.locator('.edit-inline-textarea');
  await editor.waitFor({ timeout: 8000 });
  await win.fill('.edit-inline-textarea', 'DELETABLE BOX');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);
  const box = win.locator('.edit-box').first();
  await box.waitFor({ timeout: 8000 });
  const boxId = await box.getAttribute('data-edit-box-id');
  console.log('[DEF-136] committed box id =', boxId, 'count =', await win.evaluate(() => document.querySelectorAll('.edit-box').length));

  // Click the box body -> selects it AND reopens the inline editor.
  const bb = await box.boundingBox();
  await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.waitForTimeout(500);
  const editorOpen = await win.evaluate(() => !!document.querySelector('.edit-inline-editor'));
  console.log('[DEF-136] editor reopened on box click =', editorOpen);

  const getBoxInfo = () => win.evaluate(() => {
    const b = document.querySelector('.edit-box');
    const toolbar = document.querySelector('.edit-box-toolbar');
    return {
      selected: !!document.querySelector('.edit-box-selected'),
      toolbar: !!toolbar,
      editAction: !!document.querySelector('[data-edit-box-action="edit"]'),
      deleteAction: !!document.querySelector('[data-edit-box-action="delete"]'),
    };
  });

  // If the editor reopened, close it (Escape) so the box stays selected and the
  // placement toolbar (which requires no editor open) renders with Delete/Edit.
  if (editorOpen) {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(700);
  }
  let info = await getBoxInfo();
  console.log('[DEF-136] after selecting box (toolbar state) =', JSON.stringify(info));
  expect(info.selected, 'the box must be selected').toBe(true);
  expect(info.toolbar, 'a placement toolbar must appear for the selected box').toBe(true);
  expect(info.editAction, 'the toolbar must include Edit').toBe(true);
  expect(info.deleteAction, 'the toolbar must include Delete').toBe(true);
  await shot('def-136-box-toolbar-delete-edit.png');

  // Click Delete -> the box is removed (engine registry op).
  await win.click('[data-edit-box-action="delete"]');
  await win.waitForTimeout(1200);
  const remaining = await win.evaluate((id) => document.querySelectorAll(`.edit-box[data-edit-box-id="${id}"]`).length, boxId);
  const state = await diag();
  const engineBoxes = state.engineState.textBoxes ?? [];
  console.log('[DEF-136] after Delete: rendered .edit-box for id =', remaining, 'engine textBoxes =', JSON.stringify(engineBoxes.map((tb) => tb.id)));
  expect(remaining, 'the rendered box must be removed').toBe(0);
  expect(engineBoxes.some((tb) => tb.id === boxId), 'the engine registry must no longer hold the box').toBe(false);
  await shot('def-136-after-delete.png');
  console.log('[DEF-136] PASS: committed box is selectable, shows Delete/Edit, and Delete removes it.');
});

// ---------------------------------------------------------------------------
// Regression — add-box text commit renders live + the editor font picker
// live-updates the textarea font-family.
// ---------------------------------------------------------------------------
test('REG-1: text-box commit renders live; inline Font picker live-previews', async () => {
  await openSample('report.pdf');
  await enterEditBox();
  const page1 = win.locator('.page-slot[data-page="1"]').first();
  await page1.waitFor({ timeout: 8000 });
  const pb = await page1.boundingBox();
  await win.mouse.move(pb.x + 100, pb.y + 100);
  await win.mouse.down();
  await win.mouse.move(pb.x + 360, pb.y + 240, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const editor = win.locator('.edit-inline-textarea');
  await editor.waitFor({ timeout: 8000 });
  await win.fill('.edit-inline-textarea', 'REG BOX 12345');

  // Font live preview: pick Times then Courier; the textarea font-family must
  // follow immediately (before commit).
  const fontSelect = win.locator('.edit-inline-editor select[aria-label="Font"]');
  await fontSelect.selectOption('Times');
  await win.waitForTimeout(300);
  const timesFamily = await editor.evaluate((el) => getComputedStyle(el).fontFamily);
  console.log('[REG-1] textarea fontFamily after Times =', timesFamily);
  expect(timesFamily, "Times must live-update the textarea font-family").toContain('Times New Roman');
  await fontSelect.selectOption('Courier');
  await win.waitForTimeout(300);
  const courierFamily = await editor.evaluate((el) => getComputedStyle(el).fontFamily);
  console.log('[REG-1] textarea fontFamily after Courier =', courierFamily);
  expect(courierFamily, "Courier must live-update the textarea font-family").toContain('Courier New');

  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);
  // Full committed text renders live in the box mirror (no dropped fragment).
  const mirrorText = await win.evaluate(() => {
    const m = document.querySelector('[data-edit-box-text-mirror]');
    return m ? m.getAttribute('data-edit-box-text-mirror') : null;
  });
  console.log('[REG-1] committed box text mirror =', JSON.stringify(mirrorText));
  expect(mirrorText, 'the committed box text must render fully').toBe('REG BOX 12345');
  await shot('reg-1-box-commit-font.png');
  console.log('[REG-1] PASS: box commit renders live; font picker live-previews.');
});

// ---------------------------------------------------------------------------
// Regression — OCR suspects panel opens as a flush flow element below the
// top bar (DEF-126), and insert-blank page order is correct (DEF-129/130).
// ---------------------------------------------------------------------------
test('REG-2: OCR suspects panel is a flush top bar (no dead gap / overlap)', async () => {
  await openSample('scanned.pdf');
  await openPaletteTool('recognizeText');
  await win.waitForSelector('[data-ocr-scope="currentPage"]', { timeout: 10000 });
  await win.click('[data-ocr-scope="currentPage"]');
  await win.click('[data-ocr-confirm]');
  // Wait for the suspects panel to appear.
  await win.waitForSelector('.ocr-suspects-panel', { timeout: 90000 });
  await win.waitForTimeout(1200);
  const layout = await win.evaluate(() => {
    const panel = document.querySelector('.ocr-suspects-panel');
    const appMain = document.querySelector('.app-main');
    if (!panel || !appMain) return { error: 'missing panel/appMain' };
    const p = panel.getBoundingClientRect();
    const m = appMain.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    return {
      top: p.top,
      appMainTop: m.top,
      width: p.width,
      position: cs.position,
      background: cs.backgroundColor,
    };
  });
  console.log('[REG-2] OCR suspects layout =', JSON.stringify(layout));
  expect(layout.position, 'the panel must be a flow element, not an opaque overlay').not.toBe('absolute');
  expect(Math.abs(layout.top - layout.appMainTop), 'the panel must sit flush below the top bar').toBeLessThan(2);
  await shot('reg-2-ocr-suspects-panel.png');
  console.log('[REG-2] PASS: OCR suspects panel is a flush flow top bar.');
});
