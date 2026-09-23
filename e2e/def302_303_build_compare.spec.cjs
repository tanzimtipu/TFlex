// qa focused BUILD-COMPARISON harness (2026-09-23).
//
// Operator reports DEF-302 (zoom rubber-band) and DEF-303 (window-state /
// caption lag) still persist on the INSTALLED build. 9b2bfca fixed both AFTER
// the 1.27.0 release, so the installed app is expected to predate the fixes.
// This harness measures the SAME behaviour on BOTH builds with the SAME
// methodology used in the original diagnosis:
//   - zoom sampler / FLIP deviation: e2e/phase35_zoom_diag.spec.cjs
//   - window probes / analyzeRun:    e2e/phase35_maximize_diag.spec.cjs
//
// Build A (installed): run with TFLEX_E2E_EXE pointing at the packaged exe.
// Build B (dev):       run with TFLEX_E2E_EXE unset (launchApp default).
//
// Diagnostic harness: assertions only prove the reproduction so it completes on
// BOTH builds; the [CMP-*] log lines are the evidence. It writes exactly ONE
// screenshot per build (def302-compare-<tag>.png), never the recorded
// def302-fixed-*.png images.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const BUILD = process.env.TFLEX_E2E_EXE ? 'installed' : 'dev';
const EXE = process.env.TFLEX_E2E_EXE || '(dev electron .)';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  if (BUILD === 'installed') await dismissUpdatePrompt(win);
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, `cmp-${BUILD}`);
  app = null;
  win = null;
});
test.setTimeout(300000);

async function versionTag() {
  const v = await app.evaluate(({ app: a }) => a.getVersion());
  return `build=${BUILD} exe=${EXE} appVersion=${v}`;
}

// Installed in the page. Identical to phase35_zoom_diag.spec.cjs installSampler
// (DEF-302 sampler): per rAF it records the page-1 SLOT layout rect and the
// .pdf-page VISUAL rect (transform applied), the transform scale, the canvas
// backing/CSS size, the scroller scrollTop, mount counts and the rAF delta.
function installSampler() {
  const zd = { samples: [], marks: [], textMuts: [], animStarts: [] };
  window.__zd = zd;
  const scroller = document.querySelector('.document-scroller');
  const q = (sel) => document.querySelector(sel);
  const scaleOf = (el) => {
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 1;
    try { return new DOMMatrixReadOnly(t).a; } catch (_) { return null; }
  };
  let last = performance.now();
  const sample = () => {
    const now = performance.now();
    const p = q('.pdf-page[data-page="1"]');
    const s = q('.page-slot[data-page="1"]');
    const c = q('.pdf-page[data-page="1"] .pdf-page-canvas');
    const pr = p ? p.getBoundingClientRect() : null;
    const cr = c ? c.getBoundingClientRect() : null;
    zd.samples.push({
      t: now,
      dt: now - last,
      slotTop: s ? s.offsetTop : null,
      slotH: s ? s.offsetHeight : null,
      slotRectTop: s ? Math.round(s.getBoundingClientRect().top) : null,
      slotRectLeft: s ? Math.round(s.getBoundingClientRect().left) : null,
      slotRectH: s ? Math.round(s.getBoundingClientRect().height) : null,
      slotRectW: s ? Math.round(s.getBoundingClientRect().width) : null,
      pageTop: p ? p.offsetTop : null,
      pageH: p ? p.offsetHeight : null,
      pageRectTop: pr ? Math.round(pr.top) : null,
      pageRectLeft: pr ? Math.round(pr.left) : null,
      pageRectH: pr ? Math.round(pr.height) : null,
      pageRectW: pr ? Math.round(pr.width) : null,
      scale: scaleOf(p),
      flip: p ? p.classList.contains('pdf-page-zoom-flip') : null,
      from: p ? p.style.getPropertyValue('--tf-zoom-flip-from') : null,
      dx: p ? p.style.getPropertyValue('--tf-zoom-flip-dx') : null,
      dy: p ? p.style.getPropertyValue('--tf-zoom-flip-dy') : null,
      canvasW: c ? c.width : null,
      canvasH: c ? c.height : null,
      canvasCssW: c ? c.style.width : null,
      canvasRectH: cr ? Math.round(cr.height) : null,
      canvasRectW: cr ? Math.round(cr.width) : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      mounted: document.querySelectorAll('.pdf-page[data-page]').length,
      slots: document.querySelectorAll('.page-slot[data-page]').length,
      anims: document.getAnimations().length,
    });
    last = now;
    zd.raf = requestAnimationFrame(sample);
  };
  zd.raf = requestAnimationFrame(sample);
  document.addEventListener('animationstart', (e) => {
    zd.animStarts.push({
      t: performance.now(),
      name: e.animationName,
      page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
    });
  }, true);
}

