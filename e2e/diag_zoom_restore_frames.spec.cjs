// Focused frame-level diagnosis (qa) — operator report #3 (2026-09-23):
//   1. "Maximise from minimised will still feel a touch slower."
//   2. "Zoom still jumps first and then the animation follows."
//
// This is a DIAGNOSTIC harness, not a pass/fail guard. It captures the actually
// PAINTED frames through a single zoom step and through a minimise -> maximise
// transition using CDP Page.startScreencast, and instruments the exact JS /
// main-process ORDER of events with timestamps. The assertions only prove the
// reproduction (the zoom changed / the window maximised); the evidence is the
// printed timelines and the saved frame images.
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

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
  if (app) await hardClose(app, 'diag-frames');
  app = null;
  win = null;
});
test.setTimeout(300000);

// ---------------------------------------------------------------------------
// CDP screencast — the actually painted frames.
// ---------------------------------------------------------------------------
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({
      data: ev.data,
      ts: ev.metadata && ev.metadata.timestamp ? ev.metadata.timestamp : null,
      recv: Date.now(),
      w: ev.metadata ? ev.metadata.deviceWidth : null,
      h: ev.metadata ? ev.metadata.deviceHeight : null,
    });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png',
    quality: 80,
    maxWidth: 720,
    maxHeight: 540,
    everyNthFrame: 1,
  });
  return { cdp, frames };
}

async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 }); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

// Slow the zoom FLIP by overriding the real CSS motion token the keyframe
// reads. Unlike CDP Animation.setPlaybackRate (which desynced the compositor
// animation from the main-thread one in testing), this changes the actual
// CSS duration, so the compositor and the CSSOM agree. Test instrumentation.
function slowZoomCss() {
  const style = document.createElement('style');
  style.id = '__diag_slow_zoom';
  style.textContent = ':root { --motion-duration-standard: 2500ms !important; }';
  document.head.appendChild(style);
}

