// Phase 32 — Multi Mode e2e (spec 4 of 4): smoothness + responsiveness +
// close/quit safety.
//
// Criterion 6 (NO FLICKER): in-page ~16ms frame sampling across
//   (i) toggling Multi Mode, (ii) switching pane focus, (iii) dragging the
//   divider, (iv) starting and completing a cross-document drag.
//   For each: no blank/white frame in a pane's page canvas, no
//   .page-placeholder flash, and no re-raster of the UNAFFECTED pane
//   (asserted by an unchanged 32x32 bitmap signature).
// Criterion 7 (RESPONSIVENESS): rAF frame counting while scrolling,
//   focusing and dragging with two 34-page documents; mode-toggle and
//   pane-focus settle timings.
// Criterion 8 (CLOSE/QUIT SAFETY): the window-close gate walks BOTH panes'
//   modified documents in turn; Cancel aborts with both intact; closing a
//   tab whose document is in a pane falls back to the empty state; closing
//   the last tab returns to single-pane.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT_SRC = path.join(FIX, 'report.pdf'); // 34 pages
const TMP = path.join(os.tmpdir(), 'tflex-p32');

let electronApp = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}
async function mockOpen(p) {
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}
async function openFile(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}
async function waitTabCount(n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}
function headerLoc(pane) {
  return win.locator(`.multi-pane-header[data-pane="${pane}"]`);
}
async function paneCount(pane) {
  const raw = await headerLoc(pane).innerText();
  const m = raw.match(/(\d+)\s+pages?/);
  return m ? Number(m[1]) : null;
}
// Focus a pane through its PAGE AREA (the pane's own pointerdown-capture
// focus). The pane HEADER is the other documented focus path, but the Phase 33
// shared toolbar currently overlays it (DEF-282); the header path is asserted
// by phase33_multi_toolbar.spec.cjs, so this spec uses the page path and keeps
// its actual subject - flicker, responsiveness and the close/quit gate -
// testable.
async function focusPane(pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPane: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width / 2, vp.w - 30));
  const y = Math.max(70, Math.min(box.y + box.height / 2, vp.h - 30));
  await win.mouse.click(x, y);
  await win.waitForTimeout(300);
}

