// QA ground-truth reproduction (installed v1.7.17) — BUG 1.
//
// Crop page 1 with a distinctive 200x200 box (Per page). The operator says
// the LEFT THUMBNAIL RAIL renders ALL thumbnails (pages 2,3,4 — uncropped)
// as clipped/shrunk to the crop box too, even though the actual pages aren't
// cropped. The main view (DEF-141) was fixed; the thumbnails may carry a
// SEPARATE stale-geometry bug.
//
// What we measure (VISUAL + geometry, not just arrays):
//   - `.thumb-item[data-page=N]` button rect
//   - `.thumb-item[data-page=N] .thumb-canvas-wrap` rect (the CSS box)
//   - `.thumb-item[data-page=N] .thumb-canvas` rect (the rendered bitmap)
//   - wrap aspect (w/h). A full 612x792 page thumb should be ~0.773. If the
//     wrap is ~1.0 (square) for pages 2/3/4 after a page-1 crop, the rail
//     is using the cropped page-1 aspect for every thumb (the bug).
//   - whether the canvas is LARGER than its wrap (clipped) — overflow:hidden.
// Also screenshot the rail after the crop and check the main view pages 2-4.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FULL_ASPECT = 612 / 792; // 0.7727

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
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
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

// Measure the thumbnail geometry for pages 1..n.
async function thumbGeom(n) {
  return win.evaluate((max) => {
    const out = [];
    for (let i = 1; i <= max; i++) {
      const t = document.querySelector(`.thumb-item[data-page="${i}"]`);
      if (!t) { out.push({ page: i, mounted: false }); continue; }
      const wrap = t.querySelector('.thumb-canvas-wrap');
      const canvas = t.querySelector('.thumb-canvas');
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const wrapR = r(wrap);
      const canvasR = r(canvas);
      out.push({
        page: i,
        mounted: true,
        thumb: r(t),
        wrap: wrapR,
        canvas: canvasR,
        wrapAspect: wrapR ? +(wrapR.w / wrapR.h).toFixed(4) : null,
        canvasAspect: canvasR ? +(canvasR.w / canvasR.h).toFixed(4) : null,
        // If the canvas CSS box is larger than the wrap in either dimension
        // the bitmap is being clipped by overflow:hidden.
        clipped: wrapR && canvasR ? (canvasR.w > wrapR.w + 0.5 || canvasR.h > wrapR.h + 0.5) : null,
        // Backing buffer dims (actual rendered pixels).
        canvasBufferW: canvas ? canvas.width : null,
        canvasBufferH: canvas ? canvas.height : null,
      });
    }
    return out;
  }, n);
}

// Measure the main-view page-slot content geometry for pages 1..n.
async function mainViewGeom(n) {
  return win.evaluate((max) => {
    const out = [];
    for (let i = 1; i <= max; i++) {
      const s = document.querySelector(`.page-slot[data-page="${i}"]`);
      if (!s) { out.push({ page: i, mounted: false }); continue; }
      const content = s.querySelector('.pdf-page') || s.querySelector('canvas');
      let crect = null;
      if (content) {
        const c = content.getBoundingClientRect();
        crect = { w: +c.width.toFixed(1), h: +c.height.toFixed(1), aspect: +(c.width / c.height).toFixed(4) };
      }
      out.push({ page: i, mounted: true, main: crect });
    }
    return out;
  }, n);
}

async function scrollToShow(pageN) {
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - sc.clientHeight * 0.15;
  }, pageN);
  await win.waitForTimeout(900);
}