// Save `count` frames starting at `from` (index into frames). Returns the
// saved paths + their receipt times so the caller can print an ordered list.
function saveFrames(frames, prefix, from, count) {
  const out = [];
  const start = Math.max(0, from);
  for (let i = start; i < Math.min(frames.length, start + count); i += 1) {
    const p = path.join(SHOTS, `${prefix}-${String(i - start).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
    out.push({ path: p, recv: frames[i].recv, ts: frames[i].ts });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zoom probe (renderer). Records the JS ORDER: click, layout (ResizeObserver),
// invert applied (MutationObserver on .pdf-page class/style), raster swap
// (canvas attrs), animationstart/end, and a per-rAF sampler of the page/slot
// rects, transform scale, flip class and canvas sizes.
// ---------------------------------------------------------------------------
function installZoomProbe() {
  const g = window;
  const zd = { marks: [], samples: [] };
  g.__zd = zd;
  const now = () => performance.now();
  const mark = (label, extra) => zd.marks.push({ label, t: now(), wall: Date.now(), ...(extra || {}) });
  const scroller = document.querySelector('.document-scroller');
  const page1 = () => document.querySelector('.pdf-page[data-page="1"]');
  const slot1 = () => document.querySelector('.page-slot[data-page="1"]');
  const canvas1 = () => document.querySelector('.pdf-page[data-page="1"] .pdf-page-canvas');
  const readout = document.querySelector('.zoom-percent');

  // (i) zoom state change — the readout text and the control click.
  if (readout) {
    new MutationObserver(() => mark('zoom-readout', { text: readout.textContent }))
      .observe(readout, { childList: true, characterData: true, subtree: true });
  }
  const inBtn = document.querySelector('button[aria-label="Zoom in"]');
  const outBtn = document.querySelector('button[aria-label="Zoom out"]');
  if (inBtn) inBtn.addEventListener('click', () => mark('click-in'), true);
  if (outBtn) outBtn.addEventListener('click', () => mark('click-out'), true);

  // (ii) LAYOUT change — the slot's flow box.
  const s = slot1();
  if (s) {
    new ResizeObserver(() => {
      const r = s.getBoundingClientRect();
      mark('ro-slot', { w: Math.round(r.width), h: Math.round(r.height) });
    }).observe(s);
  }

  // (iii) invert applied — class/style mutations on the page wrapper.
  const p = page1();
  if (p) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        mark('mo-page', {
          attr: m.attributeName,
          cls: p.className,
          from: p.style.getPropertyValue('--tf-zoom-flip-from'),
          dx: p.style.getPropertyValue('--tf-zoom-flip-dx'),
          dy: p.style.getPropertyValue('--tf-zoom-flip-dy'),
        });
      }
    }).observe(p, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // (v) raster swap — the canvas backing store / CSS size changing.
  const c = canvas1();
  if (c) {
    new MutationObserver(() => mark('mo-canvas', {
      w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height,
    })).observe(c, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
  }

  // (vi) animationstart / animationend.
  document.addEventListener('animationstart', (e) => mark('anim-start', {
    name: e.animationName,
    page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
  }), true);
  document.addEventListener('animationend', (e) => mark('anim-end', {
    name: e.animationName,
    page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
  }), true);

  // Per-rAF sampler.
  let last = now();
  const sample = () => {
    const t = now();
    const pp = page1(); const ss = slot1(); const cc = canvas1();
    const pr = pp ? pp.getBoundingClientRect() : null;
    const sr = ss ? ss.getBoundingClientRect() : null;
    const cr = cc ? cc.getBoundingClientRect() : null;
    let scale = null;
    if (pp) {
      const tr = getComputedStyle(pp).transform;
      if (!tr || tr === 'none') scale = 1;
      else { try { scale = new DOMMatrixReadOnly(tr).a; } catch (_) { scale = null; } }
    }
zd.samples.push({
      t, wall: performance.timeOrigin + t, dt: t - last,
      pageTop: pr ? Math.round(pr.top) : null, pageLeft: pr ? Math.round(pr.left) : null,
      pageW: pr ? Math.round(pr.width) : null, pageH: pr ? Math.round(pr.height) : null,
      slotTop: sr ? Math.round(sr.top) : null, slotLeft: sr ? Math.round(sr.left) : null,
      slotW: sr ? Math.round(sr.width) : null, slotH: sr ? Math.round(sr.height) : null,
      scale: scale === null ? null : Number(scale.toFixed(4)),
      flip: pp ? pp.classList.contains('pdf-page-zoom-flip') : null,
      from: pp ? pp.style.getPropertyValue('--tf-zoom-flip-from') : null,
      canvasW: cc ? cc.width : null, canvasH: cc ? cc.height : null,
      canvasCssW: cc ? cc.style.width : null, canvasCssH: cc ? cc.style.height : null,
      canvasRectW: cr ? Math.round(cr.width) : null, canvasRectH: cr ? Math.round(cr.height) : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      readout: readout ? readout.textContent : null,
      anims: document.getAnimations().length,
    });
    last = t;
    zd.raf = requestAnimationFrame(sample);
  };
  zd.raf = requestAnimationFrame(sample);
}
// ---------------------------------------------------------------------------
// Main-process probe (restore diagnosis). Re-registers the window-control IPC
// with an arrival timestamp, wraps the window methods, listens to the OS
// events, polls the window state every 5 ms, and runs a 10 ms event-loop
// drift probe to catch any long task around the click.
// ---------------------------------------------------------------------------
function installMainProbe({ BrowserWindow, ipcMain }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [], loop: [] };
  const w = BrowserWindow.getAllWindows()[0];
  g.__mxWin = w;
  const now = () => Date.now();
  const log = (ev, extra) => g.__mx.log.push({ ev, t: now(), ...(extra || {}) });
  try { ipcMain.removeHandler('window:maximize'); } catch (_) { /* ignore */ }
  ipcMain.handle('window:maximize', (event) => {
    log('ipc-max-arrive', { isMin: w.isMinimized(), isMax: w.isMaximized() });
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
  let last = now();
  g.__mxLoopTimer = setInterval(() => {
    const t = now();
    g.__mx.loop.push({ t, drift: t - last - 10 });
    last = t;
  }, 10);
}

// Renderer probe (restore diagnosis): resize / ResizeObserver / settings echo /
// caption class, plus a per-rAF frame sampler (its dt exposes throttling).
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
      t, dt: Math.round(performance.now() - last),
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

// Step the zoom ladder to `target` percent (e.g. "100") using the real
// Zoom-in / Zoom-out controls, settling between steps so the measured step is
// clean. Works in either direction.
async function stepTo(page, target) {
  const t = parseFloat(target);
  for (let i = 0; i < 30; i += 1) {
    const txt = (await page.locator('.zoom-percent').first().innerText()).trim();
    const cur = parseFloat(txt);
    if (Math.abs(cur - t) < 0.5) return txt;
    const btn = cur < t ? 'button[aria-label="Zoom in"]' : 'button[aria-label="Zoom out"]';
    await page.locator(btn).first().click();
    await page.waitForTimeout(330);
  }
  return (await page.locator('.zoom-percent').first().innerText()).trim();
}

function rel(t, base) { return t === null || t === undefined ? null : Math.round(t - base); }

// Print the ordered JS marks relative to the click mark.
function printMarks(marks, clickLabel) {
  const click = marks.find((m) => m.label === clickLabel);
  if (!click) { console.log('[DIAG] no click mark'); return; }
  const rows = marks
    .filter((m) => m.t >= click.t - 5)
    .map((m) => ({ dt: rel(m.t, click.t), label: m.label, ...(m.text ? { text: m.text } : {}), ...(m.attr ? { attr: m.attr } : {}), ...(m.cls ? { cls: m.cls } : {}), ...(m.from ? { from: m.from } : {}), ...(m.dx ? { dx: m.dx } : {}), ...(m.dy ? { dy: m.dy } : {}), ...(m.name ? { name: m.name } : {}), ...(m.page ? { page: m.page } : {}), ...(m.w !== undefined ? { w: m.w, h: m.h } : {}) }));
  console.log(`[DIAG] marks (ms after ${clickLabel}): ${JSON.stringify(rows)}`);
  return click;
}

// Compact per-rAF timeline around the click.
function printSamples(samples, clickT, n) {
  const after = samples.filter((s) => s.t >= clickT - 20).slice(0, n);
  const rows = after.map((s) => ({
    dt: rel(s.t, clickT), rdt: Math.round(s.dt),
    slotW: s.slotW, slotH: s.slotH, pageW: s.pageW, pageH: s.pageH,
    scale: s.scale, flip: s.flip ? 1 : 0, from: s.from,
    cW: s.canvasW, cCssW: s.canvasCssW, cRectW: s.canvasRectW,
    scroll: s.scrollTop, readout: s.readout, anims: s.anims,
  }));
  console.log(`[DIAG] rAF timeline: ${JSON.stringify(rows)}`);
}

// ---------------------------------------------------------------------------
// DIAGNOSIS 1 � the zoom "jumps first, then the animation follows".
// ---------------------------------------------------------------------------
// Shared zoom-step diagnosis: step to `fromPct`, then perform ONE ladder step
// in `direction`, capturing the painted frames in slow motion plus the JS order.
async function runZoomDiagnosis({ label, file, fromPct, direction, expectPct }) {
  await openFile(app, win, tmpCopy(REPORT, file));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  const at = await stepTo(win, String(fromPct));
  console.log(`[DIAG] ${label} start readout=${at}`);

  await win.evaluate(installZoomProbe);
  await win.waitForTimeout(300);

  const { cdp, frames } = await startScreencast(win);
  await win.evaluate(slowZoomCss);
  await win.waitForTimeout(250);
  const clickWall = Date.now();
  const btn = direction > 0 ? 'button[aria-label="Zoom in"]' : 'button[aria-label="Zoom out"]';
  await win.locator(btn).first().click();
  await win.waitForTimeout(3200);
  await stopScreencast(cdp);

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__zd.raf);
    const s = document.getElementById('__diag_slow_zoom');
    if (s) s.remove();
    return { marks: window.__zd.marks, samples: window.__zd.samples };
  });
  const click = printMarks(data.marks, direction > 0 ? 'click-in' : 'click-out');
  printSamples(data.samples, click ? click.t : 0, 40);

  const idx0 = frames.findIndex((f) => f.recv >= clickWall);
  const saved = saveFrames(frames, `diag-zoom-frame-${direction > 0 ? 'in' : 'out'}`, idx0 - 2, 20);
  console.log(`[DIAG] ${label} frames total=${frames.length} firstAfterClick=${idx0}`);
  // Correlate each frame to the nearest rAF sample by wall clock; print the
  // capture timestamp and the CSS-view page/slot widths that frame should show.
  const nearest = (wall) => {
    let best = null; let bd = Infinity;
    for (const s of data.samples) { const d = Math.abs(s.wall - wall); if (d < bd) { bd = d; best = s; } }
    return best;
  };
  console.log(`[DIAG] ${label} frameCorr: ${JSON.stringify(frames.map((f, i) => {
    const s = nearest(f.recv);
    return {
      i, recvMs: rel(f.recv, clickWall), ts: f.ts,
      slotW: s ? s.slotW : null, cssPageW: s ? s.pageW : null, scale: s ? s.scale : null,
      flip: s ? (s.flip ? 1 : 0) : null,
    };
  }))}`);
  console.log(`[DIAG] ${label} saved: ${JSON.stringify(saved.map((s, i) => ({ i, dt: rel(s.recv, clickWall), path: path.basename(s.path) })))}`);

  const readout = (await win.locator('.zoom-percent').first().innerText()).trim();
  console.log(`[DIAG] ${label} end readout=${readout}`);
  expect(parseFloat(readout)).toBe(expectPct);
  expect(data.marks.some((m) => m.label === 'anim-start' && m.name === 'tf-page-zoom-flip')).toBe(true);
  expect(saved.length).toBeGreaterThanOrEqual(10);
}

test('DIAG zoom-in painted frames + JS order (100% -> 110%)', async () => {
  await runZoomDiagnosis({ label: 'zoom-in', file: 'diag-zoom-in.pdf', fromPct: 100, direction: 1, expectPct: 110 });
});

test('DIAG zoom-out painted frames + JS order (110% -> 100%)', async () => {
  await runZoomDiagnosis({ label: 'zoom-out', file: 'diag-zoom-out.pdf', fromPct: 110, direction: -1, expectPct: 100 });
});

// ---------------------------------------------------------------------------
// DIAGNOSIS 2 — the restore-from-minimised latency.
// ---------------------------------------------------------------------------
function analyzeRestore(main, rend, tClick, label) {
  const firstAfter = (arr, t, pred) => {
    for (const x of arr) { if (x.t >= t && (!pred || pred(x))) return x; }
    return null;
  };
  const tIpc = firstAfter(main.log, tClick, (e) => e.ev === 'ipc-max-arrive');
  const tCallMax = firstAfter(main.log, tClick, (e) => e.ev === 'call:maximize');
  const tEvMax = firstAfter(main.log, tClick, (e) => e.ev === 'ev:maximize');
  const tIsMax = firstAfter(main.poll, tClick, (p) => p.max === true);
  const tVis = firstAfter(main.poll, tClick, (p) => p.vis === true);
  const framesAfter = rend.frames.filter((f) => f.t >= tClick);
  const firstFrame = framesAfter[0] || null;
  const captionEcho = firstAfter(rend.log, tClick, (e) => e.ev === 'settings-echo' && e.max === true);
  const captionClass = firstAfter(framesAfter, tClick, (f) => f.maxClass === true);
  const maxDt = framesAfter.length ? Math.max(...framesAfter.map((f) => f.dt)) : null;
  const d = (a) => (a ? a.t - tClick : null);
  const out = {
    label,
    ipcArrive: d(tIpc), callMaximize: d(tCallMax), maximizeEvent: d(tEvMax),
    isMaximizedTrue: d(tIsMax), isVisibleTrue: d(tVis),
    firstFrame: d(firstFrame), captionEcho: d(captionEcho), captionClass: d(captionClass),
    maxFrameDt: maxDt,
    ipcIsMin: tIpc ? tIpc.isMin : null,
    ipcIsMax: tIpc ? tIpc.isMax : null,
  };
  console.log(`[DIAG] restore ${label}: ${JSON.stringify(out)}`);
  return out;
}

test('DIAG restore-from-minimised painted frames + timeline', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'diag-restore.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);
  await win.waitForTimeout(400);

  // ---- Phase A (control): minimise -> restore -> maximise (button click) ----
  await win.evaluate(() => window.__rx.marks.push({ label: 'min-click', t: Date.now() }));
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const minState = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { isMin: w.isMinimized(), isMax: w.isMaximized(), vis: w.isVisible() };
  });
  console.log(`[DIAG] after minimise: ${JSON.stringify(minState)}`);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  await win.waitForTimeout(700);

  const a = await startScreencast(win);
  await win.waitForTimeout(200);
  const clickA = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'max-click-A', t }), clickA);
  await win.locator('[data-window-maximize]').first().click();
  await win.waitForTimeout(1600);
  await stopScreencast(a.cdp);
  const idxA = a.frames.findIndex((f) => f.recv >= clickA);
  const savedA = saveFrames(a.frames, 'diag-restore-frame-control', idxA, 10);
  console.log(`[DIAG] control frames total=${a.frames.length} firstAfterClick=${idxA}`);
  console.log(`[DIAG] control saved: ${JSON.stringify(savedA.map((s, i) => ({ i, dt: rel(s.recv, clickA), path: path.basename(s.path) })))}`);

  // Back to restored for the direct path.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);

  // ---- Phase B (direct): minimise -> maximise (main call, taskbar preview) ----
  await win.evaluate(() => window.__rx.marks.push({ label: 'min-click-B', t: Date.now() }));
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const b = await startScreencast(win);
  await win.waitForTimeout(200);
  const clickB = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'max-call-B', t }), clickB);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); });
  await win.waitForTimeout(1600);
  await stopScreencast(b.cdp);
  const idxB = b.frames.findIndex((f) => f.recv >= clickB);
  const savedB = saveFrames(b.frames, 'diag-restore-frame-direct', idxB, 10);
  console.log(`[DIAG] direct frames total=${b.frames.length} firstAfterClick=${idxB}`);
  console.log(`[DIAG] direct saved: ${JSON.stringify(savedB.map((s, i) => ({ i, dt: rel(s.recv, clickB), path: path.basename(s.path) })))}`);

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__rx.raf);
    return { log: window.__rx.log, frames: window.__rx.frames, marks: window.__rx.marks };
  });
  const main = await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    clearInterval(globalThis.__mxLoopTimer);
    return { log: globalThis.__mx.log, poll: globalThis.__mx.poll, loop: globalThis.__mx.loop };
  });

  analyzeRestore(main, data, clickA, 'control(restored->maximise)');
  analyzeRestore(main, data, clickB, 'direct(minimised->maximise)');

  // rAF throttling: deltas just before minimise, while minimised, after restore.
  const minA = data.marks.find((m) => m.label === 'min-click');
  const minB = data.marks.find((m) => m.label === 'min-click-B');
  const windowDt = (from, to) => data.frames.filter((f) => f.t >= from && f.t < to).map((f) => f.dt);
  if (minA) {
    const before = windowDt(minA.t - 800, minA.t);
    const during = windowDt(minA.t + 200, minA.t + 1100);
    console.log(`[DIAG] rAF dt before minimise A: ${JSON.stringify(before.slice(-12))}`);
    console.log(`[DIAG] rAF dt while minimised A: ${JSON.stringify(during)}`);
  }
  if (minB) {
    const duringB = windowDt(minB.t + 200, minB.t + 1100);
    console.log(`[DIAG] rAF dt while minimised B: ${JSON.stringify(duringB)}`);
  }
  const afterRestore = data.frames.filter((f) => f.t >= clickA - 300 && f.t < clickA + 400).map((f) => f.dt);
  console.log(`[DIAG] rAF dt around control maximise: ${JSON.stringify(afterRestore)}`);

  // Main-process event-loop drift around the clicks.
  const loopAround = (t) => main.loop.filter((s) => s.t >= t - 300 && s.t <= t + 900).map((s) => ({ dt: s.t - t, drift: s.drift }));
  console.log(`[DIAG] main loop drift around control click: ${JSON.stringify(loopAround(clickA))}`);
  console.log(`[DIAG] main loop drift around direct click: ${JSON.stringify(loopAround(clickB))}`);
  const maxDrift = main.loop.reduce((m, s) => Math.max(m, s.drift), 0);
  console.log(`[DIAG] main loop max drift over run: ${maxDrift}ms`);

  // Main-process event order around each click.
  const order = (t) => main.log.filter((e) => e.t >= t - 50 && e.t <= t + 900).map((e) => ({ dt: e.t - t, ev: e.ev }));
  console.log(`[DIAG] main event order control: ${JSON.stringify(order(clickA))}`);
  console.log(`[DIAG] main event order direct: ${JSON.stringify(order(clickB))}`);

  expect(main.log.some((e) => e.ev === 'ev:maximize')).toBe(true);
});
