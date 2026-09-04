// QA ground-truth reproduction (installed v1.7.14) — item 2.
//
// Crop PAGE 1 with a small box, then scroll the continuous view and VISUALLY
// check whether pages 2,3,4 OVERLAP / stack on top of each other. Compare a
// very small crop (150x150) against a medium crop (300x400).
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

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

// Set the crop box on the editor page to (x,y,w,h) in page points (612x792).
async function setCropBoxTo(x, y, width, height) {
  const info = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    if (!page || !mask || !se) return null;
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return { pageW: pr.width, pageLeft: pr.x, pageTop: pr.y, maskLeft: mr.x, maskTop: mr.y, maskW: mr.width, maskH: mr.height, seX: sr.x + sr.width / 2, seY: sr.y + sr.height / 2 };
  });
  if (!info) throw new Error('crop editor not mounted');
  const scale = info.pageW / 612;

  const curBoxX = (info.maskLeft - info.pageLeft) / scale;
  const curBoxY = (info.maskTop - info.pageTop) / scale;
  const moveMx = info.maskLeft + info.maskW / 2;
  const moveMy = info.maskTop + info.maskH / 2;
  await win.mouse.move(moveMx, moveMy);
  await win.mouse.down();
  await win.mouse.move(moveMx + (x - curBoxX) * scale, moveMy + (y - curBoxY) * scale, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);

  const rel2 = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return { maskW: mr.width, maskH: mr.height, seX: sr.x + sr.width / 2, seY: sr.y + sr.height / 2 };
  });
  const newCurW = rel2.maskW / scale;
  const newCurH = rel2.maskH / scale;
  const dW = (newCurW - width) * scale;
  const dH = (newCurH - height) * scale;
  await win.mouse.move(rel2.seX, rel2.seY);
  await win.mouse.down();
  await win.mouse.move(rel2.seX - dW, rel2.seY - dH, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);

  const final = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    return { x: +((mr.x - pr.x) / pr.width * 612).toFixed(1), y: +((mr.y - pr.y) / pr.height * 792).toFixed(1), w: +((mr.width / pr.width) * 612).toFixed(1), h: +((mr.height / pr.height) * 792).toFixed(1) };
  });
  console.log(`[CROPBOX] final pt=${JSON.stringify(final)}`);
}

async function cropPage1To(x, y, width, height) {
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(800);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(700);
  await win.selectOption('[data-crop-page-select]', '1');
  await win.waitForTimeout(600);
  await setCropBoxTo(x, y, width, height);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2600);
}

// Measure the page-slot rects for pages 1..n (their top/bottom in the scroller)
// and detect vertical OVERLAP between consecutive slots. Also records the inner
// canvas rect so we can detect CONTENT overflow beyond the slot (the actual
// "stacking" the operator reports).
async function slotRects(n) {
  return win.evaluate((max) => {
    const out = [];
    for (let i = 1; i <= max; i++) {
      const s = document.querySelector(`.page-slot[data-page="${i}"]`);
      if (!s) { out.push({ page: i, mounted: false }); continue; }
      const r = s.getBoundingClientRect();
      // The rendered content node is the .pdf-page wrapper or a canvas.
      const content = s.querySelector('.pdf-page') || s.querySelector('canvas');
      let crect = null;
      if (content) {
        const c = content.getBoundingClientRect();
        crect = { top: Math.round(c.top), bottom: Math.round(c.bottom), h: Math.round(c.height), w: Math.round(c.width) };
      }
      out.push({ page: i, mounted: true, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), canvas: crect });
    }
    return out;
  }, n);
}

// Measure overlap between consecutive mounted slots. Overlap > 0 means slot
// N+1's top < slot N's bottom (they overlap / stack).
function computeOverlaps(rects, useContent = false) {
  const overlaps = [];
  for (let i = 0; i < rects.length - 1; i++) {
    const a = rects[i], b = rects[i + 1];
    if (!a.mounted || !b.mounted) continue;
    const aBottom = useContent && a.canvas ? a.canvas.bottom : a.bottom;
    const bTop = useContent && b.canvas ? b.canvas.top : b.top;
    const overlap = Math.round((aBottom - bTop) * 10) / 10;
    overlaps.push({ from: a.page, to: b.page, overlap });
  }
  const maxOverlap = Math.max(0, ...overlaps.map((o) => o.overlap));
  return { overlaps, maxOverlap };
}

async function scrollToShow(pageN) {
  // Bring page N near the top of the viewport so several slots are visible.
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - sc.clientHeight * 0.15;
  }, pageN);
  await win.waitForTimeout(900);
}

