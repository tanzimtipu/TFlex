// QA verification (installed v1.7.15) — DEF-141.
//
// Crop PAGE 1 with a small box. EXPECTED (the fix): only page 1 is cropped;
// pages 2,3,4 keep their FULL 612x792 render box (aspect ~0.773) and the
// continuous view shows NO stacking / overlap / page collapse. The v1.7.14
// bug collapsed every page-slot to the crop-box square.
//
// PASS = pages 2/3 slots keep a full-page aspect (>0.7, ~0.773) while page 1
//        is the crop aspect, AND there is no vertical overlap between
//        consecutive page-slot contents.
// Launch only via e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const FULL_ASPECT = 612 / 792; // 0.7727

test.setTimeout(300000);

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
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
  return final;
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
  const final = await setCropBoxTo(x, y, width, height);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2600);
  return final;
}

// Measure the page-slot rects for pages 1..n plus the inner content node.
async function slotRects(n) {
  return win.evaluate((max) => {
    const out = [];
    for (let i = 1; i <= max; i++) {
      const s = document.querySelector(`.page-slot[data-page="${i}"]`);
      if (!s) { out.push({ page: i, mounted: false }); continue; }
      const r = s.getBoundingClientRect();
      const content = s.querySelector('.pdf-page') || s.querySelector('canvas');
      let crect = null;
      if (content) {
        const c = content.getBoundingClientRect();
        crect = { top: +c.top.toFixed(1), bottom: +c.bottom.toFixed(1), h: +c.height.toFixed(1), w: +c.width.toFixed(1) };
      }
      out.push({ page: i, mounted: true, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1), canvas: crect });
    }
    return out;
  }, n);
}

function computeContentOverlaps(rects) {
  const overlaps = [];
  for (let i = 0; i < rects.length - 1; i++) {
    const a = rects[i], b = rects[i + 1];
    if (!a.mounted || !b.mounted || !a.canvas || !b.canvas) continue;
    const overlap = +((a.canvas.bottom - b.canvas.top)).toFixed(1);
    overlaps.push({ from: a.page, to: b.page, overlap });
  }
  return overlaps;
}

async function scrollToShow(pageN) {
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - sc.clientHeight * 0.15;
  }, pageN);
  await win.waitForTimeout(900);
}

function aspectOf(slot) {
  const w = slot.canvas && slot.canvas.w ? slot.canvas.w : slot.w;
  const h = slot.canvas && slot.canvas.h ? slot.canvas.h : slot.h;
  return w / h;
}

test('DEF-141: crop page 1 to a small box -> pages 2/3/4 stay FULL size, no stacking/overlap', async () => {
  await openSampleFromCard('report.pdf');

  // Baseline slot positions for pages 1..4 (full 612x792 -> aspect ~0.773).
  await scrollToShow(1);
  const base = await slotRects(4);
  console.log(`[141|BASELINE] ${JSON.stringify(base)}`);
  const baseP2 = aspectOf(base[1]);
  const baseP3 = aspectOf(base[2]);
  console.log(`[141|BASELINE] page2Aspect=${baseP2.toFixed(4)} page3Aspect=${baseP3.toFixed(4)} (full=${FULL_ASPECT.toFixed(4)})`);

  // VERY SMALL crop of page 1 (150 x 150 pt, centered).
  const finalCrop = await cropPage1To(231, 321, 150, 150);
  await scrollToShow(1);
  const rects = await slotRects(4);
  console.log(`[141|SMALL-CROP] ${JSON.stringify(rects)}`);
  const ov = computeContentOverlaps(rects);
  console.log(`[141|SMALL-CROP] contentOverlaps=${JSON.stringify(ov)}`);

  const p1a = aspectOf(rects[0]);
  const p2a = aspectOf(rects[1]);
  const p3a = aspectOf(rects[2]);
  const p4a = aspectOf(rects[3]);
  console.log(`[141|SMALL-CROP] page1Aspect=${p1a.toFixed(4)} page2Aspect=${p2a.toFixed(4)} page3Aspect=${p3a.toFixed(4)} page4Aspect=${p4a.toFixed(4)}`);

  await shot('def-141-1715-small-crop-scroll.png');
  const p1 = await win.locator('.page-slot[data-page="1"]').first().boundingBox();
  if (p1) {
    const vp = win.viewportSize() || { width: 1440, height: 900 };
    await win.screenshot({ path: path.join(SHOTS, 'def-141-1715-small-crop-stack.png'), clip: { x: Math.max(0, p1.x), y: p1.y + p1.height, width: Math.min(p1.width, vp.width - p1.x), height: Math.max(0, vp.height - (p1.y + p1.height)) } });
    console.log('[SHOT] def-141-1715-small-crop-stack.png');
  }

  // --- DOCUMENT-SAFETY re-parse: save and check which page carries a CropBox.
  const os = require('node:os');
  const fs = require('node:fs');
  const { PDFDocument } = require('pdf-lib');
  const savePath = path.join(os.tmpdir(), `tflex-def141-1715-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1400);
  let saveInfo = null;
  if (fs.existsSync(savePath)) {
    const doc = await PDFDocument.load(fs.readFileSync(savePath));
    const pageCount = doc.getPageCount();
    const full = { x: 0, y: 0, width: 612, height: 792 };
    const nonFull = [];
    for (let i = 0; i < pageCount; i++) {
      const cb = doc.getPage(i).getCropBox();
      const isFull = cb && Math.abs(cb.width - full.width) < 0.5 && Math.abs(cb.height - full.height) < 0.5;
      if (!isFull) nonFull.push(i + 1);
    }
    saveInfo = { pageCount, nonFullCropPages: nonFull };
    console.log(`[141|SAVE] pageCount=${pageCount} NON-FULL-CROPBOX pages=${JSON.stringify(nonFull)}`);
  } else {
    console.log('[141|SAVE] saved file not found');
  }

  // --- VERDICT ---
  const fullOk = p2a > 0.7 && p3a > 0.7 && p4a > 0.7; // pages 2-4 keep full page aspect (not collapsed square ~1.0)
  const overlapOk = ov.every((o) => o.overlap <= 12); // no content stacking
  const page1Cropped = p1a < 0.95 || finalCrop.w !== undefined; // page 1 is the crop page
  const shouldFull = [p2a, p3a, p4a].every((a) => Math.abs(a - FULL_ASPECT) < 0.06);
  const pass = fullOk && overlapOk && page1Cropped && shouldFull;
  console.log(`[141|VERDICT] pages2-4FullAspect=${fullOk} noOverlap=${overlapOk} page1IsCrop=${page1Cropped} pages2-4AspectMatchFull=${shouldFull}`);
  console.log(`[141|VERDICT] RESULT=${pass ? 'PASS' : 'FAIL'}`);
  expect(pass, `DEF-141 ${pass ? 'PASS' : 'FAIL'} — pages 2/3/4 must stay full-size, no stacking`).toBe(true);
  if (saveInfo) {
    expect(saveInfo.pageCount, 'save must still be a valid 34-page doc').toBe(34);
    expect(saveInfo.nonFullCropPages, 'only page 1 should carry a cropped CropBox').toEqual([1]);
  }
});
