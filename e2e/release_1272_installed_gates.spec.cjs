// QA 1.27.2 patch-release INSTALLED gates (Gate 2 version, Gate 3 zoom frames,
// Gate 4 restore probe). Runs against the INSTALLED 1.27.2 executable.
//
// Evidence discipline: every frame measurement is done IN MEMORY from the CDP
// screencast buffers, so the recorded evidence images under screenshots/ are
// never overwritten. Exactly ONE screenshot is written (the mid-zoom frame).
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const INSTALLED = process.env.TFLEX_E2E_EXE
  || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp([], null, INSTALLED);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'rel1272');
  app = null;
  win = null;
});
test.setTimeout(300000);

// ---------------------------------------------------------------------------
// CDP screencast - the actually painted frames (kept in memory).
// ---------------------------------------------------------------------------
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png', quality: 80, maxWidth: 720, maxHeight: 540, everyNthFrame: 1,
  });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

// Slow the zoom FLIP by overriding the real CSS motion token the keyframe reads.
function slowZoomCss() {
  const style = document.createElement('style');
  style.id = '__diag_slow_zoom';
  style.textContent = ':root { --motion-duration-standard: 2500ms !important; }';
  document.head.appendChild(style);
}

// WHITE SHEET EDGE width from an in-memory PNG buffer (same metric as the
// pre-fix diagnosis: frame 00 = 304, post-click = 335). The thumbnail rail is
// excluded (x >= 150).
function measureBuffer(buf, row = 250) {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  const y = Math.min(row, height - 1);
  let left = -1; let right = -1; let darkX = -1; let darkVal = 999;
  for (let x = 150; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    if (r >= 250 && g >= 250 && b >= 250) { if (left < 0) left = x; right = x; }
    const lum = (r + g + b) / 3;
    if (lum < darkVal) { darkVal = lum; darkX = x; }
  }
  return { w: width, h: height, left, right, width: right - left, darkX, darkVal: Math.round(darkVal) };
}

