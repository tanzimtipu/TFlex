// CLASS SWEEP (Phase 18 pre-1.18.1 release check) - are the two bug classes
// fixed today (DEF-221 mask anchored to the wrong box; DEF-222 canvas blanked
// during a proxy rebuild) WIDESPREAD across the other edit/page tools?
//
// Measurements only - no cause guessing. One spec, one shared probe set:
//   CLASS A  white-mask anchor: for each move path measure dark pixels at the
//            OLD rect and in the band ABOVE it, leftover DOM ~1s after
//            Confirm, and whether the result survives Save As -> close -> reopen.
//   CLASS B  flash: MutationObserver on every .thumb-canvas (width/height) plus
//            an rAF sampler on the main page canvas, around every commit trigger.
//   A3       control: the intended offscreen release still happens.
//
// Clean paths are reported explicitly with their numbers - a clean negative is
// the point of the sweep.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, scrollToPage, gotoStage, toggleEditMode, openDockVerb, runTool } = require('./lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const PNG = path.resolve(__dirname, '..', 'test-fixtures', 'red.png');

test.setTimeout(600000);

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
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

// ---------------------------------------------------------------------------
// Shared probes
// ---------------------------------------------------------------------------

async function openReport() {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2400);
}

async function armEditTool(tool) {
  // Phase 36 (chunk 3) — the per-view command row is retired; Edit mode is the
  // EDIT dock's `editMode` verb.
  await toggleEditMode(win);
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(300);
  if (tool && tool !== 'off') {
    await win.click(`[data-edit-tool="${tool}"]`);
    await win.waitForTimeout(400);
  }
}

// scale + canvas viewport rect for a page slot.
async function scaleFor(pageNo) {
  return win.evaluate((pg) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return null;
    const cr = c.getBoundingClientRect();
    return { kx: c.width / cr.width, ky: c.height / cr.height, cx: cr.x, cy: cr.y, cw: cr.width, ch: cr.height, cw2: c.width, ch2: c.height };
  }, pageNo);
}

// Dark-pixel count over a fixed CANVAS-pixel rect (immune to layout shift).
async function darkAtPx(px, pageNo) {
  return win.evaluate(({ r, pg }) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    if (c.width === 0 || c.height === 0) return { error: 'zero-canvas', w: c.width, h: c.height };
    const sx = Math.max(0, Math.round(r.x));
    const sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    if (sx >= c.width || sy >= c.height) return { error: 'oob', sx, sy, cw: c.width, ch: c.height };
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let dark = 0, total = 0, nearWhite = 0;
    for (let i = 0; i < d.length; i += 4) {
      total += 1;
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (lum < 140) dark += 1;
      if (d[i] >= 245 && d[i + 1] >= 245 && d[i + 2] >= 245) nearWhite += 1;
    }
    return { dark, nearWhite, total, canvasPx: [sx, sy, sw, sh] };
  }, { r: px, pg: pageNo });
}

// Pick the on-screen page-`pg` run with the densest text bands above+below it.
async function pickDenseRun(pg) {
  return win.evaluate((pageNo) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"]`);
    if (!slot) return null;
    const c = slot.querySelector('canvas');
    if (!c || c.width === 0) return null;
    const cr = c.getBoundingClientRect();
    const kx = c.width / cr.width;
    const ky = c.height / cr.height;
    const ctx = c.getContext('2d');
    const darkIn = (x0, y0, x1, y1) => {
      const sx = Math.max(0, Math.round(x0));
      const sy = Math.max(0, Math.round(y0));
      const sw = Math.max(1, Math.min(c.width - sx, Math.round(x1 - x0)));
      const sh = Math.max(1, Math.min(c.height - sy, Math.round(y1 - y0)));
      const d = ctx.getImageData(sx, sy, sw, sh).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) dark += 1;
      return dark;
    };
    let best = null;
    for (const s of slot.querySelectorAll('.textLayer span')) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length < 15 || r.width < 40 || r.height < 4) continue;
      if (r.y < 80 || r.y > window.innerHeight - 80) continue;
      const x0 = (r.x - cr.x) * kx;
      const x1 = (r.x + r.width - cr.x) * kx;
      const yTop = (r.y - cr.y) * ky;
      const yBot = (r.y + r.height - cr.y) * ky;
      const above = darkIn(x0, yTop - 16 * ky, x1, yTop - 2 * ky);
      const below = darkIn(x0, yBot + 2 * ky, x1, yBot + 16 * ky);
      const score = above + below;
      if (best === null || score > best.score) {
        best = {
          text: t,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          score, above, below,
          canvasPx: { x: Math.round(x0), y: Math.round(yTop), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(yBot - yTop)) },
        };
      }
    }
    return best;
  }, pg);
}

// Candidate leftover DOM after a commit.
async function domProbe() {
  return win.evaluate(() => {
    const sels = ['[data-edit-box-eraser]', '.edit-textrun-selection', '.edit-text-hover', '.edit-box', '.edit-box-preview', '.edit-inline-editor', '.edit-image-placement', '.content-action-bar'];
    const out = {};
    for (const sel of sels) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length === 0) { out[sel] = { count: 0 }; continue; }
      out[sel] = {
        count: els.length,
        rects: els.slice(0, 3).map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor };
        }),
      };
    }
    return out;
  });
}

function leftoverSummary(dom) {
  const hits = {};
  for (const [k, v] of Object.entries(dom)) if (v && v.count > 0) hits[k] = v.count;
  return hits;
}