function maxAbs(nums) { return nums.length ? Math.max(...nums.map((n) => Math.abs(n))) : null; }

// Per-mark FLIP deviation summary: visual rect minus slot layout rect per frame.
function summarizeMark(marks, samples, label) {
  const idx = marks.findIndex((m) => m.label === label);
  if (idx < 0) return { label, missing: true };
  const mark = marks[idx];
  const next = marks[idx + 1];
  const end = next ? next.t : mark.t + 1500;
  const arr = samples.filter((s) => s.t >= mark.t && s.t < end);
  const flip = arr.filter((s) => s.flip === true);
  const devs = flip.map((s) => ({
    top: s.pageRectTop - s.slotRectTop,
    left: s.pageRectLeft - s.slotRectLeft,
    h: s.pageRectH - s.slotRectH,
    w: s.pageRectW - s.slotRectW,
  }));
  const dts = arr.map((s) => s.dt);
  const scrolls = arr.map((s) => s.scrollTop);
  const first = flip[0] || null;
  const lastF = flip[flip.length - 1] || null;
  return {
    label,
    flipFrames: flip.length,
    maxAbsTop: maxAbs(devs.map((d) => d.top)),
    maxAbsLeft: maxAbs(devs.map((d) => d.left)),
    firstTop: devs.length ? devs[0].top : null,
    firstLeft: devs.length ? devs[0].left : null,
    firstW: devs.length ? devs[0].w : null,
    firstH: devs.length ? devs[0].h : null,
    lastTop: devs.length ? devs[devs.length - 1].top : null,
    lastLeft: devs.length ? devs[devs.length - 1].left : null,
    slotW: first ? first.slotRectW : null,
    pageWstart: first ? first.pageRectW : null,
    pageWend: lastF ? lastF.pageRectW : null,
    scaleStart: first ? Number(first.scale.toFixed(4)) : null,
    scaleEnd: lastF ? Number(lastF.scale.toFixed(4)) : null,
    from: first ? first.from : null,
    maxDt: Math.max(...dts),
    longFrames: dts.filter((d) => d > 32).length,
    veryLongFrames: dts.filter((d) => d > 50).length,
    hugeFrames: dts.filter((d) => d > 100).length,
    scrollMin: Math.min(...scrolls),
    scrollMax: Math.max(...scrolls),
  };
}

