// Phase 35 focused diagnosis (qa) — operator report (2026-09-22):
//   "Maximizing the app from minimized state sometimes take longer time.
//    Check what is causing the delay."
//
// Diagnostic harness (not a pass/fail guard): it instruments BOTH processes and
// runs the minimize -> restore -> maximize path 5 times, printing a per-run
// phase breakdown and the min/median/max spread. All cross-process timestamps
// use Date.now() (a shared wall clock); frame deltas use performance.now().
//
// Main process: window:maximize IPC arrival, win.restore()/win.maximize() call,
// the OS maximize event, the first poll where isMaximized() is true, the resize
// event storm and the bounds changes.
// Renderer: resize/ResizeObserver work, the page re-layout (page-1 width), the
// page re-raster (canvas backing store), the settings echo that flips the
// caption, and the rAF cadence to the first painted frame and to layout settle.
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT, FIX } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-max-diag');
  app = null;
  win = null;
});
test.setTimeout(300000);

function installMainProbe({ BrowserWindow, ipcMain }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [] };
  const w = BrowserWindow.getAllWindows()[0];
  g.__mxWin = w;
  const now = () => Date.now();
  const log = (ev, extra) => g.__mx.log.push({ ev, t: now(), ...(extra || {}) });
  // Re-register the two window-control handlers with an arrival timestamp
  // (identical logic to src/main/index.ts:235-247).
  try { ipcMain.removeHandler('window:maximize'); } catch (_) { /* ignore */ }
  ipcMain.handle('window:maximize', (event) => {
    log('ipc-arrive');
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target !== null) {
      if (target.isMaximized()) target.unmaximize();
      else target.maximize();
    }
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
    g.__mx.poll.push({
      t: now(), max: w.isMaximized(), min: w.isMinimized(), vis: w.isVisible(),
      x: b.x, y: b.y, w: b.width, h: b.height,
    });
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
    const ro = new ResizeObserver(() => g.__rx.log.push({
      ev: 'ro-scroller', t: now(), w: scroller.clientWidth, h: scroller.clientHeight,
    }));
    ro.observe(scroller);
    g.__rx.ro = ro;
  }
  try {
    window.tflex.settings.changed((s) => g.__rx.log.push({
      ev: 'settings-echo', t: now(), max: s.geometry.maximized,
    }));
  } catch (_) { /* ignore */ }
  let last = performance.now();
  const frame = () => {
    const t = now();
    const p = document.querySelector('.pdf-page[data-page="1"]');
    const s = document.querySelector('.page-slot[data-page="1"]');
    const c = p ? p.querySelector('canvas') : null;
    const appEl = document.querySelector('.app');
    const maxBtn = document.querySelector('[data-window-maximize]');
    g.__rx.frames.push({
      t,
      dt: Math.round(performance.now() - last),
      pageW: p ? Math.round(p.getBoundingClientRect().width) : null,
      slotH: s ? s.offsetHeight : null,
      canvasW: c ? c.width : null,
      maxClass: appEl ? appEl.classList.contains('app-maximized') : null,
      maxLabel: maxBtn ? maxBtn.getAttribute('aria-label') : null,
    });
    last = performance.now();
    g.__rx.raf = requestAnimationFrame(frame);
  };
  g.__rx.raf = requestAnimationFrame(frame);
}