test('Item 2: crop PAGE 1 to a small box -> pages below OVERLAP/stack; density vs crop size', async () => {
  await openSampleFromCard('report.pdf');

  // Baseline slot positions.
  await scrollToShow(1);
  const base = await slotRects(6);
  const baseOverlap = computeOverlaps(base);
  console.log(`[ITEM2|BASELINE] ${JSON.stringify(base)}`);
  console.log(`[ITEM2|BASELINE] maxOverlap=${baseOverlap.maxOverlap}`);

  // VERY SMALL crop of page 1 (150 x 150 pt, centered).
  await cropPage1To(231, 321, 150, 150);
  await scrollToShow(1);
  const smallRects = await slotRects(6);
  const smallOverlap = computeOverlaps(smallRects);
  const smallContentOverlap = computeOverlaps(smallRects, true);
  console.log(`[ITEM2|SMALL-CROP] ${JSON.stringify(smallRects)}`);
  console.log(`[ITEM2|SMALL-CROP] slotOverlaps=${JSON.stringify(smallOverlap.overlaps)} maxSlotOverlap=${smallOverlap.maxOverlap}`);
  console.log(`[ITEM2|SMALL-CROP] CONTENT(slot-box-cap)Overlaps=${JSON.stringify(smallContentOverlap.overlaps)} maxContentOverlap=${smallContentOverlap.maxOverlap}`);
  console.log(`[ITEM2|SMALL-CROP] slotH=${smallRects[0].h} canvasH=${smallRects[0].canvas && smallRects[0].canvas.h} page2CanvasH=${smallRects[1].canvas && smallRects[1].canvas.h} page2SlotH=${smallRects[1].h}`);
  await shot('gt-item2-small-crop-scroll.png');
  // Also clip a region showing pages 2,3,4 to inspect visually.
  const p1 = await win.locator('.page-slot[data-page="1"]').first().boundingBox();
  if (p1) {
    const vp = win.viewportSize() || { width: 1440, height: 900 };
    await win.screenshot({ path: path.join(SHOTS, 'gt-item2-small-crop-stack.png'), clip: { x: Math.max(0, p1.x), y: p1.y + p1.height, width: Math.min(p1.width, vp.width - p1.x), height: Math.max(0, vp.height - (p1.y + p1.height)) } });
    console.log('[SHOT] gt-item2-small-crop-stack.png');
  }

  // --- DOCUMENT-SAFETY re-parse: save and check which page carries a CropBox
  const os = require('node:os');
  const fs = require('node:fs');
  const { PDFDocument } = require('pdf-lib');
  const savePath = path.join(os.tmpdir(), `tflex-item2-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1400);
  if (fs.existsSync(savePath)) {
    const bytes = fs.readFileSync(savePath);
    const doc = await PDFDocument.load(bytes);
    const pageCount = doc.getPageCount();
    const cropRows = [];
    const full = { x: 0, y: 0, width: 612, height: 792 };
    for (let i = 0; i < pageCount; i++) {
      const cb = doc.getPage(i).getCropBox();
      const isFull = cb && Math.abs(cb.width - full.width) < 0.5 && Math.abs(cb.height - full.height) < 0.5;
      cropRows.push({ page: i + 1, cb: cb ? { x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height) } : null, isFullPage: !!isFull });
    }
    const nonFull = cropRows.filter((r) => !r.isFullPage).map((r) => r.page);
    console.log(`[ITEM2|SAVE] pageCount=${pageCount} NON-FULL-CROPBOX pages=${JSON.stringify(nonFull)}`);
    console.log(`[ITEM2|SAVE] page1=${JSON.stringify(cropRows[0])} page2=${JSON.stringify(cropRows[1])} page3=${JSON.stringify(cropRows[2])}`);
  } else {
    console.log('[ITEM2|SAVE] saved file not found');
  }

  // Undo the crop to get back a clean doc for the medium crop.
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);

  // MEDIUM crop of page 1 (300 x 400 pt).
  await cropPage1To(120, 120, 300, 400);
  await scrollToShow(1);
  const medRects = await slotRects(6);
  const medOverlap = computeOverlaps(medRects);
  const medContentOverlap = computeOverlaps(medRects, true);
  console.log(`[ITEM2|MED-CROP] ${JSON.stringify(medRects)}`);
  console.log(`[ITEM2|MED-CROP] overlaps=${JSON.stringify(medOverlap.overlaps)} maxOverlap=${medOverlap.maxOverlap} maxContentOverlap=${medContentOverlap.maxOverlap}`);
  console.log(`[ITEM2|MED-CROP] slotH=${medRects[0].h} canvasH=${medRects[0].canvas && medRects[0].canvas.h} page2CanvasH=${medRects[1].canvas && medRects[1].canvas.h} page2SlotH=${medRects[1].h}`);
  await shot('gt-item2-medium-crop-scroll.png');

  console.log(`[ITEM2|SUMMARY] baselineMaxSlotOverlap=${baseOverlap.maxOverlap} smallMaxSlotOverlap=${smallOverlap.maxOverlap} mediumMaxSlotOverlap=${medOverlap.maxOverlap}`);
  console.log(`[ITEM2|SUMMARY] smallMaxContentOverlap=${smallContentOverlap.maxOverlap} mediumMaxContentOverlap=${medContentOverlap.maxOverlap}`);
  console.log(`[ITEM2|SUMMARY] small crop slot box SMALLER than medium? ${smallRects[0].h < medRects[0].h}`);
});
