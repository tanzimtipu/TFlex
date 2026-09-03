// QA reproduction of three operator-reported bugs on the INSTALLED v1.7.12
// binary (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe).
//
//   BUG 2  Insert blank page "after page 1" (blank becomes page 2). Then
//          VISUALLY inspect the left thumbnail rail (first 5 thumbs) and
//          draw with pen+rectangle on visible pages 2 and 3.
//   BUG 3  Per-page crop on page 2 with a distinctive box, then VISUALLY
//          inspect pages 2/3/4/5 (rendered content, not CropBox numbers).
//          Try a second crop with a different size.
//   BUG 4  Add a text box, then press-and-HOLD and drag it (multiple real
//          pointerdown/pointermove sequences). Does it move live under the
//          cursor and after release? Then single-click the box — does a
//          toolbar/editor appear?
//
// Launch ONLY through e2e/lib/launch.cjs against the packaged exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

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
  if (electronApp) await electronApp.close().catch(() => {});
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openSampleFromCard(name) {
  // Open from the SAMPLE CARDS exactly as the operator did.
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2000);
}

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  return p;
}

// Screenshot a specific clip region (used to capture a page or thumb close-up).
async function shotClip(name, selector) {
  const el = win.locator(selector).first();
  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    console.log(`[SKIP-CLIP] ${name} -- no nonzero bounding box for ${selector}`);
    return null;
  }
  // Clamp the clip to the visible viewport (virtualized rail thumbs below the
  // fold have valid layout coords but are beyond the screenshot image bounds).
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
  for (let i = 0; i < 60; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1400;
      return false;
    }, n);
    await win.waitForTimeout(250);
    if (done) break;
  }
  await win.waitForTimeout(1200);
  // Nudge the target slot so it mounts fully.
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - 120;
  }, n);
  await win.waitForTimeout(800);
}

// Hash of the page slot's main canvas content (before/after a drawn mark).
async function canvasHash(pageNum) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return null;
    const c = s.querySelector('canvas.pdf-page-canvas, canvas');
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    let w = c.width, h = c.height;
    const px = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 97) sum = (sum + px[i]) % 1000000007;
    return { w, h, sum, u: String.fromCharCode(...px.slice(0, 8)) };
  }, pageNum);
}

async function openTools() {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await win.waitForTimeout(300);
  }
}

// ---------------------------------------------------------------------------
// Helper: dump the first N thumbnail DOM facts (data-page + data-source-page)
// after scrolling the rail so the first few are mounted.
// ---------------------------------------------------------------------------
async function dumpThumbs(count) {
  return win.evaluate((n) => {
    // Force the rail to scroll to the very top so thumbs 1..N mount.
    const sc = document.querySelector('.thumb-scroller-inner');
    if (sc) sc.scrollTop = 0;
    const out = [];
    const items = document.querySelectorAll('.thumb-item');
    for (const it of items) {
      const dp = it.getAttribute('data-page');
      const dst = it.getAttribute('data-source-page');
      // visible slot number from data-page
      out.push({ dataPage: dp, dataSourcePage: dst });
    }
    // Sort by visible data-page so ordering is stable.
    out.sort((a, b) => (parseInt(a.dataPage, 10) - parseInt(b.dataPage, 10)));
    return out.slice(0, n);
  }, count);
}

// Read a page slot's canvas bounding rect (for aspect / size checks).
async function pageRect(pageNum) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return null;
    const c = s.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  }, pageNum);
}

// Count rendered annotation elements of a class on a page slot (committed only).
async function annCount(pageNum, cls) {
  return win.evaluate(({ pageNum, cls }) => {
    const s = document.querySelector(`.page-slot[data-page="${pageNum}"]`);
    let n = 0;
    if (s) s.querySelectorAll(cls).forEach((e) => { if (!e.classList.contains('ann-preview')) n += 1; });
    return n;
  }, { pageNum, cls });
}

