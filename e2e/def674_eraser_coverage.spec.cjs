// DEF-674 (recurrence of TFL-1405) — focused regression for the edit-text RUN
// move Confirm: the white eraser cover over the OLD position must use the full
// `runCoverRect` geometry (height = rawRect.height * (1 + RUN_COVER_DESCENT)) for
// the whole commit window, NOT the raw pdf.js cover rect. Pre-fix the commit
// branch returned `{ ...pendingRunEdit.coverRect }`, shrinking the cover by 20%
// and exposing glyph descenders at the old position for the commit window.
//
// Oracle: capture the eraser element's rendered height while the move is pending
// (pre-commit path, which always used `runCoverRect`) and again during the
// commit window. Fixed code -> equal heights; pre-fix commit height -> 0.8x.
// An independent canvas/pixel check proves the old rect is white after settle.
//
// Run: npm.cmd run test:e2e -- e2e/def674_eraser_coverage.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test.setTimeout(300000);

let app = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  pageErrors = [];
  win.on('pageerror', (err) => {
    pageErrors.push(err && err.message ? err.message : String(err));
    process.stdout.write(`[PAGEERROR] ${err && err.message ? err.message : String(err)}\n`);
  });
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def674');
  app = null;
  win = null;
});

async function armEditTool(tool) {
  await gotoStage(win, 2);
  const verb = win.locator(`[data-action-dock] [data-dock-verb="${tool}"]`).first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  const layerTool = { editText: 'text', editTextBox: 'box', editImage: 'image' }[tool];
  if (layerTool) {
    await win.waitForFunction(
      (t) => document.querySelector(`.edit-layer[data-tool="${t}"]`) !== null,
      layerTool,
      { timeout: 8000 },
    );
  }
}

async function findRunSpan() {
  return win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  });
}

async function dragMouse(from, to, steps = 14) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(to.x, to.y, { steps });
  await win.mouse.up();
}

async function boxBox(sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, sel);
}

async function installEraserSampler(ms, namedRects = {}) {
  return win.evaluate(({ dur, rects }) => {
    window.__def674 = { frames: [], start: performance.now(), dur };
    const bb = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.y + r.height };
    };
    const grab = (sel) => {
      const el = document.querySelector(sel);
      return el ? bb(el) : null;
    };
    const canvas = document.querySelector('.page-slot[data-page="1"] canvas');
    const darkAt = (r) => {
      if (!canvas || canvas.width === 0 || !r) return null;
      const cr = canvas.getBoundingClientRect();
      const kx = canvas.width / cr.width;
      const ky = canvas.height / cr.height;
      const x0 = Math.max(0, Math.round((r.x - cr.x) * kx));
      const y0 = Math.max(0, Math.round((r.y - cr.y) * ky));
      const w = Math.max(1, Math.min(canvas.width - x0, Math.round(r.w * kx)));
      const h = Math.max(1, Math.min(canvas.height - y0, Math.round(r.h * ky)));
      const d = canvas.getContext('2d').getImageData(x0, y0, w, h).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) dark += 1;
      }
      return dark;
    };
    const tick = () => {
      const t = performance.now() - window.__def674.start;
      const dark = {};
      for (const k of Object.keys(rects)) dark[k] = darkAt(rects[k]);
      window.__def674.frames.push({
        t: Math.round(t),
        eraser: grab('[data-edit-box-eraser]'),
        preview: grab('[data-edit-run-preview]'),
        dark,
      });
      if (t < window.__def674.dur) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { dur: ms, rects: namedRects });
}

async function readEraserSampler() {
  return win.evaluate(() => window.__def674);
}