// ---------------------------------------------------------------------------
// DEF-302 zoom: visual rect vs slot layout rect across real ladder steps.
// ---------------------------------------------------------------------------
test('BUILD-COMPARE zoom DEF-302', async () => {
  console.log(`[CMP-ZD] ${await versionTag()}`);
  await openFile(app, win, tmpCopy(REPORT, 'cmp-zoom.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const readout = async () => (await win.locator('.zoom-percent').first().innerText()).trim();
  const mark = (l) => win.evaluate((x) => { window.__zd.marks.push({ label: x, t: performance.now() }); }, l);
  const click = async (dir) => { await win.locator(`button[aria-label="Zoom ${dir}"]`).first().click(); await win.waitForTimeout(900); };
  const readouts = {};
  readouts.fit = await readout();

  await win.evaluate(installSampler);
  await win.waitForTimeout(400);

  await mark('step_1pct'); await click('in'); readouts.at200 = await readout();       // fit ~198 -> 200 (1% step)
  await mark('step_25pct'); await click('in'); readouts.at250 = await readout();      // 200 -> 250 (25% step)
  await mark('step_out_25pct'); await click('out'); readouts.back200 = await readout(); // 250 -> 200
  await click('out'); readouts.at175 = await readout();                                // 200 -> 175
  await mark('step_12pct'); await click('in'); readouts.at200b = await readout();      // 175 -> 200 (12.5% step)

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__zd.raf);
    return { samples: window.__zd.samples, marks: window.__zd.marks, animStarts: window.__zd.animStarts };
  });
  const labels = ['step_1pct', 'step_25pct', 'step_out_25pct', 'step_12pct'];
  const sums = labels.map((l) => summarizeMark(data.marks, data.samples, l));
  console.log(`[CMP-ZD] ${await versionTag()} readouts=${JSON.stringify(readouts)}`);
  console.log(`[CMP-ZD] steps=${JSON.stringify(sums)}`);
  console.log(`[CMP-ZD] animStarts=${JSON.stringify(data.animStarts.map((a) => ({ name: a.name, page: a.page })))}`);

  // Reproduction only: the ladder moved and the FLIP played on every step.
  expect(parseFloat(readouts.at200)).toBeGreaterThan(parseFloat(readouts.fit));
  expect(sums.every((s) => s.flipFrames > 0), 'every step played the FLIP').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-302 scroll anchor on a scrolled document (same as the diagnosis).
// ---------------------------------------------------------------------------
test('BUILD-COMPARE zoom anchor DEF-302', async () => {
  console.log(`[CMP-ZA] ${await versionTag()}`);
  await openFile(app, win, tmpCopy(REPORT, 'cmp-anchor.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => {
    const scroller = document.querySelector('.document-scroller');
    scroller.scrollTop = Math.round(scroller.scrollHeight * 0.45);
  });
  await win.waitForTimeout(600);

  const readAnchor = () => win.evaluate(() => {
    const scroller = document.querySelector('.document-scroller');
    const st = scroller.getBoundingClientRect().top;
    const pages = [...document.querySelectorAll('.page-slot[data-page]')].map((s) => {
      const el = s.querySelector('.pdf-page');
      return el ? { page: Number(s.getAttribute('data-page')), top: el.getBoundingClientRect().top } : null;
    }).filter(Boolean);
    let best = null; let bestTop = Number.NEGATIVE_INFINITY;
    for (const p of pages) { if (p.top <= st && p.top > bestTop) { best = p; bestTop = p.top; } }
    return { anchorPage: best ? best.page : null, offset: best ? Math.round(best.top - st) : null, scrollTop: Math.round(scroller.scrollTop) };
  });
  const offsetOf = (page) => win.evaluate(({ p }) => {
    const scroller = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${p}"]`);
    return {
      slotOffsetTop: slot ? slot.offsetTop : null,
      slotHeight: slot ? slot.offsetHeight : null,
      belowTop: slot ? slot.offsetTop - Math.round(scroller.scrollTop) : null,
      scrollTop: Math.round(scroller.scrollTop),
    };
  }, { p: page });

  const before = await readAnchor();
  const p = before.anchorPage;
  const offBefore = await offsetOf(p);
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const afterIn = await readAnchor();
  const offAfterIn = await offsetOf(p);
  await win.locator('button[aria-label="Zoom out"]').first().click();
  await win.waitForTimeout(900);
  const afterOut = await readAnchor();
  const offAfterOut = await offsetOf(p);
  console.log(`[CMP-ZA] ${await versionTag()} anchorPage=${p} offBefore=${JSON.stringify(offBefore)} offAfterIn=${JSON.stringify(offAfterIn)} offAfterOut=${JSON.stringify(offAfterOut)} before=${JSON.stringify(before)} afterIn=${JSON.stringify(afterIn)} afterOut=${JSON.stringify(afterOut)}`);
  expect(p, 'a page must sit at the scroller top edge').not.toBeNull();
});

// ---------------------------------------------------------------------------
// DEF-302 one screenshot per build: pause the FLIP at 60 ms on a 50% view.
// ---------------------------------------------------------------------------
test('BUILD-COMPARE zoom screenshot DEF-302', async () => {
  console.log(`[CMP-ZS] ${await versionTag()}`);
  await openFile(app, win, tmpCopy(REPORT, 'cmp-shot.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  for (let i = 0; i < 10; i += 1) {
    await win.locator('button[aria-label="Zoom out"]').first().click();
    await win.waitForTimeout(120);
  }
  await win.waitForTimeout(800);
  const at50 = (await win.locator('.zoom-percent').first().innerText()).trim();

  const info = await win.evaluate(() => new Promise((resolve) => {
    const btn = document.querySelector('button[aria-label="Zoom in"]');
    btn.click();
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector('.pdf-page[data-page="1"]');
      const a = el ? el.getAnimations().find((x) => x.animationName === 'tf-page-zoom-flip') : null;
      if (a) {
        a.pause(); a.currentTime = 60;
        const cs = getComputedStyle(el);
        const slot = document.querySelector('.page-slot[data-page="1"]');
        return resolve({ ok: true, scale: new DOMMatrixReadOnly(cs.transform).a,
          slotH: slot ? slot.offsetHeight : null, pageH: el.offsetHeight,
          from: el.style.getPropertyValue('--tf-zoom-flip-from'),
          dx: el.style.getPropertyValue('--tf-zoom-flip-dx'),
          dy: el.style.getPropertyValue('--tf-zoom-flip-dy'),
          origin: cs.transformOrigin });
      }
      if (++tries > 8) return resolve({ ok: false });
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }));
  const shotPath = path.join(SHOTS, `def302-compare-${BUILD}.png`);
  await win.screenshot({ path: shotPath });
  console.log(`[CMP-ZS] ${await versionTag()} at50=${at50} pause=${JSON.stringify(info)} shot=${shotPath}`);
  await win.evaluate(() => {
    const el = document.querySelector('.pdf-page[data-page="1"]');
    const a = el && el.getAnimations().find((x) => x.animationName === 'tf-page-zoom-flip');
    if (a) a.finish();
  });
  expect(info.ok, 'the zoom-in FLIP was found for the screenshot').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-303 window probes - identical to phase35_maximize_diag.spec.cjs.
// ---------------------------------------------------------------------------
function installMainProbe({ BrowserWindow, ipcMain }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [] };
  const w = BrowserWindow.getAllWindows()[0];
  g.__mxWin = w;
  const now = () => Date.now();
  const log = (ev, extra) => g.__mx.log.push({ ev, t: now(), ...(extra || {}) });
  try { ipcMain.removeHandler('window:maximize'); } catch (_) { /* ignore */ }
  ipcMain.handle('window:maximize', (event) => {
    log('ipc-arrive');
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target !== null) { if (target.isMaximized()) target.unmaximize(); else target.maximize(); }
  });
  try { ipcMain.removeHandler('window:minimize'); } catch (_) { /* ignore */ }
  ipcMain.handle('window:minimize', (event) => {
    log('ipc-min-arrive');
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  for (const m of ['maximize', 'unmaximize', 'restore', 'minimize', 'show', 'focus']) {
    const orig = w[m].bind(w);
    w[m] = (...a) => { log('call:' + m); return orig(...a); };
  }
  for (const ev of ['maximize', 'unmaximize', 'restore', 'minimize', 'resize', 'move', 'show', 'focus']) {
    w.on(ev, () => log('ev:' + ev));
  }
  g.__mxTimer = setInterval(() => {
    const b = w.getBounds();
    g.__mx.poll.push({ t: now(), max: w.isMaximized(), min: w.isMinimized(), vis: w.isVisible(), x: b.x, y: b.y, w: b.width, h: b.height });
  }, 5);
}

function installRendererProbe() {
  const g = window;
  g.__rx = { log: [], frames: [], marks: [] };
  const now = () => Date.now();
  g.__rx.log.push({ ev: 'install', t: now() });
  window.addEventListener('resize', () => g.__rx.log.push({ ev: 'resize', t: now() }), true);
  const scroller = document.querySelector('.document-scroller');
  if (scroller) {
    const ro = new ResizeObserver(() => g.__rx.log.push({ ev: 'ro-scroller', t: now(), w: scroller.clientWidth, h: scroller.clientHeight }));
    ro.observe(scroller);
    g.__rx.ro = ro;
  }
  try {
    window.tflex.settings.changed((s) => g.__rx.log.push({ ev: 'settings-echo', t: now(), max: s.geometry.maximized }));
  } catch (_) { /* ignore */ }
  let last = performance.now();
  const frame = () => {
    const t = now();
    const p = document.querySelector('.pdf-page[data-page="1"]');
    const s = document.querySelector('.page-slot[data-page="1"]');
    const c = p ? p.querySelector('canvas') : null;
    const appEl = document.querySelector('.app');
    const maxBtn = document.querySelector('[data-window-maximize]');
    g.__rx.frames.push({ t, dt: Math.round(performance.now() - last), pageW: p ? Math.round(p.getBoundingClientRect().width) : null,
      slotH: s ? s.offsetHeight : null, canvasW: c ? c.width : null,
      maxClass: appEl ? appEl.classList.contains('app-maximized') : null,
      maxLabel: maxBtn ? maxBtn.getAttribute('aria-label') : null });
    last = performance.now();
    g.__rx.raf = requestAnimationFrame(frame);
  };
  g.__rx.raf = requestAnimationFrame(frame);
}

function median(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
function spread(a) { const c = a.filter((n) => Number.isFinite(n)); if (c.length === 0) return null; return { min: Math.min(...c), median: median(c), max: Math.max(...c) }; }
function firstAfter(arr, t, pred) { for (const x of arr) { if (x.t >= t && (!pred || pred(x))) return x; } return null; }

function analyzeRun(run) {
  const { main, rend } = run;
  const tMaxClick = (rend.marks.find((m) => m.label === 'max-click') || {}).t;
  const tMinClick = (rend.marks.find((m) => m.label === 'min-click') || {}).t;
  const tRestoreReq = (main.log.find((e) => e.ev === 'restore-request') || {}).t;
  const tIpc = firstAfter(main.log, tMaxClick, (e) => e.ev === 'ipc-arrive');
  const tCallMax = firstAfter(main.log, tMaxClick, (e) => e.ev === 'call:maximize');
  const tEvMax = firstAfter(main.log, tMaxClick, (e) => e.ev === 'ev:maximize');
  const tIsMax = firstAfter(main.poll, tMaxClick, (p) => p.max === true);
  const resizes = main.log.filter((e) => e.ev === 'ev:resize' && e.t >= tMaxClick);
  const framesBefore = rend.frames.filter((f) => f.t < tMaxClick);
  const base = framesBefore[framesBefore.length - 1] || null;
  const framesAfter = rend.frames.filter((f) => f.t >= tMaxClick);
  const firstFrame = framesAfter[0] || null;
  const relayout = base ? firstAfter(framesAfter, tMaxClick, (f) => f.pageW !== base.pageW) : null;
  const reraster = base ? firstAfter(framesAfter, tMaxClick, (f) => f.canvasW !== base.canvasW) : null;
  const captionClass = firstAfter(framesAfter, tMaxClick, (f) => f.maxClass === true);
  const captionEcho = firstAfter(rend.log, tMaxClick, (e) => e.ev === 'settings-echo' && e.max === true);
  const maxDt = framesAfter.length ? Math.max(...framesAfter.map((f) => f.dt)) : null;
  const pageWChanges = [];
  let prevW = base ? base.pageW : null;
  for (const f of framesAfter) { if (f.pageW !== prevW) { pageWChanges.push({ dt: f.t - tMaxClick, w: f.pageW }); prevW = f.pageW; } }
  const settle = pageWChanges.length ? pageWChanges[pageWChanges.length - 1] : null;
  const tVis = firstAfter(main.poll, tRestoreReq, (p) => p.vis === true);
  const firstFrameAfterRestore = firstAfter(rend.frames, tRestoreReq);
  const d = (a, b) => (a && b !== null && b !== undefined ? a.t - b : null);
  return {
    tMaxClick,
    main: { ipcArrive: d(tIpc, tMaxClick), callMaximize: d(tCallMax, tMaxClick), maximizeEvent: d(tEvMax, tMaxClick),
      isMaximizedTrue: d(tIsMax, tMaxClick), resizeCount: resizes.length, resizeLast: resizes.length ? resizes[resizes.length - 1].t - tMaxClick : null },
    renderer: { firstFrame: d(firstFrame, tMaxClick), relayout: d(relayout, tMaxClick), reraster: d(reraster, tMaxClick),
      captionClass: d(captionClass, tMaxClick), captionEcho: d(captionEcho, tMaxClick), settle: settle ? settle.dt : null, maxFrameDt: maxDt },
    restore: { requestToVisible: d(tVis, tRestoreReq), requestToFirstFrame: d(firstFrameAfterRestore, tRestoreReq) },
    minimize: { clickToIpc: d(firstAfter(main.log, tMinClick, (e) => e.ev === 'ipc-min-arrive'), tMinClick), clickToMinimizeEvent: d(firstAfter(main.log, tMinClick, (e) => e.ev === 'ev:minimize'), tMinClick) },
  };
}

// ---------------------------------------------------------------------------
// DEF-303 maximize from minimised: 3x restore->maximize + 3x direct
// minimize->maximize, phase breakdown min/median/max, plus the operator-
// perceived end-to-end (maximise click -> window on screen -> caption correct).
// ---------------------------------------------------------------------------
test('BUILD-COMPARE maximize DEF-303', async () => {
  console.log(`[CMP-MX] ${await versionTag()}`);
  await openFile(app, win, tmpCopy(REPORT, 'cmp-max.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);

  const reset = async () => {
    await app.evaluate(() => { const w = globalThis.__mxWin; if (w.isMinimized()) w.restore(); if (w.isMaximized()) w.unmaximize(); });
    await win.waitForTimeout(700);
    await app.evaluate(() => { globalThis.__mx.log = []; globalThis.__mx.poll = []; });
    await win.evaluate(() => { window.__rx.log = []; window.__rx.frames = []; window.__rx.marks = []; });
    await win.waitForTimeout(200);
  };
  const collect = async () => {
    const main = await app.evaluate(() => ({ log: globalThis.__mx.log, poll: globalThis.__mx.poll }));
    const rend = await win.evaluate(() => ({ log: window.__rx.log, frames: window.__rx.frames, marks: window.__rx.marks }));
    return analyzeRun({ main, rend });
  };

  const restoreRuns = [];
  for (let i = 0; i < 3; i += 1) {
    await reset();
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);
    await app.evaluate(() => { globalThis.__mx.log.push({ ev: 'restore-request', t: Date.now() }); globalThis.__mxWin.restore(); });
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await win.locator('[data-window-maximize]').click();
    await win.waitForTimeout(1800);
    const a = await collect();
    restoreRuns.push(a);
    console.log(`[CMP-MX] ${await versionTag()} restore-run${i + 1}=${JSON.stringify(a)}`);
  }

  const directRuns = [];
  for (let i = 0; i < 3; i += 1) {
    await reset();
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await app.evaluate(() => { globalThis.__mx.log.push({ ev: 'direct-max-request', t: Date.now() }); globalThis.__mxWin.maximize(); });
    await win.waitForTimeout(1800);
    const a = await collect();
    directRuns.push(a);
    console.log(`[CMP-MX] ${await versionTag()} direct-run${i + 1}=${JSON.stringify(a)}`);
  }

  const pick = (arr, fn) => arr.map(fn);
  const phases = (arr) => ({
    'main.maximizeEvent': pick(arr, (r) => r.main.maximizeEvent),
    'main.isMaximizedTrue': pick(arr, (r) => r.main.isMaximizedTrue),
    'renderer.firstFrame': pick(arr, (r) => r.renderer.firstFrame),
    'renderer.relayout': pick(arr, (r) => r.renderer.relayout),
    'renderer.reraster': pick(arr, (r) => r.renderer.reraster),
    'renderer.settle': pick(arr, (r) => r.renderer.settle),
    'renderer.captionClass': pick(arr, (r) => r.renderer.captionClass),
    'renderer.captionEcho': pick(arr, (r) => r.renderer.captionEcho),
    'renderer.maxFrameDt': pick(arr, (r) => r.renderer.maxFrameDt),
  });
  const toSpread = (p) => { const o = {}; for (const [k, v] of Object.entries(p)) o[k] = spread(v); return o; };
  console.log(`[CMP-MX] ${await versionTag()} restoreSpread=${JSON.stringify(toSpread(phases(restoreRuns)))}`);
  console.log(`[CMP-MX] ${await versionTag()} directSpread=${JSON.stringify(toSpread(phases(directRuns)))}`);

  const e2e = (arr) => arr.map((r) => {
    const onScreen = r.main.maximizeEvent;
    const caption = r.renderer.captionEcho;
    return { onScreen, caption, perceived: Math.max(onScreen ?? 0, caption ?? 0) };
  });
  console.log(`[CMP-MX] ${await versionTag()} restoreE2E=${JSON.stringify(e2e(restoreRuns))}`);
  console.log(`[CMP-MX] ${await versionTag()} directE2E=${JSON.stringify(e2e(directRuns))}`);

  await app.evaluate(() => { clearInterval(globalThis.__mxTimer); const w = globalThis.__mxWin; if (w.isMinimized()) w.restore(); if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(500);
  expect(restoreRuns.length).toBe(3);
  expect(directRuns.length).toBe(3);
  expect(restoreRuns.every((r) => r.main.isMaximizedTrue !== null)).toBe(true);
});