async function shot(name, clip) {
  const p = path.join(SHOTS, name);
  await win.screenshot(clip ? { path: p, clip } : { path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

// ---------------------------------------------------------------------------
// CLASS B flash probe: MutationObserver on every .thumb-canvas (width/height)
// + rAF sampler of the main page canvas (painted = alpha>0 pixels).
// ---------------------------------------------------------------------------

async function installFlashProbe(ms, pg = 1) {
  return win.evaluate(({ dur, pageNo }) => {
    window.__flash = { muts: [], frames: [], nodes: 0, pg: pageNo };
    const start = performance.now();
    const nodes = Array.from(document.querySelectorAll('.thumb-canvas'));
    window.__flash.nodes = nodes.length;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        window.__flash.muts.push({
          t: Math.round(performance.now() - start),
          idx: nodes.indexOf(m.target),
          attr: m.attributeName,
          val: m.target.getAttribute(m.attributeName),
        });
      }
    });
    nodes.forEach((n) => obs.observe(n, { attributes: true, attributeFilter: ['width', 'height'] }));
    const off = document.createElement('canvas');
    off.width = 48; off.height = 48;
    const octx = off.getContext('2d');
    const tick = () => {
      const c =
        document.querySelector(`.page-slot[data-page="${window.__flash.pg}"] canvas`) ||
        document.querySelector(`.pdf-page[data-page="${window.__flash.pg}"] canvas`);
      let w = -1, h = -1, painted = -1;
      if (c) {
        w = c.width; h = c.height;
        if (w > 0 && h > 0) {
          try {
            octx.clearRect(0, 0, 48, 48);
            octx.drawImage(c, 0, 0, 48, 48);
            const d = octx.getImageData(0, 0, 48, 48).data;
            let p = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) p += 1;
            painted = p;
          } catch (e) { painted = -2; }
        }
      }
      window.__flash.frames.push({ t: Math.round(performance.now() - start), w, h, painted });
      if (performance.now() - start < dur) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.setTimeout(() => { try { obs.disconnect(); } catch (e) { /* ignore */ } }, dur);
    return { nodes: nodes.length };
  }, { dur: ms, pageNo: pg });
}

async function readFlashProbe() {
  return win.evaluate(() => {
    const f = window.__flash || { muts: [], frames: [], nodes: 0 };
    const zeroW = f.muts.filter((m) => m.attr === 'width' && m.val === '0').length;
    const zeroH = f.muts.filter((m) => m.attr === 'height' && m.val === '0').length;
    const frames = f.frames || [];
    const zeroWidthFrames = frames.filter((r) => r.w === 0).length;
    const zeroPaintedFrames = frames.filter((r) => r.painted === 0).length;
    const badFrames = frames.filter((r) => r.w === 0 || r.painted === 0).slice(0, 8);
    return {
      nodes: f.nodes, mutations: f.muts.length, zeroW, zeroH,
      frames: frames.length, zeroWidthFrames, zeroPaintedFrames, badFrames,
      firstMuts: f.muts.slice(0, 8),
    };
  });
}

// Run `trigger()` between a fresh probe install and read. Returns the flash stats.
async function aroundFlash(trigger, ms = 3000, pg = 1) {
  await installFlashProbe(ms, pg);
  await trigger();
  await win.waitForTimeout(ms + 300);
  return readFlashProbe();
}

// ---------------------------------------------------------------------------
// Save As -> close tab -> reopen helper (document-safety check).
// ---------------------------------------------------------------------------

