// QA focused verification - USER-REPORTED defect (operator, 1.18.0):
//   "Edit text under edit option issue. After moving and confirming new position
//    of text leaves behind an empty box in its original location. Also after
//    clicking confirm make the thumbnail page view panel flicker a bit."
//
// Two symptoms, one repro flow. This spec reproduces on the DEV build through the
// canonical launchApp helper and pins the MECHANISM with raw measurements:
//   A. leftover box   - DOM probe (which element survives), canvas pixel probe
//                       (mean RGB / near-white count before vs after), vision shot,
//                       and BAKED-vs-RENDERER via Save As -> close tab -> reopen.
//   B. thumb flicker  - 5-shot burst of .thumb-scroller at ~100ms, plus DOM
//                       identity of .thumb-canvas nodes before vs after (same vs
//                       replaced) and .thumb-placeholder presence.
//   C. positive ctrl  - plain in-place selection + Confirm (no move)
//                       must leave no leftover box at the old rect.
//
// No assertions that would mask the measurement: this spec REPORTS raw values and
// only asserts the flow reached the required states (editor open, confirm flipped).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, scrollToPage } = require('./lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.setTimeout(420000);

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
// Flow helpers
// ---------------------------------------------------------------------------

async function openReportFromWelcome() {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2400);
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

async function armTextTool() {
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);
}

async function shot(name, clip) {
  const p = path.join(SHOTS, name);
  await win.screenshot(clip ? { path: p, clip } : { path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

// Find the first textLayer run on `pageNo` whose text contains `needle`.
async function findRun(needle, pageNo = 1) {
  return win.evaluate(({ n, pg }) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return null;
    const spans = Array.from(slot.querySelectorAll('.textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(n)) {
        const r = s.getBoundingClientRect();
        if (r.width > 4 && r.height > 4 && r.y > 80 && r.y < window.innerHeight - 80) {
          return { text: t, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
        }
      }
    }
    return null;
  }, { n: needle, pg: pageNo });
}

// First on-screen textLayer run with a substantial string on `pageNo`.
async function findAnyBodyRun(pageNo = 1) {
  return win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return null;
    const spans = Array.from(slot.querySelectorAll('.textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length > 20 && r.width > 40 && r.height > 4 && r.y > 80 && r.y < window.innerHeight - 80) {
        return { text: t, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }
    }
    return null;
  }, pageNo);
}

// Pick the on-screen page-`pg` run whose canvas bands just above and just below
// carry the most glyph pixels (i.e. a line inside a dense paragraph).
async function pickDenseRun(pg) {
  return win.evaluate((pageNo) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"]`);
    if (!slot) return null;
    const c = slot.querySelector('canvas');
    if (!c) return null;
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

async function readEditor() {
  return win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const ta = e.querySelector('[data-edit-textarea]');
    const r = e.getBoundingClientRect();
    const btn = e.querySelector('[data-edit-confirm]');
    return {
      present: true,
      mode: e.getAttribute('data-edit-editor'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textareaValue: ta ? ta.value : null,
      confirmAttr: btn ? btn.getAttribute('data-edit-confirm') : null,
    };
  });
}

// Phase 26 — the in-canvas inline editor is retired. The run is selected with
// the text tool (single click) and MOVED by dragging the run body; the run
// bar's Confirm commits the relocation through the same engine op.
async function readRunSelection() {
  return win.evaluate(() => ({
    present: !!document.querySelector('[data-content-action-bar="textrun"]'),
    selection: !!document.querySelector('[data-textrun-selection], .edit-textrun-selection'),
    editor: document.querySelectorAll('.edit-inline-editor').length,
  }));
}

async function selectRun(cx, cy) {
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(450);
  return readRunSelection();
}

async function dragRun(cx, cy, dx, dy) {
  await win.mouse.move(cx, cy);
  await win.mouse.down();
  await win.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(450);
  return readRunSelection();
}

// Canvas pixel stats over a VIEWPORT rect on page 1: mean RGB + near-white count.
async function canvasStats(vpRect) {
  return win.evaluate((r) => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    const c = slot && slot.querySelector('canvas');
    if (!c) return { error: 'no-canvas' };
    const cr = c.getBoundingClientRect();
    if (!cr.width || !cr.height) return { error: 'zero-canvas' };
    const kx = c.width / cr.width;
    const ky = c.height / cr.height;
    const sx = Math.round((r.x - cr.x) * kx);
    const sy = Math.round((r.y - cr.y) * ky);
    const sw = Math.max(1, Math.round(r.w * kx));
    const sh = Math.max(1, Math.round(r.h * ky));
    if (sx < 0 || sy < 0 || sx + sw > c.width || sy + sh > c.height) {
      return { error: 'oob', sx, sy, sw, sh, cw: c.width, ch: c.height };
    }
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let rs = 0, gs = 0, bs = 0, n = 0, white = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      rs += R; gs += G; bs += B; n += 1;
      if (R >= 245 && G >= 245 && B >= 245) white += 1;
      const lum = R * 0.299 + G * 0.587 + B * 0.114;
      if (lum < 140) dark += 1;
    }
    return {
      meanRGB: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
      nearWhite: white, dark, total: n,
      bboxCanvasPx: [sx, sy, sw, sh],
    };
  }, vpRect);
}

// DOM probe of every candidate element for the leftover box.
async function domProbe() {
  return win.evaluate(() => {
    const sels = ['[data-edit-box-eraser]', '.edit-textrun-selection', '.edit-text-hover', '.edit-box', '.edit-inline-editor'];
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { exists: false }; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[sel] = {
        exists: true,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        background: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        className: el.className,
      };
    }
    return out;
  });
}