// Two 34-page documents (report.pdf twice), both panes filled.
// Amended Phase 32 semantics (DEF-277): a title-bar Open while the mode is on
// assigns the document to the FOCUSED pane, so the second document is opened
// in single mode first; alpha is then made active before the mode is turned on
// (pane A = alpha) and beta is picked into pane B.
async function twoPaneSetup() {
  await openFile(tmpCopy(REPORT_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await openFile(tmpCopy(REPORT_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(500);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}

// ---- in-page frame sampler (16ms cadence, mirrors the DEF-274 probe) ----
// `probes` is [{ key, sel }] where sel is a pane-element selector. Per probe:
// the page-1 canvas presence/size/ink, the .page-placeholder count, and a
// 32x32 grey bitmap signature used to detect a re-raster.
async function sampleTimeline(durationMs, intervalMs, probes) {
  return win.evaluate(async ({ duration, interval, probeList }) => {
    const canvasSig = (canvas) => {
      if (!canvas) return null;
      const W = 32;
      const H = 32;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const ctx = off.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(canvas, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      let ink = 0;
      let hash = 0;
      const vals = [];
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.round((d[i] + d[i + 1] + d[i + 2]) / 3);
        vals.push(v);
        if (v < 245) ink += 1;
      }
      for (let i = 0; i < vals.length; i += 1) hash = (hash * 31 + vals[i]) | 0;
      return { ink, hash };
    };
    const readProbe = (sel) => {
      const paneEl = document.querySelector(sel);
      const canvas = paneEl ? paneEl.querySelector('.page-slot[data-page="1"] canvas.pdf-page-canvas') : null;
      const ph = paneEl ? paneEl.querySelectorAll('.page-slot[data-page="1"] .page-placeholder').length : 0;
      const sig = canvasSig(canvas);
      return {
        present: !!canvas,
        w: canvas ? canvas.width : 0,
        h: canvas ? canvas.height : 0,
        ink: sig ? sig.ink : null,
        hash: sig ? sig.hash : null,
        placeholder: ph,
      };
    };
    const samples = [];
    const tick = () => {
      const rec = { t: Math.round(performance.now()) };
      for (const p of probeList) rec[p.key] = readProbe(p.sel);
      samples.push(rec);
    };
    tick();
    const id = setInterval(tick, interval);
    await new Promise((r) => setTimeout(r, duration));
    clearInterval(id);
    tick();
    return samples;
  }, { duration: durationMs, interval: intervalMs, probeList: probes });
}

const PROBE_A = { key: 'A', sel: '.tab-pane[data-pane="A"]' };
const PROBE_B = { key: 'B', sel: '.tab-pane[data-pane="B"]' };
// The single VISIBLE tab-pane: pane A in Multi Mode, the active tab in single
// mode. Tracks "the pane the user is looking at" across a mode toggle.
const PROBE_VISIBLE = { key: 'V', sel: '.tab-pane[aria-hidden="false"]' };

// Analyse one pane's samples: blank frames, placeholder frames, bitmap
// changes, and the number of distinct bitmap signatures seen.
function analyse(samples, pane) {
  const withCanvas = samples.filter((s) => s[pane].present);
  const blank = withCanvas.filter((s) => s[pane].ink === 0);
  const placeholders = samples.filter((s) => s[pane].placeholder > 0);
  const hashes = [];
  for (const s of withCanvas) {
    if (hashes.length === 0 || hashes[hashes.length - 1] !== s[pane].hash) hashes.push(s[pane].hash);
  }
  return { total: samples.length, withCanvas: withCanvas.length, blank, placeholders, distinctHashes: hashes.length, hashes };
}

function logAnalyse(label, pane, a) {
  console.log(
    `[P32-flicker] ${label} pane ${pane}: samples=${a.total} withCanvas=${a.withCanvas} blank=${a.blank.length} placeholder=${a.placeholders.length} distinctBitmaps=${a.distinctHashes}`,
  );
}

// ---- rAF frame counter -------------------------------------------------
async function rafProbe(durationMs) {
  return win.evaluate(async (dur) => {
    const t0 = performance.now();
    let frames = 0;
    let last = t0;
    let maxGap = 0;
    const gaps = [];
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        frames += 1;
        const gap = now - last;
        last = now;
        if (frames > 1) {
          gaps.push(gap);
          if (gap > maxGap) maxGap = gap;
        }
        if (now - t0 >= dur) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return {
      frames,
      elapsed: Math.round(performance.now() - t0),
      maxGap: Math.round(maxGap),
      p95Gap: gaps.length ? Math.round(gaps[Math.floor(gaps.length * 0.95)]) : null,
      avgGap: gaps.length ? Number((gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(1)) : null,
    };
  }, durationMs);
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(300000);

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

// Synthetic drag step (real DataTransfer) used to hold the app in a
// dragging state so the mid-drag affordances can be sampled/screenshotted.
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p32dt2';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const ev = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height * 0.25,
      });
      tgt.dispatchEvent(ev);
      return { ok: true, prevented: ev.defaultPrevented };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}

test('F1 no flicker: toggling Multi Mode on and off', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.waitForTimeout(700);

  // OFF
  let p = sampleTimeline(1600, 16, [PROBE_VISIBLE]);
  await win.waitForTimeout(80);
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  let s = await p;
  let a = analyse(s, 'V');
  logAnalyse('F1 toggle OFF', 'V', a);
  expect(a.withCanvas).toBeGreaterThan(50);
  expect(a.blank.length, `blank frames on toggle OFF: ${JSON.stringify(a.blank.slice(0, 3))}`).toBe(0);
  expect(a.placeholders.length).toBe(0);

  // ON again
  p = sampleTimeline(1600, 16, [PROBE_VISIBLE]);
  await win.waitForTimeout(80);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  s = await p;
  a = analyse(s, 'V');
  logAnalyse('F1 toggle ON', 'V', a);
  expect(a.blank.length, `blank frames on toggle ON: ${JSON.stringify(a.blank.slice(0, 3))}`).toBe(0);
  expect(a.placeholders.length).toBe(0);
});

test('F2 no flicker / no re-raster of the unfocused pane: switching focus', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.waitForTimeout(700);
  const p = sampleTimeline(2200, 16, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(80);
  await focusPane('B');
  await win.waitForTimeout(450);
  await focusPane('A');
  await win.waitForTimeout(450);
  await focusPane('B');
  const s = await p;
  const aA = analyse(s, 'A');
  const aB = analyse(s, 'B');
  logAnalyse('F2 focus switch', 'A', aA);
  logAnalyse('F2 focus switch', 'B', aB);
  expect(aA.blank.length).toBe(0);
  expect(aB.blank.length).toBe(0);
  expect(aA.placeholders.length).toBe(0);
  expect(aB.placeholders.length).toBe(0);
  // A focus change must not re-raster either canvas.
  expect(aA.distinctHashes, `pane A re-rastered on focus change (${aA.distinctHashes} bitmaps)`).toBe(1);
  expect(aB.distinctHashes, `pane B re-rastered on focus change (${aB.distinctHashes} bitmaps)`).toBe(1);
});

test('F3 no flicker: dragging the divider', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const divider = win.locator('[data-multi-divider]');
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();
  const p = sampleTimeline(2200, 16, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(80);
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await win.mouse.move(box.x + box.width / 2 + i * 28, box.y + box.height / 2);
    await win.waitForTimeout(35);
  }
  await win.mouse.up();
  const s = await p;
  const aA = analyse(s, 'A');
  const aB = analyse(s, 'B');
  logAnalyse('F3 divider', 'A', aA);
  logAnalyse('F3 divider', 'B', aB);
  expect(aA.blank.length).toBe(0);
  expect(aB.blank.length).toBe(0);
  expect(aA.placeholders.length).toBe(0);
  expect(aB.placeholders.length).toBe(0);
});

test('F4 no flicker: starting, hovering and completing a cross-document drag', async () => {
  await twoPaneSetup();
  await win.waitForTimeout(700);
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');

  // (a) hover-only: the SOURCE pane A is unaffected, so it must not re-raster.
  let p = sampleTimeline(1800, 16, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(80);
  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(200);
  await synthStep('over', { tgt: '[data-pane-strip-pane="B"] .thumb-item[data-page="3"]' });
  await win.waitForTimeout(600);
  let s = await p;
  let aA = analyse(s, 'A');
  let aB = analyse(s, 'B');
  logAnalyse('F4 drag hover', 'A', aA);
  logAnalyse('F4 drag hover', 'B', aB);
  expect(aA.blank.length).toBe(0);
  expect(aB.blank.length).toBe(0);
  expect(aA.placeholders.length).toBe(0);
  expect(aB.placeholders.length).toBe(0);
  expect(aA.distinctHashes, `source pane A re-rastered while hovering the target (${aA.distinctHashes})`).toBe(1);
  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(300);

  // (b) complete a MOVE (both documents change legitimately): no blank frame.
  p = sampleTimeline(2200, 16, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(80);
  await win.locator('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]').first()
    .dragTo(win.locator('[data-pane-strip-pane="B"] .thumb-item[data-page="2"]').first(), { timeout: 8000 });
  s = await p;
  aA = analyse(s, 'A');
  aB = analyse(s, 'B');
  logAnalyse('F4 drag drop', 'A', aA);
  logAnalyse('F4 drag drop', 'B', aB);
  expect(aA.blank.length).toBe(0);
  expect(aB.blank.length).toBe(0);
  expect(aA.placeholders.length).toBe(0);
  expect(aB.placeholders.length).toBe(0);
  await win.waitForTimeout(2000);
  const a1 = await paneCount('A');
  const b1 = await paneCount('B');
  console.log(`[P32-flicker] F4 counts A ${a0}->${a1} B ${b0}->${b1}`);
  expect(a1).toBe(33);
  expect(b1).toBe(35);
});

test('F5 visual captures: two-pane, mid-drag, single-mode', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.waitForTimeout(900);
  await win.screenshot({ path: path.join(SHOTS, 'phase32-two-pane.png') });
  console.log('[P32-flicker] captured screenshots/phase32-two-pane.png');

  // Mid-drag: hold the drag state so the source thumb, the highlighted
  // target section AND the canvas insertion indicator are all visible.
  // Scroll pane B so the page-1/page-2 boundary sits mid-viewport, then
  // hover the upper half of page 2: the "before page 2" indicator lands in
  // the visible gap between the two pages.
  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="2"]' });
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
    const slot = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="2"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 140;
  });
  await win.waitForTimeout(700);
  await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="2"]' });
  await win.waitForTimeout(600);
  const dragAff = await win.evaluate(() => {
    const ind = document.querySelector('[data-drop-indicator]');
    const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
    const r = ind ? ind.getBoundingClientRect() : null;
    const sr = sc ? sc.getBoundingClientRect() : null;
    return {
      indicators: Array.from(document.querySelectorAll('[data-drop-indicator]')).map((el) => ({
        side: el.getAttribute('data-drop-indicator'),
        page: el.getAttribute('data-drop-page'),
      })),
      indicatorRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      scrollerRect: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom) } : null,
      indicatorVisible: !!(r && sr && r.top >= sr.top && r.bottom <= sr.bottom),
      thumbDragging: !!document.querySelector('.thumb-dragging'),
      thumbDropTarget: !!document.querySelector('.thumb-drop-target'),
      sectionDropTarget: !!document.querySelector('[data-pane-strip-drop-target="true"]'),
      dropPane: !!document.querySelector('.document-scroller[data-page-drop-pane="true"]'),
    };
  });
  console.log(`[P32-flicker] drag screenshot state: ${JSON.stringify(dragAff)}`);
  await win.screenshot({ path: path.join(SHOTS, 'phase32-drag.png') });
  console.log('[P32-flicker] captured screenshots/phase32-drag.png');
  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="2"]' });
  await win.waitForTimeout(300);

  // Mode off: unchanged single-pane layout.
  await focusPane('A');
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(900);
  await win.screenshot({ path: path.join(SHOTS, 'phase32-single-mode.png') });
  console.log('[P32-flicker] captured screenshots/phase32-single-mode.png');
});