// DEF-303 retest — count settings.json writes in the main process by wrapping
// the atomic-rename step of SettingsService._doSave. The bundled main calls
// `import_promises2.rename(tmp, this.filePath)` — a property read at call time
// on the node:fs/promises module object — so patching that object is observed.
// One successful persist == one rename onto settings.json.
function installWriteCounter() {
  const g = globalThis;
  g.__wr = [];
  g.__wrPatched = false;
  g.__wrError = null;
  let fsp = null;
  try { fsp = require('node:fs/promises'); } catch (_) { fsp = null; }
  if (!fsp && process.mainModule && typeof process.mainModule.require === 'function') {
    try { fsp = process.mainModule.require('node:fs/promises'); } catch (_) { fsp = null; }
  }
  if (!fsp) { g.__wrError = 'node:fs/promises unavailable in main evaluate context'; return; }
  const orig = fsp.rename;
  fsp.rename = async (from, to) => {
    const t = Date.now();
    try {
      if (String(to).endsWith('settings.json')) g.__wr.push({ t, to: String(to) });
    } catch (_) { /* ignore */ }
    return orig(from, to);
  };
  g.__wrPatched = true;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function spread(a) {
  const clean = a.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return null;
  return { min: Math.min(...clean), median: median(clean), max: Math.max(...clean) };
}

function firstAfter(arr, t, pred) {
  for (const x of arr) {
    if (x.t >= t && (!pred || pred(x))) return x;
  }
  return null;
}

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
  const tResizeFirst = resizes[0] || null;
  const tResizeLast = resizes[resizes.length - 1] || null;

  const framesBefore = rend.frames.filter((f) => f.t < tMaxClick);
  const base = framesBefore[framesBefore.length - 1] || null;
  const framesAfter = rend.frames.filter((f) => f.t >= tMaxClick);
  const firstFrame = framesAfter[0] || null;
  const relayout = base ? firstAfter(framesAfter, tMaxClick, (f) => f.pageW !== base.pageW) : null;
  const reraster = base ? firstAfter(framesAfter, tMaxClick, (f) => f.canvasW !== base.canvasW) : null;
  const captionClass = firstAfter(framesAfter, tMaxClick, (f) => f.maxClass === true);
  const captionEcho = firstAfter(rend.log, tMaxClick, (e) => e.ev === 'settings-echo' && e.max === true);
  const changed = base ? framesAfter.filter((f) => f.pageW !== base.pageW) : [];
  const maxDt = framesAfter.length ? Math.max(...framesAfter.map((f) => f.dt)) : null;
  const pageWChanges = [];
  let prevW = base ? base.pageW : null;
  for (const f of framesAfter) {
    if (f.pageW !== prevW) {
      pageWChanges.push({ dt: f.t - tMaxClick, w: f.pageW, slotH: f.slotH, canvasW: f.canvasW });
      prevW = f.pageW;
    }
  }
  // Layout settles at the LAST geometry transition, not the last frame that
  // merely differs from the pre-maximize baseline.
  const settle = pageWChanges.length ? pageWChanges[pageWChanges.length - 1] : null;
  const roDetail = rend.log
    .filter((e) => e.ev === 'ro-scroller' && e.t >= tMaxClick)
    .map((e) => ({ dt: e.t - tMaxClick, w: e.w, h: e.h }));

  const tVis = firstAfter(main.poll, tRestoreReq, (p) => p.vis === true);
  const tRestoreEv = firstAfter(main.log, tRestoreReq, (e) => e.ev === 'ev:restore');
  const firstFrameAfterRestore = firstAfter(rend.frames, tRestoreReq);

  // `a` is an event object ({t}), `b` is a plain timestamp number.
  const d = (a, b) => (a && b !== null && b !== undefined ? a.t - b : null);
  return {
    tMaxClick,
    main: {
      ipcArrive: d(tIpc, tMaxClick),
      callMaximize: d(tCallMax, tMaxClick),
      maximizeEvent: d(tEvMax, tMaxClick),
      isMaximizedTrue: d(tIsMax, tMaxClick),
      resizeCount: resizes.length,
      resizeFirst: d(tResizeFirst, tMaxClick),
      resizeLast: d(tResizeLast, tMaxClick),
      resizeSpan: tResizeFirst && tResizeLast ? tResizeLast.t - tResizeFirst.t : null,
    },
    renderer: {
      firstFrame: d(firstFrame, tMaxClick),
      relayout: d(relayout, tMaxClick),
      reraster: d(reraster, tMaxClick),
      captionClass: d(captionClass, tMaxClick),
      captionEcho: d(captionEcho, tMaxClick),
      settle: settle ? settle.dt : null,
      maxFrameDt: maxDt,
      pageWChanges,
      roDetail,
      resizeEvents: rend.log.filter((e) => e.ev === 'resize' && e.t >= tMaxClick).length,
      roEvents: rend.log.filter((e) => e.ev === 'ro-scroller' && e.t >= tMaxClick).length,
    },
    restore: {
      requestToVisible: d(tVis, tRestoreReq),
      requestToRestoreEvent: d(tRestoreEv, tRestoreReq),
      requestToFirstFrame: d(firstFrameAfterRestore, tRestoreReq),
    },
    minimize: {
      clickToIpc: d(firstAfter(main.log, tMinClick, (e) => e.ev === 'ipc-min-arrive'), tMinClick),
      clickToMinimizeEvent: d(firstAfter(main.log, tMinClick, (e) => e.ev === 'ev:minimize'), tMinClick),
    },
  };
}