test('BUG1: crop page 1 to 200x200 -> thumbnail rail (pages 2/3/4) must stay FULL page, not clipped to the crop box', async () => {
  await openSampleFromCard('report.pdf');

  // Baseline thumbnails for pages 1..4 (full 612x792 -> wrap aspect ~0.773).
  await win.waitForSelector('.thumb-item[data-page="4"]', { timeout: 15000 });
  const base = await thumbGeom(4);
  console.log(`[BUG1|BASELINE-THUMBS] ${JSON.stringify(base)}`);
  const baseP2WrapAspect = base[1].wrapAspect;
  const baseP3WrapAspect = base[2].wrapAspect;
  console.log(`[BUG1|BASELINE] page2WrapAspect=${baseP2WrapAspect} page3WrapAspect=${baseP3WrapAspect} (full=${FULL_ASPECT.toFixed(4)})`);

  // Baseline main view for pages 1..4.
  await scrollToShow(1);
  const baseMain = await mainViewGeom(4);
  console.log(`[BUG1|BASELINE-MAIN] ${JSON.stringify(baseMain)}`);

  // Crop page 1 to 200x200 (distinctive, centered).
  const finalCrop = await cropPage1To(206, 296, 200, 200);
  console.log(`[BUG1|CROP] crop box=${JSON.stringify(finalCrop)}`);

  // Inspect the thumbnail rail AFTER the crop.
  const after = await thumbGeom(4);
  console.log(`[BUG1|AFTER-THUMBS] ${JSON.stringify(after)}`);
  await shot('gt-bug1-1717-rail-after-crop.png');

  // Crop a region around the rail to inspect the thumbnails closely.
  const railBox = await win.locator('.side-rail').first().boundingBox();
  if (railBox) {
    await win.screenshot({
      path: path.join(SHOTS, 'gt-bug1-1717-rail-close.png'),
      clip: { x: railBox.x, y: railBox.y, width: Math.min(railBox.width, 260), height: Math.min(railBox.height, 700) },
    });
    console.log('[SHOT] gt-bug1-1717-rail-close.png');
  }

  // Inspect the main view AFTER the crop (pages 1..4).
  await scrollToShow(1);
  const afterMain = await mainViewGeom(4);
  console.log(`[BUG1|AFTER-MAIN] ${JSON.stringify(afterMain)}`);
  await shot('gt-bug1-1717-main-after-crop.png');

  // --- VERDICT -----------------------------------------------------------
  // Page 1 thumb should be the CROP aspect (~1.0). Pages 2/3/4 thumbs must
  // keep the FULL aspect (~0.773) AND not be clipped (canvas not larger
  // than the wrap). If pages 2/3/4 wraps are ~1.0 (square), that is the
  // operator's "all thumbnails look cropped" bug.
  const p1 = after[0], p2 = after[1], p3 = after[2], p4 = after[3];
  const p1Aspect = p1.wrapAspect;
  const p2Aspect = p2.wrapAspect;
  const p3Aspect = p3.wrapAspect;
  const p4Aspect = p4.wrapAspect;
  console.log(`[BUG1|VERDICT] after crop: p1Aspect=${p1Aspect} p2Aspect=${p2Aspect} p3Aspect=${p3Aspect} p4Aspect=${p4Aspect}`);
  console.log(`[BUG1|VERDICT] pages2-4 wrap clipped? p2=${p2.clipped} p3=${p3.clipped} p4=${p4.clipped}`);

  const pages234AspectMatchFull = [p2Aspect, p3Aspect, p4Aspect].every((a) => a !== null && Math.abs(a - FULL_ASPECT) < 0.06);
  const pages234NotClipped = [p2, p3, p4].every((p) => p.clipped === false);
  console.log(`[BUG1|VERDICT] pages2-4AspectMatchFull=${pages234AspectMatchFull} pages2-4NotClipped=${pages234NotClipped}`);
  console.log(`[BUG1|VERDICT] RESULT=${pages234AspectMatchFull && pages234NotClipped ? 'PASS' : 'FAIL (BUG REPRODUCED)'}`);

  // Main view: pages 2/3/4 must stay full aspect (~0.773).
  const m2 = afterMain[1] && afterMain[1].main ? afterMain[1].main.aspect : null;
  const m3 = afterMain[2] && afterMain[2].main ? afterMain[2].main.aspect : null;
  const m4 = afterMain[3] && afterMain[3].main ? afterMain[3].main.aspect : null;
  console.log(`[BUG1|VERDICT] MAIN pages2/3/4 aspect=${m2}/${m3}/${m4}`);
  const mainFull = [m2, m3, m4].every((a) => a !== null && Math.abs(a - FULL_ASPECT) < 0.06);
  console.log(`[BUG1|VERDICT] MAIN pages2-4FullAspect=${mainFull}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[BUG1] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  // Assert the bug: pages 2/3/4 thumbnails must keep full aspect and not be clipped.
  expect(pages234AspectMatchFull, 'pages 2/3/4 thumbnail wrap must keep the FULL page aspect (~0.773), not the crop box aspect').toBe(true);
  expect(pages234NotClipped, 'pages 2/3/4 thumbnails must not be clipped/shrunk to the crop box').toBe(true);

  // Report main view status (not an assertion, for the table).
  console.log(`[BUG1|MAIN-VIEW] pages2-4Full=${mainFull}`);
});