// ---- main-thread liveness (setInterval cadence, rAF-throttling-proof) ----
async function livenessProbe(durationMs) {
  return win.evaluate(async (dur) => {
    const t0 = performance.now();
    let ticks = 0;
    let last = t0;
    let maxGap = 0;
    await new Promise((resolve) => {
      const id = setInterval(() => {
        const now = performance.now();
        const gap = now - last;
        last = now;
        ticks += 1;
        if (gap > maxGap) maxGap = gap;
        if (now - t0 >= dur) {
          clearInterval(id);
          resolve();
        }
      }, 16);
    });
    return { ticks, elapsed: Math.round(performance.now() - t0), maxGap: Math.round(maxGap) };
  }, durationMs);
}

// Time from a real click to the second animation frame after it (state settle).
async function clickSettleMs(selector) {
  const timing = win.evaluate(
    (sel) => new Promise((resolve) => {
      const el = document.querySelector(sel);
      if (!el) return resolve(-1);
      el.addEventListener(
        'click',
        () => {
          const t0 = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
        },
        { capture: true, once: true },
      );
    }),
    selector,
  );
  await win.locator(selector).first().click();
  return timing;
}

test('B1 responsiveness: two 34-page docs - scroll, focus, drag (rAF + liveness)', async () => {
  await twoPaneSetup();
  await win.bringToFront().catch(() => {});
  await win.waitForTimeout(900);

  // --- scroll pane A + switch focus, sampled ---
  let raf = rafProbe(2600);
  let live = livenessProbe(2600);
  await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="A"] .document-scroller');
    if (sc) for (let i = 0; i < 60; i += 1) sc.scrollTop += 40;
  });
  await focusPane('B');
  await focusPane('A');
  const r1 = await raf;
  const l1 = await live;
  console.log(`[P32-resp] scroll+focus: rAF ${JSON.stringify(r1)} liveness ${JSON.stringify(l1)}`);

  // --- divider drag ---
  const dbox = await win.locator('[data-multi-divider]').boundingBox();
  raf = rafProbe(2600);
  live = livenessProbe(2600);
  await win.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await win.mouse.move(dbox.x + dbox.width / 2 + i * 24, dbox.y + dbox.height / 2);
    await win.waitForTimeout(30);
  }
  await win.mouse.up();
  const r2 = await raf;
  const l2 = await live;
  console.log(`[P32-resp] divider drag: rAF ${JSON.stringify(r2)} liveness ${JSON.stringify(l2)}`);

  // --- cross-document drag ---
  raf = rafProbe(3000);
  live = livenessProbe(3000);
  await win.locator('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]').first()
    .dragTo(win.locator('[data-pane-strip-pane="B"] .thumb-item[data-page="3"]').first(), { timeout: 8000 });
  const r3 = await raf;
  const l3 = await live;
  console.log(`[P32-resp] cross-doc drag: rAF ${JSON.stringify(r3)} liveness ${JSON.stringify(l3)}`);

  // --- mode-toggle and pane-focus settle timings ---
  const offMs = await clickSettleMs('[data-shared-toolbar] [data-toolbar-multi-mode]');
  await win.waitForTimeout(600);
  const onMs = await clickSettleMs('[data-toolbar-multi-mode]');
  await win.waitForTimeout(900);
  // Pane B starts empty again after the re-enable: fill it so a header exists.
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
  await win.waitForTimeout(1000);
  const focusMs = await clickSettleMs('.tab-pane[data-pane="B"] .pdf-page');
  console.log(`[P32-resp] settle ms: multiOFF=${offMs} multiON=${onMs} paneFocus=${focusMs}`);

  // No main-thread stall: the liveness cadence never gaps beyond 250ms.
  for (const [label, l] of [['scroll+focus', l1], ['divider', l2], ['cross-doc drag', l3]]) {
    expect(l.maxGap, `${label}: main thread stalled ${l.maxGap}ms`).toBeLessThan(250);
  }
  expect(offMs).toBeLessThan(600);
  expect(onMs).toBeLessThan(600);
  expect(focusMs).toBeLessThan(600);
});