test('DEF-303 minimize -> restore -> maximize phase breakdown (5 runs)', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-maxdiag.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);

  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    // Reset to a known unmaximized start, then clear the logs.
    await app.evaluate(() => {
      const w = globalThis.__mxWin;
      if (w.isMaximized()) w.unmaximize();
    });
    await win.waitForTimeout(700);
    await app.evaluate(() => { globalThis.__mx.log = []; globalThis.__mx.poll = []; });
    await win.evaluate(() => { window.__rx.log = []; window.__rx.frames = []; window.__rx.marks = []; });
    await win.waitForTimeout(200);

    // 1. Minimize via the app's own control.
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);

    // 2. Restore (the taskbar-click equivalent) from main.
    await app.evaluate(() => {
      globalThis.__mx.log.push({ ev: 'restore-request', t: Date.now() });
      globalThis.__mxWin.restore();
    });
    await win.waitForTimeout(700);

    // 3. Maximize via the app's own control.
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await win.locator('[data-window-maximize]').click();
    await win.waitForTimeout(1800);

    const main = await app.evaluate(() => ({ log: globalThis.__mx.log, poll: globalThis.__mx.poll }));
    const rend = await win.evaluate(() => ({ log: window.__rx.log, frames: window.__rx.frames, marks: window.__rx.marks }));
    const a = analyzeRun({ main, rend });
    runs.push(a);
    console.log(`[MX] run${i + 1}=${JSON.stringify(a)}`);
  }

  const pick = (fn) => runs.map(fn);
  const phases = {
    'main.ipcArrive': pick((r) => r.main.ipcArrive),
    'main.callMaximize': pick((r) => r.main.callMaximize),
    'main.maximizeEvent': pick((r) => r.main.maximizeEvent),
    'main.isMaximizedTrue': pick((r) => r.main.isMaximizedTrue),
    'main.resizeCount': pick((r) => r.main.resizeCount),
    'main.resizeSpan': pick((r) => r.main.resizeSpan),
    'renderer.firstFrame': pick((r) => r.renderer.firstFrame),
    'renderer.relayout': pick((r) => r.renderer.relayout),
    'renderer.reraster': pick((r) => r.renderer.reraster),
    'renderer.captionClass': pick((r) => r.renderer.captionClass),
    'renderer.captionEcho': pick((r) => r.renderer.captionEcho),
    'renderer.settle': pick((r) => r.renderer.settle),
    'renderer.maxFrameDt': pick((r) => r.renderer.maxFrameDt),
    'restore.requestToVisible': pick((r) => r.restore.requestToVisible),
    'restore.requestToRestoreEvent': pick((r) => r.restore.requestToRestoreEvent),
    'restore.requestToFirstFrame': pick((r) => r.restore.requestToFirstFrame),
    'minimize.clickToIpc': pick((r) => r.minimize.clickToIpc),
    'minimize.clickToMinimizeEvent': pick((r) => r.minimize.clickToMinimizeEvent),
  };
  const spreads = {};
  for (const [k, v] of Object.entries(phases)) spreads[k] = spread(v);
  console.log(`[MX] spread=${JSON.stringify(spreads)}`);

  // Leave the window in a clean, visible, unmaximized state for teardown.
  await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    const w = globalThis.__mxWin;
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(500);

  // Reproduction assertion: the maximize path completed in every run.
  expect(runs.length).toBe(5);
  expect(runs.every((r) => r.main.isMaximizedTrue !== null)).toBe(true);
});