function darkFractionFromPng(buffer) {
  const png = PNG.sync.read(buffer);
  let dark = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const lum = png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114;
    if (lum < 200) dark += 1;
  }
  return { dark, total, fraction: total > 0 ? dark / total : 1 };
}
// ---------------------------------------------------------------------------
// 1. FOCUSED regression — run-move Confirm eraser covers the OLD rect with the
//    full runCoverRect height (descender band included) for the commit window.
// ---------------------------------------------------------------------------
test('1. DEF-674: commit-window eraser keeps the full runCoverRect height at the OLD rect', async () => {
  await armEditTool('editText');
  const run = await findRunSpan();
  expect(run, 'a page-1 text run is present').not.toBeNull();
  const rawSpanH = run.h;
  const oldVp = { x: run.x, y: run.y, w: run.w, h: run.h };

  await win.mouse.click(run.cx, run.cy);
  await win.locator('[data-textrun-selection]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.waitForTimeout(300);

  const inPlaceEraser = await boxBox('[data-edit-box-eraser]');
  expect(inPlaceEraser, 'the eraser is mounted once a run is selected').not.toBeNull();

  const dx = 90;
  const dy = 70;
  await dragMouse({ x: run.cx, y: run.cy }, { x: run.cx + dx, y: run.cy + dy }, 14);
  await win.waitForTimeout(450);

  const confirm = win.locator('[data-content-action="textrun-confirm"]').first();
  await confirm.waitFor({ state: 'visible', timeout: 8000 });
  expect(await confirm.getAttribute('title'), 'the bar now confirms a MOVE').toBe('Confirm the move');

  const preCommitEraser = await boxBox('[data-edit-box-eraser]');
  expect(preCommitEraser, 'the pending-move eraser masks the OLD rect').not.toBeNull();
  expect(Math.abs(preCommitEraser.cx - inPlaceEraser.cx), 'pending eraser at the OLD run x').toBeLessThanOrEqual(2);
  expect(Math.abs(preCommitEraser.cy - inPlaceEraser.cy), 'pending eraser at the OLD run y').toBeLessThanOrEqual(2);

  const selBox = await boxBox('[data-textrun-selection]');
  const newC = { cx: selBox.cx, cy: selBox.cy };
  expect(Math.abs(newC.cx - preCommitEraser.cx) > 20 || Math.abs(newC.cy - preCommitEraser.cy) > 20, 'the drag actually moved the run').toBe(true);

  await win.screenshot({ path: path.join(SHOTS, 'def674-before-confirm.png') });

  const clipOld = {
    x: Math.max(0, Math.round(preCommitEraser.x)),
    y: Math.max(0, Math.round(preCommitEraser.y)),
    width: Math.max(1, Math.round(preCommitEraser.w)),
    height: Math.max(1, Math.round(preCommitEraser.h)),
  };

  await installEraserSampler(1600, { old: oldVp });
  await confirm.click();
  const duringBuf = await win.screenshot({ clip: clipOld }).catch(() => null);
  await win.waitForTimeout(1900);
  const s = await readEraserSampler();

  const commitFrames = s.frames.filter((f) => f.eraser !== null);
  const commitHeights = commitFrames.map((f) => f.eraser.h);
  const commitEraserH = commitHeights.length ? Math.max(...commitHeights) : null;
  const firstCommit = commitFrames[0] || null;

  fs.writeFileSync(
    path.join(SHOTS, 'def674-run-move-frames.json'),
    JSON.stringify({ rawSpanH, inPlaceEraser, preCommitEraser, commitEraserH, newC, sample: s.frames.slice(0, 40) }, null, 2),
  );
  console.log(`[DEF-674 #1] rawSpanH=${rawSpanH} inPlaceH=${inPlaceEraser.h} preCommitH=${preCommitEraser.h} commitH=${commitEraserH} frames=${s.frames.length}`);

  expect(firstCommit, 'the eraser is mounted through the commit window').not.toBeNull();
  expect(Math.abs(firstCommit.eraser.x - preCommitEraser.x), 'commit eraser at the OLD x').toBeLessThanOrEqual(2);
  expect(Math.abs(firstCommit.eraser.y - preCommitEraser.y), 'commit eraser at the OLD y').toBeLessThanOrEqual(2);
  expect(Math.abs(firstCommit.eraser.w - preCommitEraser.w), 'commit eraser keeps the OLD width').toBeLessThanOrEqual(2);

  expect(commitEraserH, 'the commit eraser height is captured').not.toBeNull();
  const heightDelta = Math.abs(commitEraserH - preCommitEraser.h);
  console.log(`[DEF-674 #1] height preCommit=${preCommitEraser.h} commit=${commitEraserH} delta=${heightDelta} ratioVsRaw=${(commitEraserH / rawSpanH).toFixed(3)}`);
  expect(heightDelta, `commit eraser height must equal runCoverRect output (pre=${preCommitEraser.h}, commit=${commitEraserH})`).toBeLessThanOrEqual(1.5);
  expect(commitEraserH, `commit eraser taller than the raw run rect (rawSpanH=${rawSpanH}, commitH=${commitEraserH})`).toBeGreaterThan(rawSpanH * 1.08);

  const preBottom = preCommitEraser.y + preCommitEraser.h;
  expect(firstCommit.eraser.bottom, 'commit eraser reaches at least the pre-commit cover bottom').toBeGreaterThanOrEqual(preBottom - 1.5);

  await win.screenshot({ path: path.join(SHOTS, 'def674-after-confirm.png') });

  if (duringBuf) {
    const duringDark = darkFractionFromPng(duringBuf);
    fs.writeFileSync(path.join(SHOTS, 'def674-during-confirm-oldrect.png'), duringBuf);
    console.log(`[DEF-674 #1] during-window OLD-rect darkFraction=${duringDark.fraction.toFixed(4)}`);
    expect(duringDark.fraction, 'the OLD rect is white during the commit window (no descenders)').toBeLessThan(0.02);
  }
  const afterBuf = await win.screenshot({ clip: clipOld });
  const afterDark = darkFractionFromPng(afterBuf);
  console.log(`[DEF-674 #1] after-settle OLD-rect darkFraction=${afterDark.fraction.toFixed(4)}`);
  expect(afterDark.fraction, 'the OLD rect is white after settle').toBeLessThan(0.02);

  expect(pageErrors, 'no renderer page errors during the move commit').toEqual([]);
});
// ---------------------------------------------------------------------------
// 2. WIDESPREAD AUDIT — text-BOX move + Confirm: no ghost at the old position.
// ---------------------------------------------------------------------------
async function typeIntoTextPanel(marker) {
  const f = win.locator('[data-txt-text]').first();
  await f.waitFor({ state: 'visible', timeout: 12000 });
  await f.click();
  await f.fill(marker);
  await win.waitForTimeout(400);
}

async function drawBox() {
  const pr = await win.evaluate(() => {
    const el = document.querySelector('.page-slot[data-page="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const x0 = pr.x + pr.w * 0.30;
  const y0 = pr.y + pr.h * 0.42;
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move(x0 + Math.min(260, pr.w * 0.45), y0 + 80, { steps: 15 });
  await win.mouse.up();
  await win.waitForTimeout(600);
}

test('2. WIDESPREAD: text-box move + Confirm leaves no ghost at the old box position', async () => {
  await armEditTool('editTextBox');
  await drawBox();
  await typeIntoTextPanel('DEF674 BOX MOVE');
  const commit = win.locator('[data-edit-box-action="confirm"]').first();
  await commit.waitFor({ state: 'visible', timeout: 8000 });
  await commit.click();
  await win.waitForTimeout(1500);

  const committedBox = await boxBox('.edit-box');
  expect(committedBox, 'the committed box is present').not.toBeNull();
  const oldC = { cx: committedBox.cx, cy: committedBox.cy };

  await dragMouse({ x: committedBox.cx, y: committedBox.cy }, { x: committedBox.cx + 100, y: committedBox.cy + 80 }, 14);
  await win.waitForTimeout(500);
  const moveConfirm = win.locator('[data-edit-box-action="confirm"]').first();
  await moveConfirm.waitFor({ state: 'visible', timeout: 8000 });
  const pendingBox = await boxBox('.edit-box');
  const newC = { cx: pendingBox.cx, cy: pendingBox.cy };
  expect(Math.abs(newC.cx - oldC.cx) > 20 || Math.abs(newC.cy - oldC.cy) > 20, 'the box actually moved').toBe(true);

  const preEraser = await boxBox('[data-edit-box-eraser]');
  expect(preEraser, 'the pending box-move eraser masks the OLD rect').not.toBeNull();

  await installEraserSampler(1400);
  await moveConfirm.click();
  await win.waitForTimeout(1700);
  const s = await readEraserSampler();

  const boxNow = await boxBox('.edit-box');
  const boxAtOldNow = boxNow !== null && Math.abs(boxNow.cx - oldC.cx) <= 12 && Math.abs(boxNow.cy - oldC.cy) <= 12;
  const preEraserCenter = { cx: preEraser.x + preEraser.w / 2, cy: preEraser.y + preEraser.h / 2 };
  const distTo = (b, c) => (b === null ? null : Math.hypot(b.x + b.w / 2 - c.cx, b.y + b.h / 2 - c.cy));
  const eraserFrames = s.frames.filter((f) => f.eraser !== null);
  const minDistToPreEraser = eraserFrames.length ? Math.min(...eraserFrames.map((f) => distTo(f.eraser, preEraserCenter))) : null;
  const minDistToOldC = eraserFrames.length ? Math.min(...eraserFrames.map((f) => distTo(f.eraser, oldC))) : null;
  const eraserAtPreEver = minDistToPreEraser !== null && minDistToPreEraser <= 2;
  fs.writeFileSync(
    path.join(SHOTS, 'def674-box-move-frames.json'),
    JSON.stringify({ oldC, newC, preEraser, preEraserCenter, minDistToPreEraser, minDistToOldC, boxAtOldNow, sample: s.frames.slice(0, 40) }, null, 2),
  );
  console.log(`[DEF-674 #2] box oldC=${JSON.stringify(oldC)} newC=${JSON.stringify(newC)} preEraserCenter=${JSON.stringify(preEraserCenter)} eraserFrames=${eraserFrames.length} minDistToPreEraser=${minDistToPreEraser} minDistToOldC=${minDistToOldC} boxAtOldNow=${boxAtOldNow}`);

  expect(eraserFrames.length, 'the eraser is mounted through the box-move commit window').toBeGreaterThan(0);
  expect(eraserAtPreEver, 'the commit eraser stays at the pre-commit (OLD) box position').toBe(true);
  expect(boxAtOldNow, 'the box is never left painted at the OLD rect').toBe(false);
  expect(pageErrors, 'no renderer page errors during the box move').toEqual([]);
});

// ---------------------------------------------------------------------------
// 3. WIDESPREAD AUDIT — IMAGE move commit: no ghost at the old placement.
// ---------------------------------------------------------------------------
test('3. WIDESPREAD: image move commit leaves no ghost at the old placement', async () => {
  await armEditTool('editImage');
  const pr = await win.evaluate(() => {
    const el = document.querySelector('.page-slot[data-page="1"]');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const x0 = pr.x + pr.w * 0.32;
  const y0 = pr.y + pr.h * 0.30;
  const fcPromise = win.waitForEvent('filechooser');
  await dragMouse({ x: x0, y: y0 }, { x: x0 + 180, y: y0 + 90 }, 14);
  const fc = await fcPromise;
  await fc.setFiles(path.resolve(__dirname, '..', 'test-fixtures', 'red.png'));
  await win.waitForSelector('.edit-image-placement', { timeout: 10000 });
  await win.waitForTimeout(1800);

  const imgBox = await boxBox('.edit-image-placement');
  expect(imgBox, 'the image placement is present').not.toBeNull();
  const oldC = { cx: imgBox.cx, cy: imgBox.cy };

  await win.mouse.move(imgBox.cx, imgBox.cy);
  await win.mouse.down();
  await win.mouse.move(imgBox.cx + 70, imgBox.cy + 60, { steps: 14 });
  await win.mouse.up();
  await win.waitForTimeout(1700);

  const newBox = await boxBox('.edit-image-placement');
  const atOld = newBox !== null && Math.abs(newBox.cx - oldC.cx) <= 12 && Math.abs(newBox.cy - oldC.cy) <= 12;
  console.log(`[DEF-674 #3] image oldC=${JSON.stringify(oldC)} newC=${newBox ? JSON.stringify({ cx: newBox.cx, cy: newBox.cy }) : null} atOld=${atOld}`);
  expect(newBox, 'the image placement survives the move commit').not.toBeNull();
  expect(atOld, 'the image placement is never left at the OLD rect').toBe(false);
  expect(pageErrors, 'no renderer page errors during the image move').toEqual([]);
});