// ---------------------------------------------------------------------------
// BUG 2 — insert blank page "after page 1", then visually inspect rail + draw.
// ---------------------------------------------------------------------------
test('BUG2: insert blank after page 1; visual rail + draw on pages 2/3', async () => {
  await openSampleFromCard('report.pdf');
  const d0 = await diag();
  console.log(`[BUG2] base pageCount=${d0.pageCount}`);

  // Open Insert pages dialog.
  await openTools();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.waitForTimeout(200);
  // "after page 1" i.e. blank becomes page 2 -> field value 2.
  await win.fill('[data-insert-position]', '2');
  await win.waitForTimeout(300);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2600);

  const d1 = await diag();
  console.log(`[BUG2] after insert pageCount=${d1.pageCount}`);
  console.log(`[BUG2] pageOrder[0..6]=${JSON.stringify(d1.engineState.pageOrder.slice(0, 7))}`);
  console.log(`[BUG2] pageOrderLen=${d1.engineState.pageOrder.length} unique=${new Set(d1.engineState.pageOrder).size}`);

  // Wait for the rail + proxy to fully refresh.
  await win.waitForTimeout(1500);

  const thumbs = await dumpThumbs(6);
  console.log(`[BUG2] thumbs(first 6)=${JSON.stringify(thumbs)}`);

  // Visual screenshots.
  await shot('bug2-after-insert-rail.png');
  // Capture the rail region (left ~230px).
  const railBox = await win.locator('.side-rail, .thumb-scroller').first().boundingBox();
  if (railBox) {
    await win.screenshot({ path: path.join(SHOTS, 'bug2-left-rail.png'), clip: { x: railBox.x, y: railBox.y, width: railBox.width, height: Math.min(railBox.height, 640) } });
  }

  // For each of the first 5 thumbs, capture a close-up clip too.
  for (let i = 1; i <= 5; i++) {
    await shotClip(`bug2-thumb-${i}.png`, `.thumb-item[data-page="${i}"]`);
  }

  // scroll to visible page 1,2,3 and screenshot their rendered content.
  await scrollToPage(1);
  await shot('bug2-page1.png');
  await scrollToPage(2);
  await shot('bug2-page2.png');
  await scrollToPage(3);
  await shot('bug2-page3.png');

  console.log('[BUG2] ===== drawing on visible pages 2 and 3 =====');

  // Hash page-2 canvas BEFORE drawing.
  await scrollToPage(2);
  const p2 = await pageRect(2);
  const hashBefore2 = await canvasHash(2);
  console.log(`[BUG2] page2 rect=${JSON.stringify(p2)} hashBefore2=${JSON.stringify(hashBefore2)}`);
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(p2.x + 200, p2.y + 200);
  await win.mouse.down();
  await win.mouse.move(p2.x + 400, p2.y + 320, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(900);
  const annAfterInk = await diag();
  const hashAfter2 = await canvasHash(2);
  console.log(`[BUG2] after ink annotations=${JSON.stringify(annAfterInk.engineState.annotations.map(a => ({ kind: a.kind, page: a.page })))}`);
  console.log(`[BUG2] page2 canvas changed after ink = ${JSON.stringify(hashBefore2)} -> ${JSON.stringify(hashAfter2)}`);
  await shot('bug2-page2-after-ink.png');

  // Hash page-3 canvas BEFORE drawing.
  await scrollToPage(3);
  const p3 = await pageRect(3);
  const hashBefore3 = await canvasHash(3);
  console.log(`[BUG2] page3 rect=${JSON.stringify(p3)} hashBefore3=${JSON.stringify(hashBefore3)}`);
  await win.locator('.ann-toolbar button[data-tool="rect"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(p3.x + 180, p3.y + 180);
  await win.mouse.down();
  await win.mouse.move(p3.x + 360, p3.y + 300, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(900);
  const annAfterRect = await diag();
  const hashAfter3 = await canvasHash(3);
  console.log(`[BUG2] after rect annotations=${JSON.stringify(annAfterRect.engineState.annotations.map(a => ({ kind: a.kind, page: a.page })))}`);
  console.log(`[BUG2] page3 canvas changed after rect = ${JSON.stringify(hashBefore3)} -> ${JSON.stringify(hashAfter3)}`);
  await shot('bug2-page3-after-rect.png');

  // Also screenshot page 2 briefly to confirm whether ink landed there.
  await scrollToPage(2);
  await shot('bug2-page2-check.png');

  // Count rendered ann elements per page.
  const inkOn2 = await annCount(2, '.ann-ink');
  const inkOn3 = await annCount(3, '.ann-ink');
  const rectOn2 = await annCount(2, '.ann-rect, [data-kind="rect"]');
  const rectOn3 = await annCount(3, '.ann-rect, [data-kind="rect"]');
  console.log(`[BUG2] rendered: inkOnPage2=${inkOn2} inkOnPage3=${inkOn3} rectOnPage2=${rectOn2} rectOnPage3=${rectOn3}`);

  console.log(`[BUG2] pageErrors=${JSON.stringify(pageErrors)}`);
});

// ---------------------------------------------------------------------------
// BUG 3 — per-page crop on page 2 with a distinctive box; visual inspect 2/3/4/5.
// ---------------------------------------------------------------------------
test('BUG3: per-page crop page 2; visually inspect pages 2/3/4/5 + a 2nd crop', async () => {
  await openSampleFromCard('report.pdf');
  await win.waitForTimeout(1500);

  // Capture the ORIGINAL rendered content of pages 1-5 for reference.
  await scrollToPage(2);
  await shot('bug3-before-p2.png');
  await scrollToPage(3);
  await shot('bug3-before-p3.png');
  await scrollToPage(4);
  await shot('bug3-before-p4.png');

  const beforeRectP2 = await pageRect(2);
  const beforeRectP3 = await pageRect(3);
  console.log(`[BUG3] before crop p2=${JSON.stringify(beforeRectP2)} p3=${JSON.stringify(beforeRectP3)}`);

  // Open crop dialog.
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);
  await win.locator('[data-crop-page-select]').selectOption('2');
  await win.waitForTimeout(600);

  // Determine the crop editor scale to hit a distinctive box (left 100, top 100, w 300, h 400).
  const editorInfo = await win.evaluate(() => {
    const page = document.querySelector('.crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const rp = page ? page.getBoundingClientRect() : null;
    const rm = mask ? mask.getBoundingClientRect() : null;
    return {
      pageW: rp ? Math.round(rp.width) : null,
      pageH: rp ? Math.round(rp.height) : null,
      maskX: rm ? Math.round(rm.x) : null,
      maskY: rm ? Math.round(rm.y) : null,
      maskW: rm ? Math.round(rm.width) : null,
      maskH: rm ? Math.round(rm.height) : null,
    };
  });
  console.log(`[BUG3] crop editor info=${JSON.stringify(editorInfo)}`);
  await shot('bug3-crop-dialog-p2.png');

  // Drag the SE handle inward to shrink the box into a distinctive shape.
  const se = win.locator('[data-crop-handle="se"]');
  await se.waitFor({ timeout: 10000 });
  const seBox = await se.boundingBox();
  if (seBox) {
    await win.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await win.mouse.down();
    await win.mouse.move(seBox.x + seBox.width / 2 - 110, seBox.y + seBox.height / 2 - 110, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  }
  // Read crop summary values (x, y, width, height in pt).
  const cropSummary = await win.evaluate(() => {
    const rows = document.querySelectorAll('.crop-summary-row');
    const out = {};
    rows.forEach((r) => {
      const label = r.querySelector('.crop-summary-label')?.textContent?.trim();
      const val = r.querySelector('.crop-summary-value')?.textContent?.trim();
      if (label && val) out[label] = val;
    });
    return out;
  });
  console.log(`[BUG3] crop summary after drag=${JSON.stringify(cropSummary)}`);
  await shot('bug3-crop-dialog-after-drag.png');

  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2400);

  // Visual inspect pages 2,3,4,5 after apply.
  await scrollToPage(2);
  await shot('bug3-after-p2.png');
  const afterRectP2 = await pageRect(2);
  await scrollToPage(3);
  await shot('bug3-after-p3.png');
  const afterRectP3 = await pageRect(3);
  await scrollToPage(4);
  await shot('bug3-after-p4.png');
  const afterRectP4 = await pageRect(4);
  await scrollToPage(5);
  await shot('bug3-after-p5.png');
  const afterRectP5 = await pageRect(5);
  console.log(`[BUG3] after crop p2=${JSON.stringify(afterRectP2)} p3=${JSON.stringify(afterRectP3)} p4=${JSON.stringify(afterRectP4)} p5=${JSON.stringify(afterRectP5)}`);

  // SECOND crop on a different page with a different size.
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);
  await win.locator('[data-crop-page-select]').selectOption('5');
  await win.waitForTimeout(600);
  const se5 = win.locator('[data-crop-handle="se"]');
  await se5.waitFor({ timeout: 10000 });
  const se5Box = await se5.boundingBox();
  if (se5Box) {
    await win.mouse.move(se5Box.x + se5Box.width / 2, se5Box.y + se5Box.height / 2);
    await win.mouse.down();
    await win.mouse.move(se5Box.x + se5Box.width / 2 - 170, se5Box.y + se5Box.height / 2 - 60, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  }
  const cropSummary2 = await win.evaluate(() => {
    const rows = document.querySelectorAll('.crop-summary-row');
    const out = {};
    rows.forEach((r) => {
      const label = r.querySelector('.crop-summary-label')?.textContent?.trim();
      const val = r.querySelector('.crop-summary-value')?.textContent?.trim();
      if (label && val) out[label] = val;
    });
    return out;
  });
  console.log(`[BUG3] crop2 summary=${JSON.stringify(cropSummary2)}`);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2400);
  await scrollToPage(5);
  await shot('bug3-after-second-crop-p5.png');
  const afterRectP5b = await pageRect(5);
  await scrollToPage(6);
  await shot('bug3-after-second-crop-p6.png');
  const afterRectP6 = await pageRect(6);
  console.log(`[BUG3] after 2nd crop p5=${JSON.stringify(afterRectP5b)} p6=${JSON.stringify(afterRectP6)}`);

  console.log(`[BUG3] pageErrors=${JSON.stringify(pageErrors)}`);
});

// ---------------------------------------------------------------------------
// BUG 4 — Add box, text, then press-and-HOLD drag; then single-click.
// ---------------------------------------------------------------------------
test('BUG4: add text box, press-and-hold drag (live), then single-click', async () => {
  await openSampleFromCard('report.pdf');
  // Enter Edit mode + Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const page1 = await pageRect(1);
  console.log(`[BUG4] page1 rect=${JSON.stringify(page1)}`);

  // Drag to create a box on the page.
  await win.mouse.move(page1.x + 300, page1.y + 300);
  await win.mouse.down();
  await win.mouse.move(page1.x + 520, page1.y + 400, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);

  // type text + commit (confirm button).
  const editorCount = await win.locator('[data-edit-editor="box"]').count();
  console.log(`[BUG4] box editor count=${editorCount}`);
  const ta = win.locator('[data-edit-textarea]');
  if (await ta.count()) {
    await ta.fill('FOUR DRAG TEST BOX');
    await win.waitForTimeout(200);
  }
  await shot('bug4-editor-open.png');
  const commitBtn = win.locator('[aria-label="Apply edit"]');
  if (await commitBtn.count()) await commitBtn.click({ force: true });
  else await win.keyboard.press('Control+Enter').catch(() => {});
  await win.waitForTimeout(800);

  // Record the committed box geometry.
  const box0 = await win.evaluate(() => {
    const b = document.querySelector('.edit-box');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), id: b.getAttribute('data-edit-box-id'), text: b.getAttribute('data-edit-box-text') };
  });
  console.log(`[BUG4] committed box0=${JSON.stringify(box0)}`);
  await shot('bug4-box-committed.png');

  // Now press-and-HOLD on the box and drag with multiple real pointer steps.
  const drag = async (dx, dy) => {
    const b = await win.evaluate(() => {
      const el = document.querySelector('.edit-box');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    if (!b) return null;
    const sx = b.x + b.w / 2, sy = b.y + (b.h > 30 ? 20 : b.h / 2);
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    await win.waitForTimeout(120);
    // Multiple real pointermove steps (10 moves) so the app's pointermove fires.
    const steps = 10;
    let midRect = null;
    for (let i = 1; i <= steps; i++) {
      await win.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
      await win.waitForTimeout(40);
      if (i === 6) {
        midRect = await win.evaluate(() => {
          const el = document.querySelector('.edit-box');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
        await shot('bug4-box-middrag.png');
      }
    }
    await win.mouse.up();
    await win.waitForTimeout(300);
    const afterRect = await win.evaluate(() => {
      const el = document.querySelector('.edit-box');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { midRect, afterRect };
  };

  const dragResult = await drag(140, 90);
  console.log(`[BUG4] drag result midRect=${JSON.stringify(dragResult.midRect)} afterRect=${JSON.stringify(dragResult.afterRect)}`);
  await shot('bug4-box-after-drag.png');

  // Now single-click the placed box once — does a toolbar/editor appear?
  const clickBox = await win.evaluate(() => {
    const el = document.querySelector('.edit-box');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  if (clickBox) {
    await win.mouse.click(clickBox.x + clickBox.w / 2, clickBox.y + 20);
    await win.waitForTimeout(800);
  }
  const afterClick = await win.evaluate(() => {
    return {
      toolbar: !!document.querySelector('[data-edit-box-toolbar]'),
      toolbarActions: [...document.querySelectorAll('[data-edit-box-action]')].map((e) => e.getAttribute('data-edit-box-action')),
      inlineEditor: !!document.querySelector('[data-edit-editor="box"]'),
      selected: !!document.querySelector('.edit-box-selected'),
      textareaValue: document.querySelector('[data-edit-textarea]')?.value ?? null,
    };
  });
  console.log(`[BUG4] after single-click state=${JSON.stringify(afterClick)}`);
  await shot('bug4-box-after-click.png');

  console.log(`[BUG4] pageErrors=${JSON.stringify(pageErrors)}`);
});