test('CQ1 window close with BOTH panes modified: prompt covers both, Cancel aborts', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
  await focusPane('B');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);

  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.close();
  });
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  const body1 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  console.log(`[P32-close] CQ1 prompt 1: "${body1}"`);
  expect(body1).toMatch(/p32-(alpha|beta)/);

  await win.locator('[data-close-prompt-action="cancel"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-close-tab-prompt]').count()).toBe(0);
  expect(await win.locator('.tab-stage').count()).toBe(1);
  const a = await paneCount('A');
  const b = await paneCount('B');
  console.log(`[P32-close] CQ1 after Cancel: paneA=${a} paneB=${b}`);
  expect(a).toBe(34);
  expect(b).toBe(34);
});

test('CQ2 window close queue walks BOTH modified panes in turn', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
  await focusPane('B');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);

  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.close();
  });
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  const body1 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  console.log(`[P32-close] CQ2 prompt 1: "${body1}"`);
  expect(body1).toContain('p32-alpha');

  await win.locator('[data-close-prompt-action="discard"]').click();
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  await win.waitForTimeout(400);
  const body2 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  console.log(`[P32-close] CQ2 prompt 2: "${body2}"`);
  expect(body2).toContain('p32-beta');

  await win.locator('[data-close-prompt-action="cancel"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-close-tab-prompt]').count()).toBe(0);
  expect(await win.locator('.tab-stage').count()).toBe(1);
  const b = await paneCount('B');
  console.log(`[P32-close] CQ2 after Cancel on the 2nd prompt: paneB=${b}`);
  expect(b).toBe(34);
});

test('CQ3 closing a pane tab falls back to the empty state; last tab returns to single-pane', async () => {
  await twoPaneSetup();
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-beta' }).locator('.tab-close').click();
  await win.waitForTimeout(1200);

  expect(await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count()).toBe(1);
  expect(await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').count()).toBe(0);
  expect(await win.locator('[data-pane-strip-pane="B"]').count()).toBe(0);
  console.log(`[P32-close] CQ3 after closing pane B's tab: paneB empty=${await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count()} paneA=${await paneCount('A')}`);
  expect(await paneCount('A')).toBe(34);

  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).locator('.tab-close').click();
  await win.waitForTimeout(1400);
  console.log(`[P32-close] CQ3 after closing the last tab: tabs=${await win.locator('.tab[data-tab-id]').count()} panes=${await win.locator('[data-pane]').count()} multi=${await win.locator('.tab-stage').getAttribute('data-multi-mode')}`);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(0);
  expect(await win.locator('[data-pane]').count()).toBe(0);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');
  await expect(win.locator('.sample-card').first()).toBeVisible({ timeout: 15000 });
});