// Ink (non-white pixel count) inside a rect of an in-memory frame - proves the
// page is PAINTED (not blank).
function inkBuffer(buf, rect) {
  const png = PNG.sync.read(buf);
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

// ---------------------------------------------------------------------------
// Zoom probe (renderer): records the JS ORDER and the SLOT's flip class/vars
// (the FLIP unit is `.page-slot[data-page="N"]` since the DEF-302 fix).
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

  if (readout) {
    new MutationObserver(() => mark('zoom-readout', { text: readout.textContent }))
      .observe(readout, { childList: true, characterData: true, subtree: true });
  }
  const inBtn = document.querySelector('button[aria-label="Zoom in"]');
  const outBtn = document.querySelector('button[aria-label="Zoom out"]');
  if (inBtn) inBtn.addEventListener('click', () => mark('click-in'), true);
  if (outBtn) outBtn.addEventListener('click', () => mark('click-out'), true);

  const s = slot1();
  if (s) {
    new ResizeObserver(() => {
      const r = s.getBoundingClientRect();
      mark('ro-slot', { w: Math.round(r.width), h: Math.round(r.height) });
    }).observe(s);
  }
  const readFlip = (el) => ({
    cls: el.className,
    from: el.style.getPropertyValue('--tf-zoom-flip-from'),
    dx: el.style.getPropertyValue('--tf-zoom-flip-dx'),
    dy: el.style.getPropertyValue('--tf-zoom-flip-dy'),
  });
  if (s) {
    new MutationObserver((muts) => {
      for (const m of muts) mark('mo-slot', { attr: m.attributeName, ...readFlip(s) });
    }).observe(s, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  const p = page1();
  if (p) {
    new MutationObserver((muts) => {
      for (const m of muts) mark('mo-page', { attr: m.attributeName, ...readFlip(p) });
    }).observe(p, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  const c = canvas1();
  if (c) {
    new MutationObserver(() => mark('mo-canvas', {
      w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height,
    })).observe(c, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
  }
  const targetCls = (e) => (e.target && e.target.className ? String(e.target.className) : null);
  document.addEventListener('animationstart', (e) => mark('anim-start', {
    name: e.animationName, page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
    cls: targetCls(e),
  }), true);
  document.addEventListener('animationend', (e) => mark('anim-end', {
    name: e.animationName, page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
    cls: targetCls(e),
  }), true);

  const scaleOf = (el) => {
    if (!el) return null;
    const tr = getComputedStyle(el).transform;
    if (!tr || tr === 'none') return 1;
    try { return Number(new DOMMatrixReadOnly(tr).a.toFixed(4)); } catch (_) { return null; }
  };
  let last = now();
  const sample = () => {
    const t = now();
    const pp = page1(); const ss = slot1(); const cc = canvas1();
    const pr = pp ? pp.getBoundingClientRect() : null;
    const sr = ss ? ss.getBoundingClientRect() : null;
    zd.samples.push({
      t, wall: performance.timeOrigin + t, dt: t - last,
      slotTop: sr ? Math.round(sr.top) : null, slotLeft: sr ? Math.round(sr.left) : null,
      slotW: sr ? Math.round(sr.width) : null, slotH: sr ? Math.round(sr.height) : null,
      slotScale: scaleOf(ss), pageScale: scaleOf(pp),
      slotFlip: ss ? ss.classList.contains('pdf-page-zoom-flip') : null,
      pageFlip: pp ? pp.classList.contains('pdf-page-zoom-flip') : null,
      slotFrom: ss ? ss.style.getPropertyValue('--tf-zoom-flip-from') : null,
      slotDx: ss ? ss.style.getPropertyValue('--tf-zoom-flip-dx') : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      readout: readout ? readout.textContent : null,
    });
    last = t;
    zd.raf = requestAnimationFrame(sample);
  };
  zd.raf = requestAnimationFrame(sample);
}

// ---------------------------------------------------------------------------
// Main-process probe (restore diagnosis). Spies on the window's OWN methods
// (the product handler calls them) and listens to the OS events. It does NOT
// re-register the window-control IPC - that would bypass the product's
// `planCaptionMaximize` and test the probe instead of the fix.
// ---------------------------------------------------------------------------
function installMainProbe({ BrowserWindow }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [], loop: [], calls: [] };
  const w = BrowserWindow.getAllWindows()[0];
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
// caption class, a per-rAF frame sampler, and a canvas-ink reader.
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
  try {
    window.tflex.onMinimizedChanged((s) => g.__rx.log.push({
      ev: 'minimized-changed', t: now(), minimized: s.minimized,
    }));
  } catch (_) { /* ignore */ }
  g.__rx.canvasInk = () => {
    const c = document.querySelector('.pdf-page[data-page="1"] canvas');
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

function printMarks(marks, clickLabel) {
  const click = marks.find((m) => m.label === clickLabel);
  if (!click) { console.log('[DIAG] no click mark'); return null; }
  const rows = marks
    .filter((m) => m.t >= click.t - 5)
    .map((m) => {
      const o = { dt: rel(m.t, click.t), label: m.label };
      for (const k of ['text', 'attr', 'cls', 'from', 'dx', 'dy', 'name', 'page', 'w', 'h']) {
        if (m[k] !== undefined && m[k] !== '') o[k] = m[k];
      }
      return o;
    });
  console.log(`[DIAG] marks (ms after ${clickLabel}): ${JSON.stringify(rows)}`);
  return click;
}

// Shared zoom-step diagnosis: step to `fromPct`, then perform ONE ladder step
// in `direction`, capturing the painted frames in slow motion plus the JS order.
// Edge widths are measured IN MEMORY; only the mid-zoom frame is written.
async function runZoom({ label, fromPct, direction, expectPct, saveMid }) {
  await openFile(app, win, tmpCopy(REPORT, `rel1272-${label}.pdf`));
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

  const idx0 = frames.findIndex((f) => f.recv >= clickWall);
  console.log(`[DIAG] ${label} frames total=${frames.length} firstAfterClick=${idx0}`);

  // First ~6 painted frames after the click (plus the 2 pre-click frames for
  // reference), measured in memory.
  const from = Math.max(0, idx0 - 2);
  const edges = [];
  for (let i = from; i < Math.min(frames.length, from + 8); i += 1) {
    const m = measureBuffer(Buffer.from(frames[i].data, 'base64'));
    edges.push({ i: i - from, dt: rel(frames[i].recv, clickWall), left: m.left, right: m.right, width: m.width, darkX: m.darkX });
  }
  console.log(`[DIAG] ${label} EDGE WIDTHS: ${JSON.stringify(edges)}`);

  // Save exactly ONE mid-zoom frame (never overwriting recorded evidence).
  if (saveMid) {
    const midWall = clickWall + 1250;
    let best = null; let bd = Infinity;
    for (const f of frames) { const d = Math.abs(f.recv - midWall); if (d < bd) { bd = d; best = f; } }
    if (best) {
      const p = path.join(SHOTS, saveMid);
      fs.writeFileSync(p, Buffer.from(best.data, 'base64'));
      const m = measureBuffer(Buffer.from(best.data, 'base64'));
      console.log(`[DIAG] ${label} MID FRAME saved=${saveMid} dt=${rel(best.recv, clickWall)} edge=${JSON.stringify(m)}`);
    }
  }

  const readout = (await win.locator('.zoom-percent').first().innerText()).trim();
  console.log(`[DIAG] ${label} end readout=${readout}`);
  expect(parseFloat(readout)).toBe(expectPct);
  expect(data.marks.some((m) => m.label === 'anim-start' && m.name === 'tf-page-zoom-flip')).toBe(true);
  return { edges, marks: data.marks };
}

// ---------------------------------------------------------------------------
// GATE 2 - the installed app reports 1.27.2.
// ---------------------------------------------------------------------------
test('GATE2 installed app.getVersion() is 1.27.2', async () => {
  const av = await app.evaluate(({ app: a }) => a.getVersion());
  console.log(`[GATE2] installed app.getVersion()=${av} exe=${INSTALLED}`);
  expect(av).toBe('1.27.2');
});

// ---------------------------------------------------------------------------
// GATE 3 - the DEF-302 frame check: the WHITE SHEET EDGE must hold the OLD
// width in the first frames and grow with the animation.
// ---------------------------------------------------------------------------
test('GATE3 zoom-in painted frames (100% -> 110%)', async () => {
  await runZoom({ label: 'zoom-in', fromPct: 100, direction: 1, expectPct: 110, saveMid: 'def302-1272-mid-zoom.png' });
});

test('GATE3 zoom-out painted frames (110% -> 100%)', async () => {
  await runZoom({ label: 'zoom-out', fromPct: 110, direction: -1, expectPct: 100, saveMid: null });
});

// ---------------------------------------------------------------------------
// GATE 4 - the restore probe (OS-call counts, timing, paint/blank frames).
// ---------------------------------------------------------------------------
function analyzeRestore(main, rend, tClick, label) {
  const firstAfter = (arr, t, pred) => {
    for (const x of arr) { if (x.t >= t && (!pred || pred(x))) return x; }
    return null;
  };
  const tCall = firstAfter(main.log, tClick, (e) => e.ev.startsWith('call:'));
  const tEvMax = firstAfter(main.log, tClick, (e) => e.ev === 'ev:maximize');
  const tEvRestore = firstAfter(main.log, tClick, (e) => e.ev === 'ev:restore');
  const tIsMax = firstAfter(main.poll, tClick, (p) => p.max === true);
  const tVis = firstAfter(main.poll, tClick, (p) => p.vis === true);
  const framesAfter = rend.frames.filter((f) => f.t >= tClick);
  const firstFrame = framesAfter[0] || null;
  const captionEcho = firstAfter(rend.log, tClick, (e) => e.ev === 'settings-echo' && e.max === true);
  const captionClass = firstAfter(framesAfter, tClick, (f) => f.maxClass === true);
  const maxDt = framesAfter.length ? Math.max(...framesAfter.map((f) => f.dt)) : null;
  const calls = main.calls
    .filter((c) => c.t >= tClick - 5 && c.t <= tClick + 2000)
    .map((c) => ({ dt: c.t - tClick, m: c.m }));
  const d = (a) => (a ? a.t - tClick : null);
  const out = {
    label,
    firstCall: d(tCall), firstCallName: tCall ? tCall.ev : null,
    restoreEvent: d(tEvRestore), maximizeEvent: d(tEvMax),
    isMaximizedTrue: d(tIsMax), isVisibleTrue: d(tVis),
    firstFrame: d(firstFrame), captionEcho: d(captionEcho), captionClass: d(captionClass),
    maxFrameDt: maxDt, osCalls: calls,
  };
  console.log(`[DIAG] restore ${label}: ${JSON.stringify(out)}`);
  return out;
}

test('GATE4 restore-from-minimised OS calls + timing + paint', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'rel1272-restore.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);
  await win.waitForTimeout(400);

  // ---- Phase A (control): minimise -> restore -> maximise (button click) ----
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  await win.waitForTimeout(700);

  const a = await startScreencast(win);
  await win.waitForTimeout(200);
  const clickA = Date.now();
  await win.locator('[data-window-maximize]').first().click();
  await win.waitForTimeout(1600);
  await stopScreencast(a.cdp);
  const idxA = a.frames.findIndex((f) => f.recv >= clickA);
  const inkA = a.frames.slice(idxA, idxA + 10).map((f, i) => ({
    i, dt: rel(f.recv, clickA), ...inkBuffer(Buffer.from(f.data, 'base64'), { x0: 250, x1: 570, y0: 60, y1: 430 }),
  }));
  console.log(`[DIAG] control frame ink: ${JSON.stringify(inkA)}`);

  // Back to restored for the direct path.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);

  // ---- Phase B (handler path): previously maximised -> minimise -> maximise
  // IPC (the caption button's own call). The product handler must make ONE
  // restore() and no maximize(). ----
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); });
  await win.waitForTimeout(900);
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);

  const b = await startScreencast(win);
  await win.waitForTimeout(200);
  const clickB = Date.now();
  await win.evaluate(() => window.tflex.maximizeWindow());
  await win.waitForTimeout(1600);
  await stopScreencast(b.cdp);
  const idxB = b.frames.findIndex((f) => f.recv >= clickB);
  const inkB = b.frames.slice(idxB, idxB + 10).map((f, i) => ({
    i, dt: rel(f.recv, clickB), ...inkBuffer(Buffer.from(f.data, 'base64'), { x0: 250, x1: 570, y0: 60, y1: 430 }),
  }));
  console.log(`[DIAG] handler frame ink: ${JSON.stringify(inkB)}`);

  const inkAfterB = await win.evaluate(() => window.__rx.canvasInk());
  console.log(`[DIAG] post-resume canvas ink B: ${JSON.stringify(inkAfterB)}`);

  // ---- Phase C (OS floor): minimise -> main win.maximize() (taskbar preview) ----
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const clickC = Date.now();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); });
  await win.waitForTimeout(1600);

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__rx.raf);
    return { log: window.__rx.log, frames: window.__rx.frames, marks: window.__rx.marks };
  });
  const main = await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    clearInterval(globalThis.__mxLoopTimer);
    return { log: globalThis.__mx.log, poll: globalThis.__mx.poll, loop: globalThis.__mx.loop, calls: globalThis.__mx.calls };
  });

  const A = analyzeRestore(main, data, clickA, 'control(restored->maximise)');
  const B = analyzeRestore(main, data, clickB, 'handler(minimised+previouslyMaximised->maximise IPC)');
  const C = analyzeRestore(main, data, clickC, 'osFloor(minimised->main maximize)');

  const maxDrift = main.loop.reduce((m, s) => Math.max(m, s.drift), 0);
  console.log(`[DIAG] main loop max drift over run: ${maxDrift}ms`);

  // Assertions: the control makes one maximize(); the handler makes ONE
  // restore() and NO maximize(); the content is painted (ink > 0) in every
  // post-event frame.
  const ctrlCalls = A.osCalls.map((c) => c.m);
  const handlerCalls = B.osCalls.map((c) => c.m);
  expect(ctrlCalls.filter((m) => m === 'maximize').length, 'control: one maximize()').toBe(1);
  expect(handlerCalls.filter((m) => m === 'restore').length, 'handler: one restore()').toBe(1);
  expect(handlerCalls.filter((m) => m === 'maximize').length, 'handler: no maximize()').toBe(0);
  expect(inkA.every((f) => f.ink > 0), 'control: every post-event frame painted').toBe(true);
  expect(inkB.every((f) => f.ink > 0), 'handler: every post-event frame painted').toBe(true);
  expect(inkAfterB.ink, 'post-resume canvas painted').toBeGreaterThan(0);
  expect(main.log.some((e) => e.ev === 'ev:maximize')).toBe(true);
});