async function saveAsCloseReopen(tag) {
  const savePath = path.join(os.tmpdir(), `tflex-classsweep-${tag}-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2600);
  const exists = fs.existsSync(savePath);
  const bytes = exists ? fs.statSync(savePath).size : -1;
  console.log(`[SAVED|${tag}] path=${savePath} exists=${exists} bytes=${bytes}`);

  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(700);
  if (await win.locator('[data-close-prompt-action="discard"]').count()) {
    await win.locator('[data-close-prompt-action="discard"]').first().click();
    await win.waitForTimeout(900);
  }
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  const cmdOpen = win.locator('[aria-label="Open PDF document"]').first();
  if (await cmdOpen.isVisible().catch(() => false)) await cmdOpen.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2800);
  return savePath;
}

// Viewport point for a canvas-pixel point on page `pg`.
function toViewport(scale, px) {
  return { x: scale.cx + px.x / scale.kx, y: scale.cy + px.y / scale.ky };
}

// Derive the band-above rect (canvas px) for an ink rect.
function bandAbove(scale, rect, gap = 6, height = 16) {
  return {
    x: rect.x,
    y: rect.y - Math.round((gap + height) * scale.ky),
    w: rect.w,
    h: Math.round(height * scale.ky),
  };
}

// Class A acceptance: the band ABOVE the moved item must never be erased.
// Live measurement is the same canvas/render, so it must be byte-exact; the
// reopened file is a fresh rasterisation, so allow the small anti-aliasing
// variance (<5%) but reject any real erasure.
function aboveNotErased(before, live, reopen) {
  return {
    liveExact: live === before,
    reopenOk: reopen >= Math.floor(before * 0.95),
    detail: `${before}->${live}->${reopen}`,
  };
}

async function dragMouse(from, to, steps = 14) {  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(to.x, to.y, { steps });
  await win.mouse.up();
}

// Create a text box just below the chosen ink rect. Returns its viewport point
// and the canvas-px rect it should occupy.
async function createTextBoxBelow(scale, runPx, label) {
  let px = { x: runPx.x, y: runPx.y + runPx.h + Math.round(34 * scale.ky), w: runPx.w, h: Math.round(30 * scale.ky) };
  let a = toViewport(scale, { x: px.x, y: px.y });
  let b = toViewport(scale, { x: px.x + px.w, y: px.y + px.h });
  // Phase 25/26 — the floating text panel covers the page's left edge, so a
  // left-side drag is intercepted by the panel. Shift the drag clear of it and
  // recompute the canvas-px rect from the actual viewport point. Phase 36: read
  // the panel's ACTUAL right edge (it is wider than the old hardcoded 500px and
  // now floats inside .workspace-main), so a fixed MIN_X starts the drag on it.
  const panelRight = await win.evaluate(() => {
    const p = document.querySelector('[data-text-panel]');
    return p ? p.getBoundingClientRect().right : 0;
  });
  const MIN_X = Math.max(500, panelRight + 40);
  if (a.x < MIN_X) {
    const shift = MIN_X - a.x;
    a = { x: a.x + shift, y: a.y };
    b = { x: b.x + shift, y: b.y };
    px = { ...px, x: Math.round((a.x - scale.cx) * scale.kx) };
  }
  await dragMouse(a, b, 14);
  // Phase 26 — the panel Text field is the editor (commits on blur).
  await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 8000 });
  await win.fill('[data-txt-text]', label);
  await win.locator('[data-txt-text]').blur();
  await win.waitForTimeout(1600);
  return px;
}

// Create an image placement just below the chosen ink rect via the file chooser.
async function createImageBelow(scale, runPx) {
  const px = { x: runPx.x, y: runPx.y + runPx.h + Math.round(34 * scale.ky), w: Math.round(runPx.w * 0.6), h: Math.round(40 * scale.ky) };
  const a = toViewport(scale, { x: px.x, y: px.y });
  const b = toViewport(scale, { x: px.x + px.w, y: px.y + px.h });
  const fcPromise = win.waitForEvent('filechooser');
  await dragMouse(a, b, 14);
  const fc = await fcPromise;
  await fc.setFiles(PNG);
  await win.waitForTimeout(1800);
  return px;
}

async function boxPlacementRect() {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-box');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function imagePlacementRect() {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-image-placement');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

module.exports = {};

// ---------------------------------------------------------------------------
// A1a - TEXT RUN move (the already-fixed control path)
// ---------------------------------------------------------------------------

test('A1a text run move: old rect masked, band above stable, no leftover, save/reopen, flash', async () => {
  await openReport();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armEditTool('text');

  const dense = await pickDenseRun(2);
  expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
  const scale = await scaleFor(2);
  const runPx = dense.canvasPx;
  const abovePx = bandAbove(scale, runPx);
  console.log(`[A1a|RUN] text="${dense.text}" px=${JSON.stringify(runPx)} above=${JSON.stringify(abovePx)}`);

  const beforeRun = await darkAtPx(runPx, 2);
  const beforeAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1a|BEFORE] oldRectDark=${beforeRun.dark} aboveDark=${beforeAbove.dark}`);
  await shot('class-sweep-a1a-before.png');

  const cx = dense.rect.x + dense.rect.w / 2;
  const cy = dense.rect.y + dense.rect.h / 2;
  // Phase 26 — the inline editor is retired: select the run, drag its body
  // +150/+120 to park a pending move, then Confirm on the run bar.
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(450);
  expect(await win.locator('[data-content-action-bar="textrun"]').count(), 'the run bar must appear on a single click').toBeGreaterThan(0);
  expect(await win.locator('.edit-inline-editor').count(), 'Phase 26: no in-canvas editor mounts').toBe(0);

  await dragMouse({ x: cx, y: cy }, { x: cx + 150, y: cy + 120 }, 14);
  await win.waitForTimeout(450);
  expect(await win.locator('[data-content-action="textrun-confirm"]').count(), 'run Confirm present after the move drag').toBeGreaterThan(0);

  const flash = await aroundFlash(async () => {
    await win.locator('[data-content-action="textrun-confirm"]').first().click();
  }, 3000, 2);
  console.log(`[A1a|FLASH] ${JSON.stringify(flash)}`);

  await win.waitForTimeout(900);
  const dom = await domProbe();
  const afterRun = await darkAtPx(runPx, 2);
  const afterAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1a|AFTER] oldRectDark=${afterRun.dark} aboveDark=${afterAbove.dark} leftover=${JSON.stringify(leftoverSummary(dom))}`);
  await shot('class-sweep-a1a-after.png');

  await saveAsCloseReopen('a1a');
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const reRun = await darkAtPx(runPx, 2);
  const reAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1a|REOPEN] oldRectDark=${reRun.dark} aboveDark=${reAbove.dark}`);
  await shot('class-sweep-a1a-reopen.png');

  const ab = aboveNotErased(beforeAbove.dark, afterAbove.dark, reAbove.dark);
  console.log(`[A1a|VERDICT] oldRect ${beforeRun.dark}->${afterRun.dark}->${reRun.dark}; above ${ab.detail}; liveExact=${ab.liveExact}; reopenOk=${ab.reopenOk}; leftover=${JSON.stringify(leftoverSummary(dom))}`);
  expect(afterRun.dark, 'old run rect must be masked to 0').toBe(0);
  expect(ab.liveExact, 'band above must be byte-stable live after Confirm').toBe(true);
  expect(ab.reopenOk, 'band above must not be erased after save+reopen (>=95% of before)').toBe(true);
});