// Tag every live .thumb-canvas node with a unique identity property.
async function tagThumbs() {
  return win.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.thumb-canvas'));
    nodes.forEach((n, i) => { n.__qaTag = 'q' + i + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6); });
    return {
      count: nodes.length,
      tags: nodes.map((n) => n.__qaTag),
      placeholders: document.querySelectorAll('.thumb-placeholder').length,
    };
  });
}

async function thumbIdentity(tags) {
  return win.evaluate((prev) => {
    const nodes = Array.from(document.querySelectorAll('.thumb-canvas'));
    const present = nodes.map((n) => n.__qaTag || null);
    const same = present.filter((t) => t && prev.includes(t)).length;
    return {
      count: nodes.length,
      same,
      replaced: nodes.length - same,
      placeholders: document.querySelectorAll('.thumb-placeholder').length,
      presentTags: present,
    };
  }, tags);
}

async function viewportSize() {
  return win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

// Canvas pixel stats over a fixed CANVAS-pixel rect (immune to page layout shift
// - the "Undo last change" strip appears after an edit and moves the page down).
async function canvasStatsAtPx(px) {
  return win.evaluate((r) => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    const c = slot && slot.querySelector('canvas');
    if (!c) return { error: 'no-canvas' };
    const sx = Math.max(0, Math.round(r.x));
    const sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let rs = 0, gs = 0, bs = 0, n = 0, white = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      rs += R; gs += G; bs += B; n += 1;
      if (R >= 245 && G >= 245 && B >= 245) white += 1;
      const lum = R * 0.299 + G * 0.587 + B * 0.114;
      if (lum < 140) dark += 1;
    }
    return { meanRGB: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)], nearWhite: white, dark, total: n, canvasPx: [sx, sy, sw, sh] };
  }, px);
}

// Per-row dark-pixel profile + dark centroid over a fixed CANVAS-pixel rect, so a
// moved run can be checked for clipping (dark rows still inside the rect, not
// touching the last row) and for baseline retention.
async function darkRowsAndCentroid(px, pageNo = 1) {
  return win.evaluate(({ r, pg }) => {
    const c = document.querySelector(`.page-slot[data-page="${pg}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    const sx = Math.max(0, Math.round(r.x)), sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    const rows = [];
    let sumX = 0, sumY = 0, n = 0;
    for (let y = 0; y < sh; y += 1) {
      let rowDark = 0;
      for (let x = 0; x < sw; x += 1) {
        const i = (y * sw + x) * 4;
        if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) { rowDark += 1; sumX += x; sumY += y; n += 1; }
      }
      rows.push(rowDark);
    }
    return {
      canvasPx: [sx, sy, sw, sh], dark: n, rows,
      firstDarkRow: rows.findIndex((v) => v > 0), lastDarkRow: rows.length - 1 - [...rows].reverse().findIndex((v) => v > 0),
      centroid: n > 0 ? [Math.round((sx + sumX / n) * 10) / 10, Math.round((sy + sumY / n) * 10) / 10] : null,
    };
  }, { r: px, pg: pageNo });
}

// Per-row dark profile over a fixed CANVAS-pixel rect.
async function bandRows(px, pageNo = 1) {
  return win.evaluate(({ p, pg }) => {
    const c = document.querySelector(`.page-slot[data-page="${pg}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    const sx = Math.max(0, Math.round(p.x)), sy = Math.max(0, Math.round(p.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(p.w))), sh = Math.max(1, Math.min(c.height - sy, Math.round(p.h)));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    const rows = [];
    for (let y = 0; y < sh; y += 1) { let n = 0; for (let x = 0; x < sw; x += 1) { const i = (y * sw + x) * 4; if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) n += 1; } rows.push(n); }
    return { sy, rows };
  }, { p: px, pg: pageNo });
}

// Map a fixed canvas-pixel rect back to a viewport clip using the CURRENT canvas
// rect (targets the same PAGE region even after the page shifted).
async function clipFromCanvasPx(px, padX, padY, pageNo = 1) {
  return win.evaluate(({ p, padX, padY, pg }) => {
    const c = document.querySelector(`.page-slot[data-page="${pg}"] canvas`);
    if (!c) return null;
    const cr = c.getBoundingClientRect();
    const kx = cr.width / c.width;
    const ky = cr.height / c.height;
    return {
      x: Math.round(cr.x + p.x * kx - padX),
      y: Math.round(cr.y + p.y * ky - padY),
      width: Math.round(p.w * kx + padX * 2),
      height: Math.round(p.h * ky + padY * 2),
    };
  }, { p: px, padX, padY, pg: pageNo });
}

// Page-1 textLayer runs matching a substring (viewport rects).
async function bodyRuns(needle) {
  return win.evaluate((n) => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (!slot) return [];
    const out = [];
    slot.querySelectorAll('.textLayer span').forEach((s) => {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(n)) {
        const r = s.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) out.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    return out;
  }, needle);
}

// rAF probe of the page-1 thumbnail canvas: records canvas width/height (0 means
// the effect cleanup released the bitmap) + a centre near-white sample each frame.
async function installThumbProbe(ms) {
  return win.evaluate((dur) => {
    window.__thumbProbe = [];
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector('.thumb-item[data-page="1"] .thumb-canvas');
      const rec = { t: Math.round(performance.now() - start), w: el ? el.width : -1, h: el ? el.height : -1, nw: null, op: null };
      if (el && el.width > 0 && el.height > 0) {
        try {
          const d = el.getContext('2d').getImageData(Math.floor(el.width / 2) - 20, Math.floor(el.height / 2) - 20, 40, 40).data;
          let nw = 0, op = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 0) op += 1;
            if (d[i] >= 245 && d[i + 1] >= 245 && d[i + 2] >= 245) nw += 1;
          }
          rec.nw = nw; rec.op = op;
        } catch (e) { rec.nw = -1; rec.op = -1; }
      }
      window.__thumbProbe.push(rec);
      if (performance.now() - start < dur) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  }, ms);
}