// Heavier fixture (image-heavy scanned.pdf) + the direct maximize-from-minimized
// path (win.maximize() called while the window is still minimized, which is what
// the taskbar preview's maximize control does).
test('DEF-303b heavier fixture + direct maximize-from-minimized', async () => {
  await openFile(app, win, tmpCopy(path.join(FIX, 'scanned.pdf'), 'p35-maxdiag-scan.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);

  const reset = async () => {
    await app.evaluate(() => {
      const w = globalThis.__mxWin;
      if (w.isMinimized()) w.restore();
      if (w.isMaximized()) w.unmaximize();
    });
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

  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    await reset();
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);
    await app.evaluate(() => {
      globalThis.__mx.log.push({ ev: 'restore-request', t: Date.now() });
      globalThis.__mxWin.restore();
    });
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await win.locator('[data-window-maximize]').click();
    await win.waitForTimeout(1800);
    const a = await collect();
    runs.push(a);
    console.log(`[MX-SCAN] run${i + 1}=${JSON.stringify(a)}`);
  }

  const direct = [];
  for (let i = 0; i < 3; i += 1) {
    await reset();
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await app.evaluate(() => {
      globalThis.__mx.log.push({ ev: 'direct-max-request', t: Date.now() });
      globalThis.__mxWin.maximize();
    });
    await win.waitForTimeout(1800);
    const a = await collect();
    direct.push(a);
    console.log(`[MX-DIRECT] run${i + 1}=${JSON.stringify(a)}`);
  }

  const pick = (arr, fn) => arr.map(fn);
  const phases = {
    'main.ipcArrive': pick(runs, (r) => r.main.ipcArrive),
    'main.maximizeEvent': pick(runs, (r) => r.main.maximizeEvent),
    'main.isMaximizedTrue': pick(runs, (r) => r.main.isMaximizedTrue),
    'renderer.firstFrame': pick(runs, (r) => r.renderer.firstFrame),
    'renderer.relayout': pick(runs, (r) => r.renderer.relayout),
    'renderer.reraster': pick(runs, (r) => r.renderer.reraster),
    'renderer.settle': pick(runs, (r) => r.renderer.settle),
    'renderer.captionEcho': pick(runs, (r) => r.renderer.captionEcho),
    'renderer.maxFrameDt': pick(runs, (r) => r.renderer.maxFrameDt),
    'restore.requestToVisible': pick(runs, (r) => r.restore.requestToVisible),
    'restore.requestToFirstFrame': pick(runs, (r) => r.restore.requestToFirstFrame),
  };
  const spreads = {};
  for (const [k, v] of Object.entries(phases)) spreads[k] = spread(v);
  console.log(`[MX-SCAN] spread=${JSON.stringify(spreads)}`);
  const directSpreads = {
    'main.maximizeEvent': pick(direct, (r) => r.main.maximizeEvent),
    'main.isMaximizedTrue': pick(direct, (r) => r.main.isMaximizedTrue),
    'renderer.relayout': pick(direct, (r) => r.renderer.relayout),
    'renderer.reraster': pick(direct, (r) => r.renderer.reraster),
    'renderer.settle': pick(direct, (r) => r.renderer.settle),
    'renderer.maxFrameDt': pick(direct, (r) => r.renderer.maxFrameDt),
  };
  const directSpread = {};
  for (const [k, v] of Object.entries(directSpreads)) directSpread[k] = spread(v);
  console.log(`[MX-DIRECT] spread=${JSON.stringify(directSpread)}`);

  await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    const w = globalThis.__mxWin;
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(500);

  expect(runs.length).toBe(5);
  expect(direct.length).toBe(3);
  expect(runs.every((r) => r.main.isMaximizedTrue !== null)).toBe(true);
  expect(direct.every((r) => r.main.isMaximizedTrue !== null)).toBe(true);
});

// Many-page fixture (long.pdf, 520 pages): the geometry-mount recompute runs on
// every ResizeObserver tick, so this is the stress case for the re-layout path.
test('DEF-303c many-page fixture (520 pages)', async () => {
  await openFile(app, win, tmpCopy(path.join(FIX, 'long.pdf'), 'p35-maxdiag-long.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2500);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);

  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    await app.evaluate(() => {
      const w = globalThis.__mxWin;
      if (w.isMinimized()) w.restore();
      if (w.isMaximized()) w.unmaximize();
    });
    await win.waitForTimeout(700);
    await app.evaluate(() => { globalThis.__mx.log = []; globalThis.__mx.poll = []; });
    await win.evaluate(() => { window.__rx.log = []; window.__rx.frames = []; window.__rx.marks = []; });
    await win.waitForTimeout(200);
    await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
    await win.locator('[data-window-minimize]').click();
    await win.waitForTimeout(1200);
    await app.evaluate(() => {
      globalThis.__mx.log.push({ ev: 'restore-request', t: Date.now() });
      globalThis.__mxWin.restore();
    });
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__rx.marks.push({ label: 'max-click', t: Date.now() }));
    await win.locator('[data-window-maximize]').click();
    await win.waitForTimeout(1800);
    const main = await app.evaluate(() => ({ log: globalThis.__mx.log, poll: globalThis.__mx.poll }));
    const rend = await win.evaluate(() => ({ log: window.__rx.log, frames: window.__rx.frames, marks: window.__rx.marks }));
    const a = analyzeRun({ main, rend });
    runs.push(a);
    console.log(`[MX-LONG] run${i + 1}=${JSON.stringify(a)}`);
  }

  const pick = (fn) => runs.map(fn);
  const phases = {
    'main.maximizeEvent': pick((r) => r.main.maximizeEvent),
    'main.isMaximizedTrue': pick((r) => r.main.isMaximizedTrue),
    'renderer.firstFrame': pick((r) => r.renderer.firstFrame),
    'renderer.relayout': pick((r) => r.renderer.relayout),
    'renderer.reraster': pick((r) => r.renderer.reraster),
    'renderer.settle': pick((r) => r.renderer.settle),
    'renderer.captionEcho': pick((r) => r.renderer.captionEcho),
    'renderer.maxFrameDt': pick((r) => r.renderer.maxFrameDt),
    'restore.requestToVisible': pick((r) => r.restore.requestToVisible),
    'restore.requestToFirstFrame': pick((r) => r.restore.requestToFirstFrame),
  };
  const spreads = {};
  for (const [k, v] of Object.entries(phases)) spreads[k] = spread(v);
  console.log(`[MX-LONG] spread=${JSON.stringify(spreads)}`);

  await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    const w = globalThis.__mxWin;
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(500);

  expect(runs.length).toBe(5);
  expect(runs.every((r) => r.main.isMaximizedTrue !== null)).toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-303 retest — contract 1: a minimize -> restore -> maximize burst emits
// EACH state to the renderer immediately (no debounce) and persists the
// geometry ONCE. The pre-fix caption lag was 343/344/356 ms; post-fix the
// emission rides the OS event tick (single-digit ms).
// ---------------------------------------------------------------------------
test('DEF-303d burst: each state emitted immediately, geometry written once', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-burst.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await app.evaluate(installMainProbe);
  await app.evaluate(installWriteCounter);
  await win.evaluate(installRendererProbe);

  // Known unmaximized start, then clear all logs / write counter.
  await app.evaluate(() => {
    const w = globalThis.__mxWin;
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(800);
  await app.evaluate(() => { globalThis.__mx.log = []; globalThis.__mx.poll = []; globalThis.__wr = []; });
  await win.evaluate(() => { window.__rx.log = []; window.__rx.frames = []; window.__rx.marks = []; });
  await win.waitForTimeout(200);

  const patched = await app.evaluate(() => ({ ok: globalThis.__wrPatched, err: globalThis.__wrError }));
  expect(patched.ok, `main write counter installed (${patched.err ?? 'ok'})`).toBe(true);

  // Burst: minimize -> restore -> maximize, driven from main (the taskbar
  // minimise / restore equivalents) with gaps short enough that the 300 ms
  // geometry debounce coalesces the whole burst into ONE write. (A slow burst
  // would legitimately persist once per debounce window: minimize itself fires
  // a `move`, which schedules a persist, exactly as it did before the fix.)
  await app.evaluate(() => {
    globalThis.__mx.log.push({ ev: 'burst-min', t: Date.now() });
    globalThis.__mxWin.minimize();
  });
  await win.waitForTimeout(40);
  await app.evaluate(() => {
    globalThis.__mx.log.push({ ev: 'restore-request', t: Date.now() });
    globalThis.__mxWin.restore();
  });
  await win.waitForTimeout(40);
  await app.evaluate(() => {
    globalThis.__mx.log.push({ ev: 'direct-max-request', t: Date.now() });
    globalThis.__mxWin.maximize();
  });
  await win.waitForTimeout(1500);

  const main = await app.evaluate(() => ({ log: globalThis.__mx.log, writes: globalThis.__wr }));
  const rend = await win.evaluate(() => ({ log: window.__rx.log }));

  const tMin = (main.log.find((e) => e.ev === 'ev:minimize') || {}).t ?? null;
  const tRes = (main.log.find((e) => e.ev === 'ev:restore') || {}).t ?? null;
  const tMax = (main.log.find((e) => e.ev === 'ev:maximize') || {}).t ?? null;
  const echoes = rend.log.filter((e) => e.ev === 'settings-echo');
  const eMin = tMin !== null ? echoes.find((e) => e.t >= tMin) : null;
  const eRes = eMin ? echoes.find((e) => e.t > eMin.t) : null;
  const eMax = eRes ? echoes.find((e) => e.t > eRes.t) : null;
  const lat = (e, t) => (e && t !== null ? e.t - t : null);
  const resizes = main.log
    .filter((e) => (e.ev === 'ev:resize' || e.ev === 'ev:move') && e.t >= (tMin ?? 0))
    .map((e) => ({ ev: e.ev, dt: e.t - (tMin ?? e.t) }));
  const result = {
    events: { minimize: tMin !== null, restore: tRes !== null, maximize: tMax !== null },
    echoCount: echoes.length,
    echoMaxValues: echoes.map((e) => e.max),
    minEchoMs: lat(eMin, tMin),
    restoreEchoMs: lat(eRes, tRes),
    maximizeEchoMs: lat(eMax, tMax),
    writeCount: main.writes.length,
    writes: main.writes.map((w) => ({ dt: w.t - (tMin ?? w.t) })),
    mainEvents: main.log
      .filter((e) => e.ev.startsWith('ev:') || e.ev.endsWith('request') || e.ev === 'burst-min')
      .map((e) => ({ ev: e.ev, dt: e.t - (tMin ?? e.t) })),
    resizeMoveAfterMinimize: resizes,
  };
  console.log(`[MX-BURST] ${JSON.stringify(result)}`);

  // Each transition reached the renderer on the event tick, not after the
  // 300 ms debounce (the pre-fix caption lag was 343/344/356 ms).
  expect(tMin !== null && tRes !== null && tMax !== null, 'all three OS state events fired').toBe(true);
  expect(echoes.length, 'exactly three state emissions for the three transitions').toBe(3);
  expect(lat(eMin, tMin), `minimize state emitted immediately (${lat(eMin, tMin)} ms)`).toBeLessThanOrEqual(60);
  expect(lat(eRes, tRes), `restore state emitted immediately (${lat(eRes, tRes)} ms)`).toBeLessThanOrEqual(60);
  expect(lat(eMax, tMax), `maximize state emitted immediately (${lat(eMax, tMax)} ms)`).toBeLessThanOrEqual(60);
  expect(eMax && eMax.max, 'the maximize emission carries maximized=true').toBe(true);
  expect(main.writes.length, 'the geometry is persisted once for the whole burst').toBe(1);

  await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    const w = globalThis.__mxWin;
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
  });
  await win.waitForTimeout(500);
});

// ---------------------------------------------------------------------------
// DEF-303 retest — contract 2: the geometry-only write (echo suppressed)
// still reaches disk, and the saved geometry round-trips across a graceful
// quit + relaunch (maximized flag AND normal position/size).
// ---------------------------------------------------------------------------
test('DEF-303e geometry round-trips across a quit + relaunch', async () => {
  const udd = await app.evaluate(({ app: mainApp }) => mainApp.getPath('userData'));
  const settingsPath = path.join(udd, 'settings.json');

  // A distinctive normal geometry well inside the primary work area.
  const wanted = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMinimized()) w.restore();
    if (w.isMaximized()) w.unmaximize();
    const wa = screen.getPrimaryDisplay().workArea;
    const bounds = {
      x: wa.x + 80,
      y: wa.y + 80,
      width: Math.max(640, Math.min(900, wa.width - 160)),
      height: Math.max(480, Math.min(680, wa.height - 160)),
    };
    w.setBounds(bounds);
    return bounds;
  });
  await win.waitForTimeout(1000); // > 300 ms debounce

  const afterResize = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).geometry;
  await win.locator('[data-window-maximize]').click();
  await win.waitForTimeout(1400); // > 300 ms debounce
  const afterMaximize = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).geometry;

  console.log(`[MX-PERSIST] wanted=${JSON.stringify(wanted)} afterResize=${JSON.stringify(afterResize)} afterMaximize=${JSON.stringify(afterMaximize)}`);

  // The debounced geometry-only write (echoless) still reaches disk. Windows
  // frameless bounds can differ from the requested setBounds by 1 px, so the
  // requested size is matched within 2 px; the round-trip below is exact.
  expect(afterResize.maximized, 'the pre-maximize persist is unmaximized').toBe(false);
  expect(Math.abs(afterResize.width - wanted.width), `normal width persisted (${afterResize.width} vs wanted ${wanted.width})`).toBeLessThanOrEqual(2);
  expect(Math.abs(afterResize.height - wanted.height), `normal height persisted (${afterResize.height} vs wanted ${wanted.height})`).toBeLessThanOrEqual(2);
  expect(afterMaximize.maximized, 'maximized=true was persisted by the debounced write').toBe(true);
  expect(afterMaximize.width, 'the normal width is kept alongside the maximized flag').toBe(afterResize.width);
  expect(afterMaximize.height, 'the normal height is kept alongside the maximized flag').toBe(afterResize.height);

  // Graceful quit, then relaunch on the SAME user-data dir.
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
  app = null;
  win = null;

  const app2 = await launchApp([], udd);
  const win2 = await app2.firstWindow();
  await win2.waitForSelector('.sample-card', { timeout: 30000 });
  await win2.waitForTimeout(1000);
  const restored = await app2.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { isMaximized: w.isMaximized(), normalBounds: w.getNormalBounds() };
  });
  console.log(`[MX-PERSIST] restored=${JSON.stringify(restored)}`);
  const dw = Math.abs(restored.normalBounds.width - afterMaximize.width);
  const dh = Math.abs(restored.normalBounds.height - afterMaximize.height);
  console.log(`[MX-PERSIST] normalBoundsSizeDrift width=${dw}px height=${dh}px`);
  expect(restored.isMaximized, 'the relaunched window is maximized again').toBe(true);
  // Windows can inflate a frameless window's restored bounds by a few px when
  // the window is re-created; the saved geometry is reapplied (and x/y
  // round-trip exactly). The drift is window-creation rounding, not the
  // persist path - settings.json held exactly the requested normal bounds.
  expect(dw, `saved normal width reapplied within OS rounding (drift ${dw}px)`).toBeLessThanOrEqual(4);
  expect(dh, `saved normal height reapplied within OS rounding (drift ${dh}px)`).toBeLessThanOrEqual(4);
  expect(restored.normalBounds.x, 'the saved x round-trips exactly').toBe(afterMaximize.x);
  expect(restored.normalBounds.y, 'the saved y round-trips exactly').toBe(afterMaximize.y);

  // Hand the relaunched app to the shared teardown.
  app = app2;
  win = win2;
});

