// PORT of gt_crop_thumb_1717.spec.cjs (retired one-off, 2026-09-05 cleanup)
// - the only spec that asserted the thumbnail-rail geometry contract after a
// per-page crop, which is still a live contract:
//   crop page 1 to a square box -> pages 2/3/4 thumbnails must keep the FULL
//   page aspect (~0.773) and must NOT be clipped/shrunk to the crop box.
// Selectors are current-model (.thumb-item / .thumb-canvas-wrap /
// .thumb-canvas, [data-crop-*] dialog). Dev build via the canonical launcher.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FULL_ASPECT = 612 / 792; // 0.7727

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp();
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
        wrap: wrapR,
        canvas: canvasR,
        wrapAspect: wrapR ? +(wrapR.w / wrapR.h).toFixed(4) : null,
        // If the canvas CSS box is larger than the wrap in either dimension
        // the bitmap is being clipped by overflow:hidden.
        clipped: wrapR && canvasR ? (canvasR.w > wrapR.w + 0.5 || canvasR.h > wrapR.h + 0.5) : null,
      });
    }
    return out;
  }, n);
}

test('PORT BUG1: crop page 1 -> thumbnail rail pages 2/3/4 stay FULL page, not clipped to the crop box', async () => {
  test.setTimeout(240000);
  await openSampleFromCard('report.pdf');

  await win.waitForSelector('.thumb-item[data-page="4"]', { timeout: 15000 });
  const base = await thumbGeom(4);
  console.log(`[PORT|BASELINE-THUMBS] ${JSON.stringify(base)}`);

  // Crop page 1 to a distinctive centered 200x200 box.
  const finalCrop = await cropPage1To(206, 296, 200, 200);
  console.log(`[PORT|CROP] crop box=${JSON.stringify(finalCrop)}`);

  const after = await thumbGeom(4);
  console.log(`[PORT|AFTER-THUMBS] ${JSON.stringify(after)}`);
  await shot('crop-thumbs-port-after-crop.png');

  const p1 = after[0], p2 = after[1], p3 = after[2], p4 = after[3];
  console.log(`[PORT|VERDICT] after crop: p1=${p1.wrapAspect} p2=${p2.wrapAspect} p3=${p3.wrapAspect} p4=${p4.wrapAspect} clipped p2=${p2.clipped} p3=${p3.clipped} p4=${p4.clipped}`);

  const pages234AspectMatchFull = [p2.wrapAspect, p3.wrapAspect, p4.wrapAspect].every((a) => a !== null && Math.abs(a - FULL_ASPECT) < 0.06);
  const pages234NotClipped = [p2, p3, p4].every((p) => p.clipped === false);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
  expect(pages234AspectMatchFull, 'pages 2/3/4 thumbnail wrap must keep the FULL page aspect (~0.773), not the crop box aspect').toBe(true);
  expect(pages234NotClipped, 'pages 2/3/4 thumbnails must not be clipped/shrunk to the crop box').toBe(true);
});