// ---------------------------------------------------------------------------
// A1b - TEXT BOX move (engine has NO mask; registry draws once at final rect)
// ---------------------------------------------------------------------------

test('A1b text box move: band above stable, no leftover eraser, save/reopen, flash', async () => {
  await openReport();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armEditTool('box');

  const dense = await pickDenseRun(2);
  expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
  const scale = await scaleFor(2);
  const runPx = dense.canvasPx;
  const abovePx = bandAbove(scale, runPx);

  const boxPx = await createTextBoxBelow(scale, runPx, 'QA SWEEP BOX');
  console.log(`[A1b|BOX-PX] ${JSON.stringify(boxPx)}`);
  const beforeBox = await darkAtPx(boxPx, 2);
  const beforeAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1b|BEFORE] oldRectDark=${beforeBox.dark} aboveDark=${beforeAbove.dark}`);
  expect(beforeBox.dark, 'committed box must have dark text').toBeGreaterThan(0);
  await shot('class-sweep-a1b-before.png');

  const boxRect = await boxPlacementRect();
  expect(boxRect, 'committed .edit-box must exist').toBeTruthy();
  await dragMouse(
    { x: boxRect.x + boxRect.w / 2, y: boxRect.y + boxRect.h / 2 },
    { x: boxRect.x + boxRect.w / 2 + 110, y: boxRect.y + boxRect.h / 2 + 90 },
    14,
  );
  await win.waitForTimeout(500);
  await win.waitForSelector('[data-edit-box-action="confirm"]', { timeout: 8000 });
  const flash = await aroundFlash(async () => {
    await win.locator('[data-edit-box-action="confirm"]').first().click();
  }, 3000, 2);
  console.log(`[A1b|FLASH] ${JSON.stringify(flash)}`);

  await win.waitForTimeout(900);
  const dom = await domProbe();
  const afterBox = await darkAtPx(boxPx, 2);
  const afterAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1b|AFTER] oldRectDark=${afterBox.dark} aboveDark=${afterAbove.dark} leftover=${JSON.stringify(leftoverSummary(dom))}`);
  await shot('class-sweep-a1b-after.png');

  await saveAsCloseReopen('a1b');
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const reBox = await darkAtPx(boxPx, 2);
  const reAbove = await darkAtPx(abovePx, 2);
  console.log(`[A1b|REOPEN] oldRectDark=${reBox.dark} aboveDark=${reAbove.dark}`);
  await shot('class-sweep-a1b-reopen.png');

  const ab = aboveNotErased(beforeAbove.dark, afterAbove.dark, reAbove.dark);
  console.log(`[A1b|VERDICT] oldRect ${beforeBox.dark}->${afterBox.dark}->${reBox.dark}; above ${ab.detail}; liveExact=${ab.liveExact}; reopenOk=${ab.reopenOk}; leftover=${JSON.stringify(leftoverSummary(dom))}`);
  expect(ab.liveExact, 'band above must be byte-stable live after Confirm').toBe(true);
  expect(ab.reopenOk, 'band above must not be erased after save+reopen (>=95% of before)').toBe(true);
});

// ---------------------------------------------------------------------------
// A1c - IMAGE move (engine editImage masks payload.oldRect exactly)
// ---------------------------------------------------------------------------

