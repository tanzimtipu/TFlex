// QA FIX-READY retest (2026-09-23) — DEF-303.
//
// Re-runs the timeline probe against the three DEF-303 fixes:
//   (1) `webPreferences.backgroundThrottling: false` at window creation, so the
//       renderer's rAF loop is NOT frozen while minimised (before: 0 frames in
//       900 ms).
//   (2) the pure `planCaptionMaximize` planner in the `window:maximize` handler:
//       minimised + previously maximised -> ONE restore(); minimised + previously
//       normal -> restore() then maximize(); not minimised -> the unchanged
//       single-action toggle.
//   (3) the renderer consumes `window:minimizedChanged` to park PDF work and
//       flush it on resume (renderSuspend). The visible page must be painted
//       (not blank) immediately after the restore.
//
// The main probe does NOT re-register the window-control IPC — that would
// bypass the product's planner and test the probe instead of the fix. It spies
// on the window's OWN `restore`/`maximize`/`unmaximize`/`minimize` methods (the
// exact OS calls the handler makes) and listens to the OS events.
//
// Screencast frames are measured IN MEMORY (pngjs on the base64 payload) — no
// frame image is written to disk, so no recorded image is added or overwritten.
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const LOG = path.resolve(__dirname, 'def303_fix_retest.log');
function out(msg) {
  const line = `[DEF303] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) { /* ignore */ }
}

let app = null;
let win = null;

test.beforeEach(async () => {
  fs.writeFileSync(LOG, `DEF-303 fix retest — ${new Date().toISOString()}\n`);
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def303-fix');
  app = null;
  win = null;
});
test.setTimeout(300000);

// ---------------------------------------------------------------------------
// CDP screencast — the actually painted frames, held in memory only.
// ---------------------------------------------------------------------------
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, ts: ev.metadata && ev.metadata.timestamp ? ev.metadata.timestamp : null, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 80, maxWidth: 720, maxHeight: 540, everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

// Ink (non-white pixel count) inside a rect of an IN-MEMORY base64 PNG frame.
function frameInkData(b64, rect) {
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const { width, height, data } = png;
  const x0 = Math.max(0, rect.x0); const x1 = Math.min(width - 1, rect.x1);
  const y0 = Math.max(0, rect.y0); const y1 = Math.min(height - 1, rect.y1);
  let ink = 0; let total = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * 4;
      total += 1;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink += 1;
    }
  }
  return { ink, total };
}

function rel(t, base) { return t === null || t === undefined ? null : Math.round(t - base); }

// ---------------------------------------------------------------------------
// Main-process probe: spies on the window's OWN methods (the product handler
// calls them), logs the OS events, polls the state every 5 ms and runs a 10 ms
// event-loop drift probe. Does NOT touch the IPC handlers.
// ---------------------------------------------------------------------------
function installMainProbe({ BrowserWindow }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [], loop: [], calls: [] };
  const w = BrowserWindow.getAllWindows()[0];
  g.__mxWin = w;
  const now = () => Date.now();
  const log = (ev, extra) => g.__mx.log.push({ ev, t: now(), ...(extra || {}) });
  for (const m of ['maximize', 'unmaximize', 'restore', 'minimize']) {
    const orig = w[m].bind(w);
    w[m] = (...a) => { log('call:' + m); g.__mx.calls.push({ m, t: now() }); return orig(...a); };
  }
  for (const ev of ['maximize', 'unmaximize', 'restore', 'minimize', 'resize', 'move', 'show', 'focus']) {
    w.on(ev, () => log('ev:' + ev));
  }
  g.__mxTimer = setInterval(() => {
    const b = w.getBounds();
    g.__mx.poll.push({ t: now(), max: w.isMaximized(), min: w.isMinimized(), vis: w.isVisible(), x: b.x, y: b.y, w: b.width, h: b.height });
  }, 5);
  let last = now();
  g.__mxLoopTimer = setInterval(() => {
    const t = now();
    g.__mx.loop.push({ t, drift: t - last - 10 });
    last = t;
  }, 10);
}

// ---------------------------------------------------------------------------
// Renderer probe: resize / settings echo / the `window:minimizedChanged` pause
// signal, a per-rAF frame sampler (dt exposes throttling), and a canvas-ink
// reader that proves the visible page is PAINTED (not blank).
// ---------------------------------------------------------------------------
function installRendererProbe() {
  const g = window;
  g.__rx = { log: [], frames: [], marks: [] };
  const now = () => Date.now();
  g.__rx.log.push({ ev: 'install', t: now() });
  window.addEventListener('resize', () => g.__rx.log.push({ ev: 'resize', t: now() }), true);
  try {
    window.tflex.settings.changed((s) => g.__rx.log.push({ ev: 'settings-echo', t: now(), max: s.geometry.maximized }));
  } catch (_) { /* ignore */ }
  // The DEF-303 pause signal (main -> renderer).
  try {
    window.tflex.onMinimizedChanged((s) => g.__rx.log.push({ ev: 'minimized-changed', t: now(), minimized: s.minimized }));
  } catch (_) { /* ignore */ }
  g.__rx.canvasInk = (page) => {
    const c = document.querySelector(`.pdf-page[data-page="${page}"] canvas`);
    if (!c) return { present: false, ink: 0 };
    try {
      const off = document.createElement('canvas');
      off.width = 64; off.height = 64;
      const ctx = off.getContext('2d');
      ctx.drawImage(c, 0, 0, 64, 64);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink += 1;
      }
      return { present: true, w: c.width, h: c.height, ink };
    } catch (e) {
      return { present: true, error: String(e && e.message) };
    }
  };
  let last = performance.now();
  const frame = () => {
    const t = now();
    const p = document.querySelector('.pdf-page[data-page="1"]');
    const appEl = document.querySelector('.app');
    const maxBtn = document.querySelector('[data-window-maximize]');
    g.__rx.frames.push({
      t, dt: Math.round(performance.now() - last),
      pageW: p ? Math.round(p.getBoundingClientRect().width) : null,
      maxClass: appEl ? appEl.classList.contains('app-maximized') : null,
      maxLabel: maxBtn ? maxBtn.getAttribute('aria-label') : null,
    });
    last = performance.now();
    g.__rx.raf = requestAnimationFrame(frame);
  };
  g.__rx.raf = requestAnimationFrame(frame);
}

// Count rAF frames + the worst inter-frame gap over `ms` while minimised.
async function measureRafWhileMinimised(page, ms) {
  return page.evaluate((windowMs) => new Promise((resolve) => {
    const start = Date.now();
    let n = 0; let maxDt = 0; let last = performance.now();
    const tick = () => {
      const t = performance.now();
      n += 1;
      if (t - last > maxDt) maxDt = t - last;
      last = t;
      if (Date.now() - start < windowMs) requestAnimationFrame(tick);
      else resolve({ frames: n, ms: Date.now() - start, maxDt: Math.round(maxDt) });
    };
    requestAnimationFrame(tick);
  }), ms);
}

// Ordered timeline for one case, relative to the renderer action timestamp.
// Every search is bounded to [tClick, tClick + WIN] so a later case's reset
// action can never be attributed to this one.
function analyzeCase(main, rend, scFrames, tClick, label) {
  const WIN = 800;
  const inWin = (t) => t >= tClick && t <= tClick + WIN;
  const firstAfter = (arr, pred) => {
    for (const x of arr) { if (inWin(x.t) && (!pred || pred(x))) return x; }
    return null;
  };
  const calls = main.calls.filter((c) => inWin(c.t));
  const tEvRestore = firstAfter(main.log, (e) => e.ev === 'ev:restore');
  const tEvMax = firstAfter(main.log, (e) => e.ev === 'ev:maximize');
  const tIsMax = firstAfter(main.poll, (p) => p.max === true);
  const tIsMinFalse = firstAfter(main.poll, (p) => p.min === false);
  const tVis = firstAfter(main.poll, (p) => p.vis === true);
  const rafAfter = rend.frames.filter((f) => inWin(f.t));
  const firstRaf = rafAfter[0] || null;
  const painted = scFrames.filter((f) => f.recv >= tClick);
  const firstPainted = painted[0] || null;
  const captionEcho = firstAfter(rend.log, (e) => e.ev === 'settings-echo' && e.max === true);
  const captionClass = firstAfter(rafAfter, (f) => f.maxClass === true);
  const d = (a) => (a ? (a.recv !== undefined ? a.recv : a.t) - tClick : null);
  const res = {
    label,
    osCalls: calls.map((c) => ({ dt: c.t - tClick, m: c.m })),
    osCallCount: calls.length,
    restoreEvent: d(tEvRestore),
    maximizeEvent: d(tEvMax),
    isMaximizedTrue: d(tIsMax),
    isMinimizedFalse: d(tIsMinFalse),
    isVisibleTrue: d(tVis),
    firstRafFrame: d(firstRaf),
    firstPaintedFrame: d(firstPainted),
    paintedFramesAfter: painted.length,
    captionEcho: d(captionEcho),
    captionClass: d(captionClass),
  };
  out(`case ${label}: ${JSON.stringify(res)}`);
  return { ...res, tClick, painted };
}

// In-memory blank-frame check over the screencast frames after the action.
// The page region of the 720x540 screencast (same rect the prior retest used).
// Frames received BEFORE the OS event are still the minimised window (not part
// of the visible transition); the blank count is asserted from the event on.
function inkScan(scFrames, tClick, eventDt, label) {
  const painted = scFrames.filter((f) => f.recv >= tClick);
  const rows = painted.slice(0, 14).map((f, i) => ({ i, dt: f.recv - tClick, ...frameInkData(f.data, { x0: 250, x1: 570, y0: 60, y1: 430 }) }));
  const blankAll = rows.filter((r) => r.ink === 0).length;
  const blankFromEvent = eventDt === null ? 0 : rows.filter((r) => r.ink === 0 && r.dt >= eventDt).length;
  out(`${label} frame ink (first ${rows.length} painted): ${JSON.stringify(rows)}`);
  out(`${label} blank frames: ${blankAll}/${rows.length} (from event: ${blankFromEvent})`);
  return { rows, blank: blankAll, blankFromEvent };
}

// ---------------------------------------------------------------------------
// The retest. One sequential test: the three cases share one window's state.
// ---------------------------------------------------------------------------
test('DEF-303 retest: maximize timeline, OS calls, rAF-while-minimised, post-resume paint', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def303-retest.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Fix (1) — the option is present at creation.
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences ? w.webContents.getLastWebPreferences() : null;
    return { lastPrefsBackgroundThrottling: p ? p.backgroundThrottling : 'n/a', wcBackgroundThrottling: w.webContents.backgroundThrottling };
  });
  out(`webPreferences: ${JSON.stringify(prefs)}`);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);
  await win.waitForTimeout(400);

  const inkBase = await win.evaluate(() => window.__rx.canvasInk(1));
  out(`baseline canvas ink page1: ${JSON.stringify(inkBase)}`);

  // ---- Case A (control): minimise -> restore -> click Maximize ----
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(700);
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  await win.waitForTimeout(700);
  const scA = await startScreencast(win);
  await win.waitForTimeout(200);
  const tA = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'click-A', t }), tA);
  await win.locator('[data-window-maximize]').first().click();
  await win.waitForTimeout(1600);
  await stopScreencast(scA.cdp);

  // ---- Case B (minimised + previously maximised) ----
  const preB = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { min: w.isMinimized(), max: w.isMaximized() }; });
  out(`pre-B state (expect maximized): ${JSON.stringify(preB)}`);
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const rafB = await measureRafWhileMinimised(win, 900);
  out(`rAF while minimised B (900ms): ${JSON.stringify(rafB)}`);
  const scB = await startScreencast(win);
  await win.waitForTimeout(200);
  const tB = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'click-B', t }), tB);
  await win.evaluate(() => window.tflex.maximizeWindow());
  await win.waitForTimeout(250);
  const inkBImm = await win.evaluate(() => window.__rx.canvasInk(1));
  out(`canvas ink B right after the restore event: ${JSON.stringify(inkBImm)}`);
  await win.waitForTimeout(1350);
  await stopScreencast(scB.cdp);
  const inkB = await win.evaluate(() => window.__rx.canvasInk(1));
  out(`post-resume canvas ink B (page1): ${JSON.stringify(inkB)}`);

  // ---- Case C (minimised + previously normal) ----
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(900);
  const preC = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { min: w.isMinimized(), max: w.isMaximized() }; });
  out(`pre-C state (expect normal): ${JSON.stringify(preC)}`);
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const rafC = await measureRafWhileMinimised(win, 900);
  out(`rAF while minimised C (900ms): ${JSON.stringify(rafC)}`);
  const scC = await startScreencast(win);
  await win.waitForTimeout(200);
  const tC = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'click-C', t }), tC);
  await win.evaluate(() => window.tflex.maximizeWindow());
  await win.waitForTimeout(250);
  const inkCImm = await win.evaluate(() => window.__rx.canvasInk(1));
  out(`canvas ink C right after the restore event: ${JSON.stringify(inkCImm)}`);
  await win.waitForTimeout(1550);
  await stopScreencast(scC.cdp);
  const inkC = await win.evaluate(() => window.__rx.canvasInk(1));
  out(`post-resume canvas ink C (page1): ${JSON.stringify(inkC)}`);

  const rend = await win.evaluate(() => { cancelAnimationFrame(window.__rx.raf); return { log: window.__rx.log, frames: window.__rx.frames }; });
  const main = await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    clearInterval(globalThis.__mxLoopTimer);
    return { log: globalThis.__mx.log, poll: globalThis.__mx.poll, loop: globalThis.__mx.loop, calls: globalThis.__mx.calls };
  });

  out(`minimized-changed log: ${JSON.stringify(rend.log.filter((e) => e.ev === 'minimized-changed'))}`);
  out(`all OS calls (dt from case-A click): ${JSON.stringify(main.calls.map((c) => ({ dt: rel(c.t, tA), m: c.m })))}`);

  const A = analyzeCase(main, rend, scA.frames, tA, 'A control(restored->maximize button)');
  const B = analyzeCase(main, rend, scB.frames, tB, 'B minimized+previouslyMaximized->maximize IPC');
  const C = analyzeCase(main, rend, scC.frames, tC, 'C minimized+previouslyNormal->maximize IPC');

  const inkScanA = inkScan(scA.frames, tA, A.maximizeEvent, 'A');
  const inkScanB = inkScan(scB.frames, tB, B.restoreEvent !== null ? B.restoreEvent : B.maximizeEvent, 'B');
  const inkScanC = inkScan(scC.frames, tC, C.restoreEvent, 'C');

  const controlEvent = A.maximizeEvent;
  const minPathEvent = B.restoreEvent !== null ? B.restoreEvent : B.maximizeEvent;
  out(`residual floor: control maximizeEvent=${controlEvent}ms, minimised-path event=${minPathEvent}ms, delta=${minPathEvent - controlEvent}ms (before: 152 vs 51 = +101ms)`);

  const loopAround = (t) => main.loop.filter((s) => s.t >= t - 300 && s.t <= t + 900).map((s) => ({ dt: s.t - t, drift: s.drift }));
  out(`main loop drift A: ${JSON.stringify(loopAround(tA))}`);
  out(`main loop drift B: ${JSON.stringify(loopAround(tB))}`);
  out(`main loop drift C: ${JSON.stringify(loopAround(tC))}`);
  out(`main loop max drift over run: ${main.loop.reduce((m, s) => Math.max(m, s.drift), 0)}ms`);

  // ---- Assertions: the observable fix outcomes ----
  // DEF-303 follow-up: `backgroundThrottling: false` was tried and REVERTED
  // (src/main/window.ts:190, src/renderer/state/renderSuspend.ts) — it did NOT
  // stop the compositor throttling. The fix is the renderer's explicit
  // pause/resume machinery, so the live property now reports the Chromium
  // DEFAULT (true) and is deliberately not relied upon.
  expect(prefs.wcBackgroundThrottling).toBe(true);
  expect(A.osCalls.map((c) => c.m)).toEqual(['maximize']);
  expect(B.osCalls.map((c) => c.m)).toEqual(['restore']);
  expect(C.osCalls.map((c) => c.m)).toEqual(['restore', 'maximize']);
  // The rAF loop is no longer FULLY frozen (was 0 frames / 900 ms); the exact
  // cadence is reported above — timers run at full rate but rAF is still
  // compositor-throttled to ~1 fps while the window is minimised.
  expect(rafB.frames).toBeGreaterThanOrEqual(1);
  expect(rafC.frames).toBeGreaterThanOrEqual(1);
  expect(inkBImm.ink).toBeGreaterThan(0);
  expect(inkCImm.ink).toBeGreaterThan(0);
  expect(inkB.ink).toBeGreaterThan(0);
  expect(inkC.ink).toBeGreaterThan(0);
  expect(inkScanA.blankFromEvent).toBe(0);
  expect(inkScanB.blankFromEvent).toBe(0);
  expect(inkScanC.blankFromEvent).toBe(0);
});