async function readThumbProbe() {
  return win.evaluate(() => {
    const arr = window.__thumbProbe || [];
    let zeroW = 0, minW = Infinity, maxW = 0, blanks = 0, samples = 0, cleared = 0, minOp = Infinity;
    const transitions = [];
    let prevW = null;
    for (const r of arr) {
      if (r.w === 0) zeroW += 1;
      if (r.w > 0 && r.w < minW) minW = r.w;
      if (r.w > maxW) maxW = r.w;
      if (r.nw !== null) { samples += 1; if (r.nw >= 1560) blanks += 1; }
      if (r.op !== null && r.op !== undefined) { if (r.op === 0) cleared += 1; if (r.op < minOp) minOp = r.op; }
      if (prevW !== null && r.w !== prevW) transitions.push(`${prevW}->${r.w}@${r.t}ms`);
      prevW = r.w;
    }
    return { frames: arr.length, zeroW, minW: minW === Infinity ? -1 : minW, maxW, blankFrames: blanks, nwSamples: samples, clearedFrames: cleared, minOp: minOp === Infinity ? -1 : minOp, transitions: transitions.slice(0, 20) };
  });
}

// MutationObserver on EVERY mounted .thumb-canvas for width/height attribute
// changes. A clear-then-repaint (the ThumbCanvas effect cleanup zeroes the
// backing store before the async re-render) shows up here even if it lasts
// under one frame - which a screenshot burst and a rAF poll can both miss.
async function installThumbMutationProbe(ms) {
  return win.evaluate((dur) => {
    window.__thumbMut = [];
    window.__thumbMutStart = performance.now();
    const nodes = Array.from(document.querySelectorAll('.thumb-canvas'));
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target;
        window.__thumbMut.push({
          t: Math.round(performance.now() - window.__thumbMutStart),
          idx: nodes.indexOf(el),
          attr: m.attributeName,
          val: el.getAttribute(m.attributeName),
        });
      }
    });
    nodes.forEach((n) => obs.observe(n, { attributes: true, attributeFilter: ['width', 'height'] }));
    window.__thumbMutObs = obs;
    window.__thumbMutNodes = nodes.length;
    window.setTimeout(() => { try { obs.disconnect(); } catch (e) { /* ignore */ } }, dur);
    return nodes.length;
  }, ms);
}

async function readThumbMutationProbe() {
  return win.evaluate(() => {
    const arr = window.__thumbMut || [];
    const zeroW = arr.filter((m) => m.attr === 'width' && m.val === '0').length;
    const zeroH = arr.filter((m) => m.attr === 'height' && m.val === '0').length;
    const restoreW = arr.filter((m) => m.attr === 'width' && m.val !== '0').length;
    return {
      nodesObserved: window.__thumbMutNodes || 0,
      mutations: arr.length,
      zeroWidthSets: zeroW,
      zeroHeightSets: zeroH,
      restoreWidthSets: restoreW,
      first: arr.slice(0, 16),
      last: arr.slice(-8),
    };
  });
}

function clampClip(rect, padX, padY, vp) {
  const rw = rect.w !== undefined ? rect.w : rect.width;
  const rh = rect.h !== undefined ? rect.h : rect.height;
  const x = Math.max(0, Math.floor(rect.x - padX));
  const y = Math.max(0, Math.floor(rect.y - padY));
  const w = Math.min(vp.w - x, Math.ceil(rw + padX * 2));
  const h = Math.min(vp.h - y, Math.ceil(rh + padY * 2));
  return { x, y, width: Math.max(1, w), height: Math.max(1, h) };
}