test('A1c image move: old rect masked, band above stable, no leftover, save/reopen, flash', async () => {
  await openReport();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armEditTool('image');

  const dense = await pickDenseRun(2);
  expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
  const scale = await scaleFor(2);
  const runPx = dense.canvasPx;
  const abovePx = bandAbove(scale, runPx);

  const imgPx = await createImageBelow(scale, runPx);
  const newPx = { x: imgPx.x + 110, y: imgPx.y + 90, w: imgPx.w, h: imgPx.h };
  console.log(`[A1c|IMG-PX] ${JSON.stringify(imgPx)} target=${JSON.stringify(newPx)}`);
  const beforeImg = await darkAtPx(imgPx, 2);
  const beforeAbove = await darkAtPx(abovePx, 2);
  const beforeTarget = await darkAtPx(newPx, 2);
  console.log(`[A1c|BEFORE] oldRectDark=${beforeImg.dark} aboveDark=${beforeAbove.dark} targetDark=${beforeTarget.dark}`);
  expect(beforeImg.dark, 'placed image must have dark pixels').toBeGreaterThan(0);
  await shot('class-sweep-a1c-before.png');

  const imgRect = await imagePlacementRect();
  expect(imgRect, 'committed .edit-image-placement must exist').toBeTruthy();
  // Direct engine-call spy: creation already called editImage once, so reset
  // the counter now to count only the MOVE commit.
  const spy = await win.evaluate(() => {
    window.__imgMoveCalls = 0;
    const api = window.tflex && window.tflex.engine;
    if (!api || typeof api.editImage !== 'function') return 'no-api';
    const orig = api.editImage;
    try {
      api.editImage = function (...a) { window.__imgMoveCalls += 1; return orig.apply(this, a); };
      return api.editImage === orig ? 'frozen' : 'installed';
    } catch (e) { return 'throw:' + e.message; }
  });
  const flash = await aroundFlash(async () => {
    await dragMouse(
      { x: imgRect.x + imgRect.w / 2, y: imgRect.y + imgRect.h / 2 },
      { x: imgRect.x + imgRect.w / 2 + 110, y: imgRect.y + imgRect.h / 2 + 90 },
      14,
    );
  }, 3000, 2);
  console.log(`[A1c|FLASH] ${JSON.stringify(flash)}`);
  const imgRectAfter = await imagePlacementRect();
  const toasts = await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent));
  const moveCalls = await win.evaluate(() => window.__imgMoveCalls);
  console.log(`[A1c|DRAG] before=${JSON.stringify(imgRect)} after=${JSON.stringify(imgRectAfter)} engine.editImageMoveCalls=${moveCalls} spy=${spy} toasts=${JSON.stringify(toasts)}`);

  await win.waitForTimeout(900);
  const dom = await domProbe();
  const afterImg = await darkAtPx(imgPx, 2);
  const afterAbove = await darkAtPx(abovePx, 2);
  const afterTarget = await darkAtPx(newPx, 2);
  console.log(`[A1c|AFTER] oldRectDark=${afterImg.dark} aboveDark=${afterAbove.dark} targetDark=${afterTarget.dark} leftover=${JSON.stringify(leftoverSummary(dom))}`);
  await shot('class-sweep-a1c-after.png');

  await saveAsCloseReopen('a1c');
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const reImg = await darkAtPx(imgPx, 2);
  const reAbove = await darkAtPx(abovePx, 2);
  const reTarget = await darkAtPx(newPx, 2);
  console.log(`[A1c|REOPEN] oldRectDark=${reImg.dark} aboveDark=${reAbove.dark} targetDark=${reTarget.dark}`);
  await shot('class-sweep-a1c-reopen.png');

  const ab = aboveNotErased(beforeAbove.dark, afterAbove.dark, reAbove.dark);
  console.log(`[A1c|VERDICT] oldRect ${beforeImg.dark}->${afterImg.dark}->${reImg.dark}; target ${beforeTarget.dark}->${afterTarget.dark}->${reTarget.dark}; above ${ab.detail}; liveExact=${ab.liveExact}; reopenOk=${ab.reopenOk}; leftover=${JSON.stringify(leftoverSummary(dom))}`);
  // Image move commit check: the engine must relocate the placement (old
  // masked, target carries the image). If the reopen keeps the image at the
  // OLD rect and leaves the TARGET empty, the move never reached the engine.
  expect(reImg.dark, 'old image rect must be masked to 0 after save+reopen').toBe(0);
  expect(reTarget.dark, 'moved image must render at the target rect after save+reopen').toBeGreaterThan(0);
  expect(ab.liveExact, 'band above must be byte-stable live after Confirm').toBe(true);
  expect(ab.reopenOk, 'band above must not be erased after save+reopen (>=95% of before)').toBe(true);
});

// ---------------------------------------------------------------------------
// A2 - FLASH SWEEP over the page/document tools
// ---------------------------------------------------------------------------

async function openTools() {
  // Phase 36 migration: the All-tools palette is retired; use runTool(id).
}