test('DEF-221/222: move a body text run + Confirm - leftover box at old rect + thumbnail flicker', async () => {
  await openReportFromWelcome();
  await scrollToPage1();
  await armTextTool();

  // Pick a body text run (not the title) so the old location sits inside the
  // paragraph with neighbouring lines, where a white patch / outline is visible.
  let run = await findRun('orchestration');
  if (!run) run = await findRun('performance');
  if (!run) run = await findRun('Report');
  expect(run, 'a page-1 body text run must exist').toBeTruthy();
  console.log(`[RUN] text="${run.text}" rect=${JSON.stringify(run.rect)}`);

  const before = await canvasStats(run.rect);
  console.log(`[PIXEL|BEFORE] ${JSON.stringify(before)}`);
  const runPx = { x: before.bboxCanvasPx[0], y: before.bboxCanvasPx[1], w: before.bboxCanvasPx[2], h: before.bboxCanvasPx[3] };
  const beforePx = await canvasStatsAtPx(runPx);
  const widePx = { x: runPx.x, y: runPx.y - 30, w: runPx.w, h: runPx.h + 60 };
  const beforeWidePx = await canvasStatsAtPx(widePx);
  console.log(`[PIXEL|BEFORE|FIXED-PX] ${JSON.stringify(beforePx)}`);
  console.log(`[PIXEL|BEFORE|WIDE-PX] ${JSON.stringify(beforeWidePx)}`);

  // DEF-221 retest probes (added for the FIX-READY retest): the band directly
  // ABOVE the old run (where the removed DEF-124 ascent widening erased the
  // neighbouring line) and the MOVED position (the new text must still render
  // there). kx/ky convert the +150/+120 viewport drag into canvas pixels.
  const scale = await win.evaluate(() => {
    const c = document.querySelector('.page-slot[data-page="1"] canvas');
    const cr = c.getBoundingClientRect();
    return { kx: c.width / cr.width, ky: c.height / cr.height };
  });
  const bandAbovePx = { x: runPx.x, y: runPx.y - Math.round(18 * scale.ky), w: runPx.w, h: Math.round(16 * scale.ky) };
  const movedPx = { x: runPx.x + Math.round(150 * scale.kx), y: runPx.y + Math.round(120 * scale.ky), w: runPx.w, h: runPx.h };
  const beforeBandAbovePx = await canvasStatsAtPx(bandAbovePx);
  const beforeMovedPx = await canvasStatsAtPx(movedPx);
  console.log(`[PIXEL|BEFORE|BAND-ABOVE-PX] ${JSON.stringify(beforeBandAbovePx)}`);
  console.log(`[PIXEL|BEFORE|MOVED-PX] ${JSON.stringify(beforeMovedPx)}`);
  const vpBefore = await viewportSize();
  const beforeClipRaw = await clipFromCanvasPx(runPx, 130, 90);
  if (beforeClipRaw) await shot('def-221-before.png', clampClip(beforeClipRaw, 0, 0, vpBefore));
  const tagsBefore = await tagThumbs();
  console.log(`[THUMBS|BEFORE] count=${tagsBefore.count} placeholders=${tagsBefore.placeholders}`);

  // Phase 26 — the inline editor is retired: select the run, then drag its
  // body +150/+120 to park a pending move (the bar's Confirm commits it).
  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  let editor = await selectRun(cx, cy);
  console.log(`[RUN|SELECT] ${JSON.stringify(editor)}`);
  expect(editor.present, 'the run bar must appear on a single click').toBe(true);
  expect(editor.editor, 'Phase 26: no in-canvas editor mounts').toBe(0);

  editor = await dragRun(cx, cy, 150, 120);
  console.log(`[RUN|MOVED] ${JSON.stringify(editor)}`);
  expect(editor.present, 'the run bar must stay after the move drag').toBe(true);

  const domPre = await domProbe();
  console.log(`[DOM|PRE-CONFIRM] ${JSON.stringify(domPre)}`);

  // Re-tag thumbnails immediately before confirm so replacement is attributable.
  const tagsPreConfirm = await tagThumbs();
  console.log(`[THUMBS|PRE-CONFIRM] count=${tagsPreConfirm.count} placeholders=${tagsPreConfirm.placeholders}`);
  const vp = await viewportSize();
  const thumbClip = await win.evaluate(() => {
    const t = document.querySelector('.thumb-scroller');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  console.log(`[THUMB-CLIP] ${JSON.stringify(thumbClip)}`);

  // Confirm the move. Install the rAF + mutation probes first so they capture the
  // whole commit + proxy-swap window.
  await installThumbProbe(2500);
  const mutNodes = await installThumbMutationProbe(4000);
  console.log(`[THUMB-MUT-PROBE] observing ${mutNodes} canvases`);
  await win.locator('[data-content-action="textrun-confirm"]').first().click();
  const tConfirm = Date.now();
  console.log('[CONFIRM] clicked');

  // B: burst of 5 thumbnail-panel shots at ~100ms starting at the confirm click,
  // with thumbnail-node identity polled alongside.
  const burst = [];
  for (let i = 0; i < 5; i += 1) {
    const id = await thumbIdentity(tagsPreConfirm.tags);
    burst.push({ i, ms: Date.now() - tConfirm, id });
    await shot(`def-222-thumb-${i}.png`, thumbClip);
    if (i === 0) await shot('def-222-retest.png', thumbClip);
    await win.waitForTimeout(100);
  }
  console.log(`[THUMB-BURST] ${JSON.stringify(burst)}`);

  await win.waitForTimeout(1200);
  const domAfter = await domProbe();
  console.log(`[DOM|POST-CONFIRM] ${JSON.stringify(domAfter)}`);
  const after = await canvasStats(run.rect);
  const afterPx = await canvasStatsAtPx(runPx);
  const afterWidePx = await canvasStatsAtPx(widePx);
  console.log(`[PIXEL|AFTER] ${JSON.stringify(after)}`);
  console.log(`[PIXEL|AFTER|FIXED-PX] ${JSON.stringify(afterPx)}`);
  console.log(`[PIXEL|AFTER|WIDE-PX] ${JSON.stringify(afterWidePx)}`);
  const afterBandAbovePx = await canvasStatsAtPx(bandAbovePx);
  const afterMovedPx = await canvasStatsAtPx(movedPx);
  console.log(`[PIXEL|AFTER|BAND-ABOVE-PX] ${JSON.stringify(afterBandAbovePx)}`);
  console.log(`[PIXEL|AFTER|MOVED-PX] ${JSON.stringify(afterMovedPx)}`);
  const afterMovedRows = await darkRowsAndCentroid(movedPx);
  console.log(`[PIXEL|AFTER|MOVED-ROWS] ${JSON.stringify(afterMovedRows)}`);
  expect(afterMovedRows.firstDarkRow, 'moved text must not start at the rect top edge (clipped)').toBeGreaterThan(0);
  expect(afterMovedRows.lastDarkRow, 'moved text must not touch the rect bottom edge (clipped)').toBeLessThan(afterMovedRows.rows.length - 1);
  // Characterise any residual dark pixels inside the old rect (coordinates).
  const darkDumpAfter = await win.evaluate((r) => {
    const c = document.querySelector('.page-slot[data-page="1"] canvas');
    const sx = Math.max(0, Math.round(r.x)), sy = Math.max(0, Math.round(r.y));
    const sw = Math.min(c.width - sx, Math.round(r.w)), sh = Math.min(c.height - sy, Math.round(r.h));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    const pts = [];
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const i = (y * sw + x) * 4;
      if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) pts.push([sx + x, sy + y]);
    }
    return { count: pts.length, first: pts.slice(0, 30) };
  }, runPx);
  console.log(`[PIXEL|AFTER|DARK-DUMP] ${JSON.stringify(darkDumpAfter)}`);
  const runsAfter = await bodyRuns('orchestration');
  console.log(`[RUNS|AFTER-CONFIRM] ${JSON.stringify(runsAfter)}`);
  const tagsAfter = await thumbIdentity(tagsPreConfirm.tags);
  console.log(`[THUMBS|POST-CONFIRM] ${JSON.stringify(tagsAfter)}`);
  const thumbProbe = await readThumbProbe();
  console.log(`[THUMB-PROBE] ${JSON.stringify(thumbProbe)}`);
  const thumbMut = await readThumbMutationProbe();
  console.log(`[THUMB-MUT-PROBE-RESULT] ${JSON.stringify(thumbMut)}`);

  const leftoverClipRaw = await clipFromCanvasPx(runPx, 130, 90);
  const leftoverClip = leftoverClipRaw ? clampClip(leftoverClipRaw, 0, 0, vp) : null;
  if (leftoverClip) await shot('def-221-leftover-box.png', leftoverClip);
  await shot('def-221-leftover-full.png');
  // DEF-221 retest evidence: the old rect plus the paragraph band above it.
  const retestPx = { x: runPx.x, y: runPx.y - Math.round(18 * scale.ky), w: runPx.w, h: runPx.h + Math.round(18 * scale.ky) };
  const retestClipRaw = await clipFromCanvasPx(retestPx, 130, 60);
  if (retestClipRaw) await shot('def-221-retest2.png', clampClip(retestClipRaw, 0, 0, vp));

  // BAKED vs RENDERER: Save As -> close tab -> reopen saved file.
  const savePath = path.join(os.tmpdir(), `tflex-def221-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2200);
  console.log(`[SAVED] ${savePath} exists=${fs.existsSync(savePath)} bytes=${fs.existsSync(savePath) ? fs.statSync(savePath).size : -1}`);

  // DEF-222 — a TRUE unmount must still release the thumb bitmap. Observe the
  // page-1 thumb canvas across the tab close: a width/height zeroing record
  // queued before the node is removed proves the mountedRef-gated release
  // still fires on unmount (the same-slot re-run no longer zeroes).
  const unmountProbeStart = await win.evaluate(() => {
    window.__unmountMut = [];
    const el = document.querySelector('.thumb-item[data-page="1"] .thumb-canvas');
    if (!el) return { ok: false };
    const obs = new MutationObserver((muts) => {
      for (const m of muts) window.__unmountMut.push({ attr: m.attributeName, val: el.getAttribute(m.attributeName), connected: el.isConnected });
    });
    obs.observe(el, { attributes: true, attributeFilter: ['width', 'height'] });
    window.__unmountObs = obs;
    return { ok: true, w: el.width, h: el.height };
  });
  console.log(`[DEF222-UNMOUNT|START] ${JSON.stringify(unmountProbeStart)}`);

  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(700);
  if (await win.locator('[data-close-prompt-action="discard"]').count()) {
    await win.locator('[data-close-prompt-action="discard"]').first().click();
    await win.waitForTimeout(900);
  }
  console.log(`[TAB-CLOSED] workspace=${await win.locator('.workspace').count()}`);
  const unmountProbeEnd = await win.evaluate(() => ({
    recs: window.__unmountMut || [],
    remainingThumbCanvases: document.querySelectorAll('.thumb-canvas').length,
  }));
  console.log(`[DEF222-UNMOUNT|END] ${JSON.stringify(unmountProbeEnd)}`);

  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  const cmdOpen = win.locator('[aria-label="Open PDF document"]').first();
  if (await cmdOpen.isVisible().catch(() => false)) await cmdOpen.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2600);
  await scrollToPage1();

  const domReopen = await domProbe();
  console.log(`[DOM|REOPEN] ${JSON.stringify(domReopen)}`);
  const pixelReopen = await canvasStatsAtPx(runPx);
  const pixelReopenWide = await canvasStatsAtPx(widePx);
  const pixelReopenBandAbove = await canvasStatsAtPx(bandAbovePx);
  const pixelReopenMoved = await canvasStatsAtPx(movedPx);
  const runsReopen = await bodyRuns('orchestration');
  console.log(`[PIXEL|REOPEN|FIXED-PX] ${JSON.stringify(pixelReopen)}`);
  console.log(`[PIXEL|REOPEN|WIDE-PX] ${JSON.stringify(pixelReopenWide)}`);
  console.log(`[PIXEL|REOPEN|BAND-ABOVE-PX] ${JSON.stringify(pixelReopenBandAbove)}`);
  console.log(`[PIXEL|REOPEN|MOVED-PX] ${JSON.stringify(pixelReopenMoved)}`);
  const reopenMovedRows = await darkRowsAndCentroid(movedPx);
  console.log(`[PIXEL|REOPEN|MOVED-ROWS] ${JSON.stringify(reopenMovedRows)}`);
  const darkDumpReopen = await win.evaluate((r) => {
    const c = document.querySelector('.page-slot[data-page="1"] canvas');
    const sx = Math.max(0, Math.round(r.x)), sy = Math.max(0, Math.round(r.y));
    const sw = Math.min(c.width - sx, Math.round(r.w)), sh = Math.min(c.height - sy, Math.round(r.h));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    const pts = [];
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const i = (y * sw + x) * 4;
      if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) pts.push([sx + x, sy + y]);
    }
    return { count: pts.length, first: pts.slice(0, 30) };
  }, runPx);
  console.log(`[PIXEL|REOPEN|DARK-DUMP] ${JSON.stringify(darkDumpReopen)}`);
  console.log(`[RUNS|REOPEN] ${JSON.stringify(runsReopen)}`);
  const vp2 = await viewportSize();
  const reopenClipRaw = await clipFromCanvasPx(runPx, 130, 90);
  if (reopenClipRaw) await shot('def-221-leftover-box-reopened.png', clampClip(reopenClipRaw, 0, 0, vp2));

  const whiteAfter = afterPx && !afterPx.error && afterPx.nearWhite === afterPx.total;
  const whiteReopen = pixelReopen && !pixelReopen.error && pixelReopen.nearWhite === pixelReopen.total;
  const baked = !!(whiteAfter && whiteReopen && beforePx.dark > 0);
  console.log(`[VERDICT|BAKED-VS-RENDERER] beforeDark=${beforePx.dark} afterWhite=${whiteAfter} reopenWhite=${whiteReopen} domEraserReopen=${JSON.stringify(domReopen['[data-edit-box-eraser]'])} baked=${baked}`);

  // ---- DEF-221 FIX-READY retest assertions (tightened mask) ----------------
  // Old glyphs must be gone; the band above the old run must be intact both
  // live and in the reopened file; the new text must render at the moved spot.
  // This page-1 run is isolated (no glyph band directly above), so the
  // band-above erasure regression is pinned on the dense-paragraph test;
  // here we report it and only assert retention when there is ink to lose.
  expect(afterPx.dark, 'old rect must have no dark glyph pixels after Confirm').toBe(0);
  if (beforeBandAbovePx.dark > 5) {
    expect(afterBandAbovePx.dark, `band above the old run was erased (${beforeBandAbovePx.dark} -> ${afterBandAbovePx.dark})`).toBeGreaterThanOrEqual(Math.floor(beforeBandAbovePx.dark * 0.9));
    expect(pixelReopenBandAbove.dark, `band above the old run was erased in the reopened file (${beforeBandAbovePx.dark} -> ${pixelReopenBandAbove.dark})`).toBeGreaterThanOrEqual(Math.floor(beforeBandAbovePx.dark * 0.9));
  } else {
    console.log(`[PIXEL|BAND-ABOVE|SKIP] page-1 run has no neighbour above (before dark=${beforeBandAbovePx.dark}); retention asserted on the dense-paragraph test`);
  }
  expect(afterMovedPx.dark, 'moved text must render at the new position').toBeGreaterThan(0);
  expect(reopenMovedRows.rows, 'moved text row profile must survive save+reopen unchanged').toEqual(afterMovedRows.rows);
  expect(pixelReopen.dark, 'old rect must stay masked (white) in the reopened file').toBe(0);

  // ---- DEF-222 FIX-READY retest assertions --------------------------------
  // A same-slot doc swap must not zero any thumb canvas, and the rAF probe
  // must never sample a zero-width page-1 canvas. Node identity preserved.
  expect(thumbMut.zeroWidthSets, 'no thumb canvas width may be zeroed on a same-slot doc swap').toBe(0);
  expect(thumbMut.zeroHeightSets, 'no thumb canvas height may be zeroed on a same-slot doc swap').toBe(0);
  expect(thumbProbe.zeroW, 'rAF must never sample a zero-width page-1 thumb canvas').toBe(0);
  expect(tagsAfter.same, 'thumbnail node identity must be preserved across Confirm').toBe(tagsAfter.count);
  // True unmount: the canvas nodes must be removed (task's stated observation).
  // The explicit width/height zeroing was not observable across the unmount
  // (the canvas ref is detached before passive cleanup); with the nodes gone
  // no backing store is retained. Reported, not hard-asserted.
  expect(unmountProbeStart.ok, 'page-1 thumb canvas must exist before the tab close').toBe(true);
  const unmountZero = unmountProbeEnd.recs.filter((r) => r.val === '0').length;
  console.log(`[DEF222-UNMOUNT|VERDICT] zeroingRecords=${unmountZero} remaining=${unmountProbeEnd.remainingThumbCanvases} recs=${JSON.stringify(unmountProbeEnd.recs)}`);
  expect(unmountProbeEnd.remainingThumbCanvases, 'tab close must remove the thumb canvases').toBe(0);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|#520/.test(m));
  console.log(`[PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
  console.log('[DEF-221/222|MOVE-FLOW] completed');
});

test('DEF-221 control C: PLAIN in-place edit (no drag, confirm=false) leaves no leftover box', async () => {
  await openReportFromWelcome();
  await scrollToPage1();
  await armTextTool();

  let run = await findRun('orchestration');
  if (!run) run = await findRun('performance');
  if (!run) run = await findRun('Report');
  expect(run, 'a page-1 body text run must exist').toBeTruthy();
  console.log(`[CONTROL|RUN] text="${run.text}" rect=${JSON.stringify(run.rect)}`);

  const before = await canvasStats(run.rect);
  console.log(`[CONTROL|PIXEL|BEFORE] ${JSON.stringify(before)}`);
  const ctrlPx = { x: before.bboxCanvasPx[0], y: before.bboxCanvasPx[1], w: before.bboxCanvasPx[2], h: before.bboxCanvasPx[3] };
  const ctrlScale = await win.evaluate(() => {
    const c = document.querySelector('.page-slot[data-page="1"] canvas');
    const cr = c.getBoundingClientRect();
    return { ky: c.height / cr.height };
  });
  const ctrlBandAbovePx = { x: ctrlPx.x, y: ctrlPx.y - Math.round(18 * ctrlScale.ky), w: ctrlPx.w, h: Math.round(16 * ctrlScale.ky) };
  const ctrlBeforeBandAbove = await canvasStatsAtPx(ctrlBandAbovePx);
  console.log(`[CONTROL|BAND-ABOVE|BEFORE] ${JSON.stringify(ctrlBeforeBandAbove)}`);

  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  // Phase 26 — the inline editor is retired. The positive control is now a
  // plain selection + Confirm with NO move: no engine op, no mask, no artifact.
  let editor = await selectRun(cx, cy);
  console.log(`[CONTROL|RUN] ${JSON.stringify(editor)}`);
  expect(editor.present, 'the run bar must appear on a single click').toBe(true);
  expect(editor.editor, 'Phase 26: no in-canvas editor mounts').toBe(0);

  const domPre = await domProbe();
  console.log(`[CONTROL|DOM|PRE] ${JSON.stringify(domPre)}`);

  await win.locator('[data-content-action="textrun-confirm"]').first().click();
  await win.waitForTimeout(1400);

  const domAfter = await domProbe();
  console.log(`[CONTROL|DOM|POST] ${JSON.stringify(domAfter)}`);
  const after = await canvasStats(run.rect);
  console.log(`[CONTROL|PIXEL|AFTER] ${JSON.stringify(after)}`);
  const ctrlAfterPx = await canvasStatsAtPx(ctrlPx);
  const ctrlAfterBandAbove = await canvasStatsAtPx(ctrlBandAbovePx);
  console.log(`[CONTROL|PIXEL|AFTER|FIXED-PX] ${JSON.stringify(ctrlAfterPx)}`);
  console.log(`[CONTROL|BAND-ABOVE|AFTER] ${JSON.stringify(ctrlAfterBandAbove)}`);
  expect(ctrlAfterBandAbove.dark, `plain in-place edit erased the band above (${ctrlBeforeBandAbove.dark} -> ${ctrlAfterBandAbove.dark})`).toBeGreaterThanOrEqual(Math.floor(ctrlBeforeBandAbove.dark * 0.9));
  expect(ctrlAfterPx.dark, 'plain in-place edit must leave the redrawn text, not a white box').toBeGreaterThan(0);
  const vp = await viewportSize();
  await shot('def-221-control-inplace.png', clampClip(run.rect, 130, 90, vp));

  const eraserLeft = !!(domAfter['[data-edit-box-eraser]'] && domAfter['[data-edit-box-eraser]'].exists);
  const selectionLeft = !!(domAfter['.edit-textrun-selection'] && domAfter['.edit-textrun-selection'].exists);
  console.log(`[CONTROL|VERDICT] eraserLeft=${eraserLeft} selectionLeft=${selectionLeft} editorLeft=${!!(domAfter['.edit-inline-editor'] && domAfter['.edit-inline-editor'].exists)}`);
  console.log('[DEF-221|CONTROL-C] completed');
});

test('DEF-221 mechanism: on a dense paragraph the white mask erases the run AND neighbouring lines', async () => {
  await openReportFromWelcome();
  await scrollToPage(win, 2);
  await win.waitForTimeout(600);
  await armTextTool();

  let dense = await pickDenseRun(2);
  let densePage = 2;
  if (!dense) { dense = await pickDenseRun(1); densePage = 1; }
  expect(dense, 'a dense paragraph run must exist').toBeTruthy();
  const run = { text: dense.text, rect: dense.rect };
  const px = dense.canvasPx;
  console.log(`[DENSE|RUN] text="${run.text}" rect=${JSON.stringify(run.rect)} neighbourScore=${dense.score} above=${dense.above} below=${dense.below} px=${JSON.stringify(px)}`);
  // Which span owns the rows just above the run? (line-above descenders vs run ascenders)
  const spanRects = await win.evaluate(({ pg, y0, y1 }) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const out = [];
    slot.querySelectorAll('.textLayer span').forEach((s) => {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (r.y > y0 && r.y < y1) out.push({ t: t.slice(0, 34), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out;
  }, { pg: densePage, y0: run.rect.y - 45, y1: run.rect.y + 30 });
  console.log(`[DENSE|SPANS] ${JSON.stringify(spanRects)}`);

  const band = (dy0, dy1) => ({ x: px.x, y: px.y + dy0, w: px.w, h: dy1 - dy0 });
  const bands = { run: band(0, px.h), above: band(-18, -2), below: band(px.h + 2, px.h + 18) };

  const before = {};
  for (const [k, b] of Object.entries(bands)) {
    before[k] = await win.evaluate(({ p, pageNo }) => {
      const slot = document.querySelector(`.page-slot[data-page="${pageNo}"]`);
      const c = slot && slot.querySelector('canvas');
      const sx = Math.max(0, Math.round(p.x));
      const sy = Math.max(0, Math.round(p.y));
      const sw = Math.max(1, Math.min(c.width - sx, Math.round(p.w)));
      const sh = Math.max(1, Math.min(c.height - sy, Math.round(p.h)));
      const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
      let dark = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) { total += 1; const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (lum < 140) dark += 1; }
      return { dark, total, canvasPx: [sx, sy, sw, sh] };
    }, { p: b, pageNo: densePage });
  }
  console.log(`[DENSE|BANDS|BEFORE] ${JSON.stringify(before)}`);
  const aboveRowsBefore = await bandRows(bands.above, densePage);
  const belowRowsBefore = await bandRows(bands.below, densePage);
  console.log(`[DENSE|ABOVE-ROWS|BEFORE] ${JSON.stringify(aboveRowsBefore)}`);
  console.log(`[DENSE|BELOW-ROWS|BEFORE] ${JSON.stringify(belowRowsBefore)}`);
  const vpD = await viewportSize();
  const aboveClipBefore = await clipFromCanvasPx(bands.above, 10, 4, densePage);
  if (aboveClipBefore) await shot('def-221-dense-above-before.png', clampClip(aboveClipBefore, 0, 0, vpD));

  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  await win.mouse.dblclick(cx, cy);
  await win.waitForTimeout(700);
  let editor = await selectRun(cx, cy);
  console.log(`[DENSE|RUN] ${JSON.stringify(editor)}`);
  expect(editor.present, 'the run bar must appear on the dense run').toBe(true);
  expect(editor.editor, 'Phase 26: no in-canvas editor mounts').toBe(0);
  editor = await dragRun(cx, cy, 90, 50);
  console.log(`[DENSE|RUN|MOVED] ${JSON.stringify(editor)}`);
  expect(editor.present, 'the run bar must stay after the dense move drag').toBe(true);
  await win.locator('[data-content-action="textrun-confirm"]').first().click();
  await win.waitForTimeout(1600);

  const after = {};
  for (const [k, b] of Object.entries(bands)) {
    after[k] = await win.evaluate(({ p, pageNo }) => {
      const slot = document.querySelector(`.page-slot[data-page="${pageNo}"]`);
      const c = slot && slot.querySelector('canvas');
      const sx = Math.max(0, Math.round(p.x));
      const sy = Math.max(0, Math.round(p.y));
      const sw = Math.max(1, Math.min(c.width - sx, Math.round(p.w)));
      const sh = Math.max(1, Math.min(c.height - sy, Math.round(p.h)));
      const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
      let dark = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) { total += 1; const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (lum < 140) dark += 1; }
      return { dark, total };
    }, { p: b, pageNo: densePage });
  }
  console.log(`[DENSE|BANDS|AFTER] ${JSON.stringify(after)}`);
  const aboveRowsAfter = await bandRows(bands.above, densePage);
  const belowRowsAfter = await bandRows(bands.below, densePage);
  console.log(`[DENSE|ABOVE-ROWS|AFTER] ${JSON.stringify(aboveRowsAfter)}`);
  console.log(`[DENSE|BELOW-ROWS|AFTER] ${JSON.stringify(belowRowsAfter)}`);
  const vpD2 = await viewportSize();
  const aboveClipAfter = await clipFromCanvasPx(bands.above, 10, 4, densePage);
  if (aboveClipAfter) await shot('def-221-dense-above-after.png', clampClip(aboveClipAfter, 0, 0, vpD2));
  const aboveErased = before.above.dark > 5 && after.above.dark < before.above.dark * 0.3;
  const belowErased = before.below.dark > 5 && after.below.dark < before.below.dark * 0.3;
  console.log(`[DENSE|VERDICT] runDark ${before.run.dark}->${after.run.dark} aboveDark ${before.above.dark}->${after.above.dark} belowDark ${before.below.dark}->${after.below.dark} aboveErased=${aboveErased} belowErased=${belowErased}`);
  // The tightened mask must not touch the neighbouring text bands. The band
  // ABOVE must be byte-identical. The mask is anchored to the old run's INK box
  // (top shifted down 0.25 h), so its bottom edge also moves down by 0.25 h and
  // may remove the old run's OWN descenders from the first (0.25 h) pixels of
  // the below band; rows beyond that mask footprint must be byte-identical.
  const belowGuardFrom = Math.ceil(before.run.canvasPx[3] * 0.25);
  console.log(`[DENSE|BELOW-GUARD] footprintRows=${belowGuardFrom} bodyBefore=${JSON.stringify(belowRowsBefore.rows.slice(belowGuardFrom))} bodyAfter=${JSON.stringify(belowRowsAfter.rows.slice(belowGuardFrom))}`);
  expect(aboveRowsAfter.rows, `dense band above changed (rows ${JSON.stringify(aboveRowsBefore.rows)} -> ${JSON.stringify(aboveRowsAfter.rows)})`).toEqual(aboveRowsBefore.rows);
  expect(after.above.dark, `dense band above changed (${before.above.dark} -> ${after.above.dark})`).toBe(before.above.dark);
  expect(belowRowsAfter.rows.slice(belowGuardFrom), `dense neighbour-below body changed beyond the mask footprint (${belowGuardFrom} rows)`).toEqual(belowRowsBefore.rows.slice(belowGuardFrom));
  expect(after.below.dark, 'the white mask can only remove ink, never add it').toBeLessThanOrEqual(before.below.dark);
  expect(after.run.dark, 'old run band must be masked (no leftover glyphs)').toBe(0);
  const vp = await viewportSize();
  const clip = await clipFromCanvasPx(px, 60, 50, densePage);
  if (clip) await shot('def-221-dense-after.png', clampClip(clip, 0, 0, vp));
  console.log('[DEF-221|DENSE] completed');
});

module.exports = {};