test('A2 flash sweep: thumb canvas zeroing + main canvas blank around each tool commit', async () => {
  await openReport();
  await win.waitForTimeout(1200);
  const rows = {};

  // 1. Watermark apply.
  await runTool(win, 'watermark');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.locator('[data-watermark-text]').fill('SWEEP');
  rows['watermark-apply'] = await aroundFlash(async () => {
    await win.locator('[data-watermark-confirm]').click();
  }, 4000, 1);
  console.log(`[A2|watermark-apply] ${JSON.stringify(rows['watermark-apply'])}`);
  await win.waitForTimeout(500);

  // 2. Watermark delete-by-id (reopen dialog; applied row wm-1).
  await runTool(win, 'watermark');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
  await win.waitForTimeout(500);
  const delCount = await win.locator('[data-watermark-delete]').count();
  console.log(`[A2|watermark-delete] rows=${delCount}`);
  rows['watermark-delete'] = await aroundFlash(async () => {
    await win.locator('[data-watermark-delete]').first().click();
  }, 4000, 1);
  console.log(`[A2|watermark-delete] ${JSON.stringify(rows['watermark-delete'])}`);
  await win.waitForTimeout(500);
  // The dialog stays open after a delete; close it before the toolbar triggers.
  const wmClose = win.locator('[data-watermark-dialog] .modal-close');
  if (await wmClose.count()) await wmClose.first().click().catch(() => {});
  await win.locator('[data-watermark-dialog]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(400);

  // 3. Rotate page.
  await gotoStage(win, 1);
  rows['rotate-page'] = await aroundFlash(async () => {
    await win.click('[data-dock-verb="rotate"]');
  }, 3500, 1);
  console.log(`[A2|rotate-page] ${JSON.stringify(rows['rotate-page'])}`);

  // 4. Delete page (last page, range mode, to avoid moving page 1).
  await runTool(win, 'delete');
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(300);
  await win.click('[data-delete-mode="range"]');
  await win.waitForTimeout(200);
  await win.fill('[data-delete-range]', '34');
  await win.waitForTimeout(200);
  rows['delete-page'] = await aroundFlash(async () => {
    await win.click('[data-delete-confirm]');
  }, 4000, 1);
  console.log(`[A2|delete-page] ${JSON.stringify(rows['delete-page'])}`);

  // 5. Crop pages.
  await runTool(win, 'cropPages');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(800);
  rows['crop-pages'] = await aroundFlash(async () => {
    await win.click('[data-crop-confirm]');
  }, 4000, 1);
  console.log(`[A2|crop-pages] ${JSON.stringify(rows['crop-pages'])}`);

  // 6. Optimize (opens the reduced result as a new tab).
  await openDockVerb(win, 4, 'optimize');
  await win.waitForSelector('.optimize-dialog', { timeout: 10000 });
  await win.waitForTimeout(500);
  rows['optimize'] = await aroundFlash(async () => {
    await win.click('[data-optimize-confirm]');
  }, 6000, 1);
  console.log(`[A2|optimize] ${JSON.stringify(rows['optimize'])}`);
  await shot('class-sweep-a2-optimize.png');

  console.log(`[A2|SUMMARY] ${JSON.stringify(rows)}`);
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|#520|Rules of Hooks/.test(m));
  console.log(`[A2|PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});

// ---------------------------------------------------------------------------
// A3 - CONTROL: the intended offscreen release still happens
// ---------------------------------------------------------------------------

test('A3 control: offscreen page canvas backing store is still released', async () => {
  await openReport();
  await win.waitForTimeout(1200);
  const before = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    const c = slot && slot.querySelector('canvas');
    return { mounted: !!slot, w: c ? c.width : -1, h: c ? c.height : -1 };
  });
  console.log(`[A3|BEFORE] ${JSON.stringify(before)}`);
  expect(before.w, 'page-1 canvas rendered before scrolling away').toBeGreaterThan(0);

  await scrollToPage(win, 30);
  await win.waitForTimeout(1800);
  const after = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    const c = slot && slot.querySelector('canvas');
    return { mounted: !!slot, w: c ? c.width : -1, h: c ? c.height : -1, mountedSlots: document.querySelectorAll('.page-slot canvas').length };
  });
  console.log(`[A3|AFTER-SCROLL-AWAY] ${JSON.stringify(after)}`);
  await shot('class-sweep-a3-scrollaway.png');

  const released = !after.mounted || after.w === 0 || after.h === 0 || after.w === -1;
  console.log(`[A3|VERDICT] released=${released}`);
  expect(released, 'page-1 canvas backing store must be released when scrolled offscreen').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-223 retest (2026-09-18). The fix parks `imageDrag.startRect` as the
// pre-drag rect for the move/resize commit and the no-op guard. Probes:
//   * engine op reached = proxy refresh (thumb-canvas width/height mutations)
//   * old rect fully white-masked; NEW rect carries the image
//   * mask is EXACTLY the old rect: a thin frame just OUTSIDE the old rect and
//     the band above stay byte-identical (no over-mask / no padding)
//   * survives Save As -> close -> reopen
//   * flash class: 0 thumb width/height-zero mutations, main canvas never blank
// ---------------------------------------------------------------------------

// Same pixel probes as darkAtPx but with a byte hash, so "byte-identical"
// is checked, not just a dark-pixel count.
async function sigAtPx(px, pageNo) {
  return win.evaluate(({ r, pg }) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    if (c.width === 0 || c.height === 0) return { error: 'zero-canvas', w: c.width, h: c.height };
    const sx = Math.max(0, Math.round(r.x));
    const sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    if (sx >= c.width || sy >= c.height) return { error: 'oob', sx, sy };
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let dark = 0, nearWhite = 0, total = 0, h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      total += 1;
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (lum < 140) dark += 1;
      if (d[i] >= 245 && d[i + 1] >= 245 && d[i + 2] >= 245) nearWhite += 1;
      h = Math.imul(h ^ d[i], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 3], 16777619) >>> 0;
    }
    return { dark, nearWhite, total, hash: h >>> 0 };
  }, { r: px, pg: pageNo });
}

// Four thin strips just OUTSIDE `rect` (canvas px). Over-masking / padding
// shows up as a dark-count drop here.
function frameRects(rect, gap = 4, thick = 3) {
  return [
    { x: rect.x - thick, y: rect.y - gap - thick, w: rect.w + thick * 2, h: thick },
    { x: rect.x - thick, y: rect.y + rect.h + gap, w: rect.w + thick * 2, h: thick },
    { x: rect.x - gap - thick, y: rect.y, w: thick, h: rect.h },
    { x: rect.x + rect.w + gap, y: rect.y, w: thick, h: rect.h },
  ];
}

async function sigFrame(rects, pg) {
  const parts = [];
  for (const r of rects) parts.push(await sigAtPx(r, pg));
  return {
    dark: parts.reduce((a, b) => a + (b.dark || 0), 0),
    nearWhite: parts.reduce((a, b) => a + (b.nearWhite || 0), 0),
    total: parts.reduce((a, b) => a + (b.total || 0), 0),
    hashes: parts.map((o) => o.hash),
  };
}

// Two strips beyond the NEW rect on the grow axes (resize neighbour check).
function beyondRects(rect, gap = 4, thick = 3) {
  return [
    { x: rect.x + rect.w + gap, y: rect.y, w: thick, h: rect.h },
    { x: rect.x, y: rect.y + rect.h + gap, w: rect.w, h: thick },
  ];
}

function domRectToCanvasPx(scale, r) {
  return {
    x: Math.round((r.x - scale.cx) * scale.kx),
    y: Math.round((r.y - scale.cy) * scale.ky),
    w: Math.round(r.w * scale.kx),
    h: Math.round(r.h * scale.ky),
  };
}

// ---------------------------------------------------------------------------
// B1 - DEF-223 IMAGE MOVE retest
// ---------------------------------------------------------------------------

test('B1 DEF-223 retest: image move commits, mask exact, persists, no flash', async () => {
  await openReport();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armEditTool('image');

  const dense = await pickDenseRun(2);
  expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
  const scale = await scaleFor(2);
  const runPx = dense.canvasPx;
  const abovePx = bandAbove(scale, runPx);

  const imgPx = await createImageBelow(scale, runPx);
  const newPx = { x: imgPx.x + 110, y: imgPx.y + 90, w: imgPx.w, h: imgPx.h };
  const frame = frameRects(imgPx);
  console.log(`[B1|IMG-PX] old=${JSON.stringify(imgPx)} target=${JSON.stringify(newPx)}`);

  const beforeImg = await sigAtPx(imgPx, 2);
  const beforeAbove = await sigAtPx(abovePx, 2);
  const beforeTarget = await sigAtPx(newPx, 2);
  const beforeFrame = await sigFrame(frame, 2);
  console.log(`[B1|BEFORE] old=${JSON.stringify(beforeImg)} target=${JSON.stringify(beforeTarget)} above=${beforeAbove.dark} frame=${JSON.stringify(beforeFrame)}`);
  expect(beforeImg.dark, 'placed image must have dark pixels at the old rect').toBeGreaterThan(0);
  await shot('def-223-retest-before.png');

  const imgRect = await imagePlacementRect();
  expect(imgRect, 'committed .edit-image-placement must exist').toBeTruthy();
  const flash = await aroundFlash(async () => {
    await dragMouse(
      { x: imgRect.x + imgRect.w / 2, y: imgRect.y + imgRect.h / 2 },
      { x: imgRect.x + imgRect.w / 2 + 110, y: imgRect.y + imgRect.h / 2 + 90 },
      14,
    );
  }, 3000, 2);
  const imgRectAfter = await imagePlacementRect();
  const toasts = await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent));
  console.log(`[B1|FLASH] ${JSON.stringify(flash)}`);
  console.log(`[B1|DRAG] overlay before=${JSON.stringify(imgRect)} after=${JSON.stringify(imgRectAfter)} toasts=${JSON.stringify(toasts)}`);

  await win.waitForTimeout(900);
  const dom = await domProbe();
  const afterImg = await sigAtPx(imgPx, 2);
  const afterAbove = await sigAtPx(abovePx, 2);
  const afterTarget = await sigAtPx(newPx, 2);
  const afterFrame = await sigFrame(frame, 2);
  console.log(`[B1|AFTER] old=${JSON.stringify(afterImg)} target=${JSON.stringify(afterTarget)} above=${afterAbove.dark} frame=${JSON.stringify(afterFrame)} leftover=${JSON.stringify(leftoverSummary(dom))}`);
  await shot('def-223-retest-after.png');

  await saveAsCloseReopen('def223move');
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const reImg = await sigAtPx(imgPx, 2);
  const reAbove = await sigAtPx(abovePx, 2);
  const reTarget = await sigAtPx(newPx, 2);
  const reFrame = await sigFrame(frame, 2);
  console.log(`[B1|REOPEN] old=${JSON.stringify(reImg)} target=${JSON.stringify(reTarget)} above=${reAbove.dark} frame=${JSON.stringify(reFrame)}`);
  await shot('def-223-retest-reopen.png');

  console.log(`[B1|VERDICT] moveCalls(proxyRefresh muts)=${flash.mutations}; old ${beforeImg.dark}->${afterImg.dark}->${reImg.dark}; target ${beforeTarget.dark}->${afterTarget.dark}->${reTarget.dark}; above ${beforeAbove.dark}->${afterAbove.dark}->${reAbove.dark}; frame ${beforeFrame.dark}->${afterFrame.dark}->${reFrame.dark}; zeroW=${flash.zeroW} zeroH=${flash.zeroH} zeroWidthFrames=${flash.zeroWidthFrames} zeroPaintedFrames=${flash.zeroPaintedFrames}`);

  // Live feedback: the placement DOM mirror moves with the drag (image
  // placements render in the DOM; the canvas is the pre-edit render until a
  // save/reopen refresh, exactly as at creation - so no proxy-refresh signal
  // is expected here; the flash probe below still guards the zeroing class).
  expect(Math.round(imgRectAfter.x - imgRect.x), 'the placement mirror must move +110 CSS px').toBe(110);
  expect(Math.round(imgRectAfter.y - imgRect.y), 'the placement mirror must move +90 CSS px').toBe(90);
  // Engine op reached + mask exactness: proven by the saved/reopened file.
  expect(reImg.dark, 'old rect must hold no image after save+reopen').toBe(0);
  expect(reImg.nearWhite, 'old rect must be fully white after save+reopen (mask covers it exactly)').toBe(reImg.total);
  expect(reTarget.dark, 'image must be at the NEW rect after save+reopen').toBeGreaterThan(beforeTarget.dark);
  expect(reAbove.dark, 'band above must not be erased after reopen (>=95% of before)').toBeGreaterThanOrEqual(Math.floor(beforeAbove.dark * 0.95));
  expect(JSON.stringify(reFrame.hashes), 'frame around the old rect must be byte-identical after save+reopen (mask = old rect exactly, no padding, no neighbour erasure)').toBe(JSON.stringify(beforeFrame.hashes));
  // Flash class re-confirmation.
  expect(flash.zeroW, 'no thumb canvas width=0 mutation during the move commit').toBe(0);
  expect(flash.zeroH, 'no thumb canvas height=0 mutation during the move commit').toBe(0);
  expect(flash.zeroWidthFrames, 'main page canvas must never go 0-wide during the move commit').toBe(0);
  expect(flash.zeroPaintedFrames, 'main page canvas must never blank during the move commit').toBe(0);
});

// ---------------------------------------------------------------------------
// B2 - DEF-223 IMAGE RESIZE retest
// ---------------------------------------------------------------------------

test('B2 DEF-223 retest: image resize commits, persists, neighbours intact, no flash', async () => {
  await openReport();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armEditTool('image');

  const dense = await pickDenseRun(2);
  expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
  const scale = await scaleFor(2);
  const runPx = dense.canvasPx;
  const abovePx = bandAbove(scale, runPx);

  const imgPx = await createImageBelow(scale, runPx);
  console.log(`[B2|IMG-PX] old=${JSON.stringify(imgPx)}`);

  // A plain click selects the placement (pointerdown + pointerup, no move),
  // which mounts the corner handles.
  const imgRect0 = await imagePlacementRect();
  expect(imgRect0, 'committed .edit-image-placement must exist').toBeTruthy();
  await win.mouse.click(imgRect0.x + imgRect0.w / 2, imgRect0.y + imgRect0.h / 2);
  await win.waitForTimeout(400);
  const handle = await win.evaluate(() => {
    const h = document.querySelector('.edit-image-handle-se');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    // The placement has overflow:hidden and the handles sit at -5px, so only
    // the inner 5x5 quadrant is reachable; aim there (left+3/top+3).
    return { x: r.x + 3, y: r.y + 3, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  expect(handle, 'SE resize handle must mount after selecting the placement').toBeTruthy();
  console.log(`[B2|HANDLE] ${JSON.stringify(handle)}`);

  const beforeImg = await sigAtPx(imgPx, 2);
  const beforeAbove = await sigAtPx(abovePx, 2);
  console.log(`[B2|BEFORE] old=${JSON.stringify(beforeImg)} above=${beforeAbove.dark}`);
  expect(beforeImg.dark, 'placed image must have dark pixels').toBeGreaterThan(0);

  const flash = await aroundFlash(async () => {
    await dragMouse(handle, { x: handle.x + 70, y: handle.y + 50 }, 14);
  }, 3000, 2);
  const imgRectAfter = await imagePlacementRect();
  const newPx = domRectToCanvasPx(scale, imgRectAfter);
  const beyond = beyondRects(newPx);
  console.log(`[B2|FLASH] ${JSON.stringify(flash)}`);
  console.log(`[B2|DRAG] overlay before=${JSON.stringify(imgRect0)} after=${JSON.stringify(imgRectAfter)} newPx=${JSON.stringify(newPx)}`);

  await win.waitForTimeout(900);
  const afterImg = await sigAtPx(imgPx, 2);
  const afterAbove = await sigAtPx(abovePx, 2);
  const afterNew = await sigAtPx(newPx, 2);
  const afterBeyond = await sigFrame(beyond, 2);
  console.log(`[B2|AFTER] old=${JSON.stringify(afterImg)} new=${JSON.stringify(afterNew)} above=${afterAbove.dark} beyond=${JSON.stringify(afterBeyond)}`);
  await shot('def-223-retest-resize-after.png');

  await saveAsCloseReopen('def223resize');
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  const reImg = await sigAtPx(imgPx, 2);
  const reAbove = await sigAtPx(abovePx, 2);
  const reNew = await sigAtPx(newPx, 2);
  const reBeyond = await sigFrame(beyond, 2);
  console.log(`[B2|REOPEN] old=${JSON.stringify(reImg)} new=${JSON.stringify(reNew)} above=${reAbove.dark} beyond=${JSON.stringify(reBeyond)}`);

  console.log(`[B2|VERDICT] proxyRefreshMuts=${flash.mutations}; old ${beforeImg.dark}->${afterImg.dark}->${reImg.dark}; new ${afterNew.dark}->${reNew.dark}; above ${beforeAbove.dark}->${afterAbove.dark}->${reAbove.dark}; beyond ${afterBeyond.dark}->${reBeyond.dark}; zeroW=${flash.zeroW} zeroH=${flash.zeroH} zeroWidthFrames=${flash.zeroWidthFrames} zeroPaintedFrames=${flash.zeroPaintedFrames}`);

  expect(imgRectAfter.w, 'the resize drag must enlarge the overlay').toBeGreaterThan(imgRect0.w);
  expect(imgRectAfter.h, 'the resize drag must enlarge the overlay').toBeGreaterThan(imgRect0.h);
  // Engine op reached + new size persisted: proven by the saved/reopened file.
  expect(reNew.dark, 'resized image must be at the NEW rect after save+reopen').toBeGreaterThan(0);
  expect(reImg.dark, 'old rect is inside the grown image, so it must carry ink after reopen').toBeGreaterThan(0);
  // Neighbours intact: band above and the region beyond the new rect.
  expect(reAbove.dark, 'band above must not be erased after reopen (>=95% of before)').toBeGreaterThanOrEqual(Math.floor(beforeAbove.dark * 0.95));
  expect(reBeyond.dark, 'region beyond the new rect must keep its text after reopen (>=95% of live)').toBeGreaterThanOrEqual(Math.floor(afterBeyond.dark * 0.95));
  expect(reBeyond.dark, 'region beyond the new rect must not be blanked').toBeGreaterThan(0);
  // Flash class re-confirmation.
  expect(flash.zeroW, 'no thumb canvas width=0 mutation during the resize commit').toBe(0);
  expect(flash.zeroH, 'no thumb canvas height=0 mutation during the resize commit').toBe(0);
  expect(flash.zeroWidthFrames, 'main page canvas must never go 0-wide during the resize commit').toBe(0);
  expect(flash.zeroPaintedFrames, 'main page canvas must never blank during the resize commit').toBe(0);
});
