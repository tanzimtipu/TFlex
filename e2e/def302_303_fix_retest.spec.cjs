// QA FIX-READY retest (2026-09-23) â€” DEF-302 (reopened) + DEF-303.
//
// Re-runs the frame-level CDP-screencast diagnosis against the fixes:
//   DEF-302 â€” the FLIP unit moved from the content-only `.pdf-page` to the
//             PAPER-OWNING `.page-slot` (`ZOOM_FLIP_UNIT_SELECTOR`), so the
//             sheet outline and the content animate together. The probe now
//             observes the SLOT's class/vars (the old harness queried
//             `.pdf-page`). Frames are saved under NEW prefixes so the
//             pre-fix evidence images are never overwritten.
//   DEF-303 â€” `backgroundThrottling: false`, the single-transition
//             `planCaptionMaximize` restore, and the renderer's
//             `window:minimizedChanged` pause. The main probe NO LONGER
//             re-registers the IPC handler (that would bypass the product's
//             planner); it spies on the window's own methods instead.
//
// Diagnostic harness, not a pass/fail guard: the assertions only prove the
// reproduction (the zoom changed / the window maximised); the evidence is the
// printed timelines, the measured frame edge widths and the saved frames.
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
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
  if (app) await hardClose(app, 'def302-303-fix');
  app = null;
  win = null;
});
test.setTimeout(300000);

// ---------------------------------------------------------------------------
// CDP screencast â€” the actually painted frames.
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
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

// Slow the zoom FLIP by overriding the real CSS motion token the keyframe
// reads (the same test-injected slowed duration as the pre-fix diagnosis).
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
// Frame measurement (pngjs). The sheet is pure white on the light
// `--bg-canvas`; the thumbnail rail is excluded (x >= 150).
//   outer  â€” leftmost / rightmost near-white pixel (>=250): the sheet's outer
//            edge INCLUDING the `.pdf-page` shadow gradient. This is the
//            metric the pre-fix diagnosis used (frame 00 = 304, post = 335).
//   dark   â€” x of the darkest pixel on the row: the `.pdf-page` shadow's
//            darkest point (the content edge).
// ---------------------------------------------------------------------------
const X_MIN = 150;
function measureFrame(file, row = 250) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const y = Math.min(row, height - 1);
  let left = -1;
  let right = -1;
  let darkX = -1;
  let darkVal = 999;
  for (let x = X_MIN; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= 250 && g >= 250 && b >= 250) {
      if (left < 0) left = x;
      right = x;
    }
    const lum = (r + g + b) / 3;
    if (lum < darkVal) { darkVal = lum; darkX = x; }
  }
  return { w: width, h: height, left, right, width: right - left, darkX, darkVal: Math.round(darkVal) };
}

// Ink (non-white pixel count) inside a rect of a saved frame â€” used to prove
// the page is PAINTED (not blank) in a screencast frame.
function frameInk(file, rect) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const x0 = Math.max(0, rect.x0);
  const x1 = Math.min(width - 1, rect.x1);
  const y0 = Math.max(0, rect.y0);
  const y1 = Math.min(height - 1, rect.y1);
  let ink = 0;
  let total = 0;
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
// Zoom probe (renderer). Records the JS ORDER: click, layout (ResizeObserver),
// invert applied (MutationObserver on the SLOT — the FLIP unit), raster swap
// (canvas attrs), animationstart/end, and a per-rAF sampler of the slot/page
// rects, transforms, flip class and canvas sizes.
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

  // (ii) LAYOUT change — the slot's flow box.
  const s = slot1();
  if (s) {
    new ResizeObserver(() => {
      const r = s.getBoundingClientRect();
      mark('ro-slot', { w: Math.round(r.width), h: Math.round(r.height) });
    }).observe(s);
  }

  // (iii) invert applied — class/style mutations on the SLOT (the FLIP unit).
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
  // The content wrapper must NOT carry the flip any more.
  const p = page1();
  if (p) {
    new MutationObserver((muts) => {
      for (const m of muts) mark('mo-page', { attr: m.attributeName, ...readFlip(p) });
    }).observe(p, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // (v) raster swap — the canvas backing store / CSS size changing.
  const c = canvas1();
  if (c) {
    new MutationObserver(() => mark('mo-canvas', {
      w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height,
    })).observe(c, { attributes: true, attributeFilter: ['width', 'height', 'style'] });
  }

  // (vi) animationstart / animationend — record the TARGET's class so the
  // slot (paper unit) vs the page (content) is unambiguous.
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
    const cr = cc ? cc.getBoundingClientRect() : null;
    zd.samples.push({
      t, wall: performance.timeOrigin + t, dt: t - last,
      pageTop: pr ? Math.round(pr.top) : null, pageLeft: pr ? Math.round(pr.left) : null,
      pageW: pr ? Math.round(pr.width) : null, pageH: pr ? Math.round(pr.height) : null,
      slotTop: sr ? Math.round(sr.top) : null, slotLeft: sr ? Math.round(sr.left) : null,
      slotW: sr ? Math.round(sr.width) : null, slotH: sr ? Math.round(sr.height) : null,
      slotScale: scaleOf(ss), pageScale: scaleOf(pp),
      slotFlip: ss ? ss.classList.contains('pdf-page-zoom-flip') : null,
      pageFlip: pp ? pp.classList.contains('pdf-page-zoom-flip') : null,
      slotFrom: ss ? ss.style.getPropertyValue('--tf-zoom-flip-from') : null,
      slotDx: ss ? ss.style.getPropertyValue('--tf-zoom-flip-dx') : null,
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
// Main-process probe (restore diagnosis). Spies on the window's OWN methods
// (the product handler calls them) and listens to the OS events. It does NOT
// re-register the window-control IPC — that would bypass the product's
// `planCaptionMaximize` and test the probe instead of the fix.
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
// caption class, a per-rAF frame sampler (its dt exposes throttling), and a
// canvas-ink reader that proves the page is PAINTED (not blank).
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
  // DEF-303 — the renderer's pause signal (main -> renderer).
  try {
    window.tflex.onMinimizedChanged((s) => g.__rx.log.push({
      ev: 'minimized-changed', t: now(), minimized: s.minimized,
    }));
  } catch (_) { /* ignore */ }
  // Canvas ink: downsample the visible page canvas and count non-white pixels.
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

// Step the zoom ladder to `target` percent using the real Zoom controls.
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

function printSamples(samples, clickT, n) {
  const after = samples.filter((s) => s.t >= clickT - 20).slice(0, n);
  const rows = after.map((s) => ({
    dt: rel(s.t, clickT), rdt: Math.round(s.dt),
    slotW: s.slotW, slotH: s.slotH, slotScale: s.slotScale, slotFlip: s.slotFlip ? 1 : 0,
    slotFrom: s.slotFrom, slotDx: s.slotDx,
    pageW: s.pageW, pageScale: s.pageScale, pageFlip: s.pageFlip ? 1 : 0,
    cW: s.canvasW, cCssW: s.canvasCssW, cRectW: s.canvasRectW,
    scroll: s.scrollTop, readout: s.readout, anims: s.anims,
  }));
  console.log(`[DIAG] rAF timeline: ${JSON.stringify(rows)}`);
}

// Shared zoom-step diagnosis: step to `fromPct`, then perform ONE ladder step
// in `direction`, capturing the painted frames in slow motion plus the JS order.
async function runZoomDiagnosis({ label, file, fromPct, direction, expectPct, prefix }) {
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
  const saved = saveFrames(frames, prefix, idx0 - 2, 20);
  console.log(`[DIAG] ${label} frames total=${frames.length} firstAfterClick=${idx0}`);

  // Frame-by-frame edge widths (the DEF-302 acceptance metric).
  const edges = saved.map((s, i) => {
    const m = measureFrame(s.path);
    return { i, dt: rel(s.recv, clickWall), left: m.left, right: m.right, width: m.width, darkX: m.darkX, darkVal: m.darkVal };
  });
  console.log(`[DIAG] ${label} EDGE WIDTHS: ${JSON.stringify(edges)}`);
  console.log(`[DIAG] ${label} saved: ${JSON.stringify(saved.map((s, i) => ({ i, dt: rel(s.recv, clickWall), path: path.basename(s.path) })))}`);

  // Correlate each frame to the nearest rAF sample by wall clock.
  const nearest = (wall) => {
    let best = null; let bd = Infinity;
    for (const s of data.samples) { const d = Math.abs(s.wall - wall); if (d < bd) { bd = d; best = s; } }
    return best;
  };
  console.log(`[DIAG] ${label} frameCorr: ${JSON.stringify(frames.map((f, i) => {
    const s = nearest(f.recv);
    return {
      i, recvMs: rel(f.recv, clickWall),
      slotW: s ? s.slotW : null, slotScale: s ? s.slotScale : null, slotFlip: s ? (s.slotFlip ? 1 : 0) : null,
      pageScale: s ? s.pageScale : null, pageFlip: s ? (s.pageFlip ? 1 : 0) : null,
    };
  }))}`);

  const readout = (await win.locator('.zoom-percent').first().innerText()).trim();
  console.log(`[DIAG] ${label} end readout=${readout}`);
  expect(parseFloat(readout)).toBe(expectPct);
  expect(data.marks.some((m) => m.label === 'anim-start' && m.name === 'tf-page-zoom-flip')).toBe(true);
  expect(saved.length).toBeGreaterThanOrEqual(10);
  return { edges, marks: data.marks, samples: data.samples, saved };
}

test('RETEST zoom-in painted frames + JS order (100% -> 110%)', async () => {
  await runZoomDiagnosis({ label: 'zoom-in', file: 'diag-zoom-in.pdf', fromPct: 100, direction: 1, expectPct: 110, prefix: 'diag-zoom-frame-in-fix' });
});

test('RETEST zoom-out painted frames + JS order (110% -> 100%)', async () => {
  await runZoomDiagnosis({ label: 'zoom-out', file: 'diag-zoom-out.pdf', fromPct: 110, direction: -1, expectPct: 100, prefix: 'diag-zoom-frame-out-fix' });
});

// ---------------------------------------------------------------------------
// DEF-303 — the restore-from-minimised latency.
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

test('RETEST restore-from-minimised painted frames + timeline', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'diag-restore-fix.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);
  await win.waitForTimeout(400);

  // ---- Phase A (control): minimise -> restore -> maximise (button click) ----
  await win.evaluate(() => window.__rx.marks.push({ label: 'min-click-A', t: Date.now() }));
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const minStateA = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { isMin: w.isMinimized(), isMax: w.isMaximized(), vis: w.isVisible() };
  });
  console.log(`[DIAG] after minimise A: ${JSON.stringify(minStateA)}`);
  // rAF while minimised (A): count frames in a 900 ms window.
  const rafA = await win.evaluate(() => new Promise((resolve) => {
    const start = Date.now();
    let n = 0;
    const tick = () => { n += 1; if (Date.now() - start < 900) requestAnimationFrame(tick); else resolve({ frames: n, ms: Date.now() - start }); };
    requestAnimationFrame(tick);
  }));
  console.log(`[DIAG] rAF while minimised A: ${JSON.stringify(rafA)}`);
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
  const savedA = saveFrames(a.frames, 'diag-restore-frame-control-fix', idxA, 10);
  console.log(`[DIAG] control frames total=${a.frames.length} firstAfterClick=${idxA}`);
  console.log(`[DIAG] control saved: ${JSON.stringify(savedA.map((s, i) => ({ i, dt: rel(s.recv, clickA), path: path.basename(s.path) })))}`);
  const inkA = savedA.map((s, i) => ({ i, dt: rel(s.recv, clickA), ...frameInk(s.path, { x0: 250, x1: 570, y0: 60, y1: 430 }) }));
  console.log(`[DIAG] control frame ink: ${JSON.stringify(inkA)}`);

  // Back to restored for the direct path.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);

  // ---- Phase B (handler path): previously maximised -> minimise -> maximise
  // IPC (the caption button's own call). The product handler must make ONE
  // restore() and no maximize(). ----
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].maximize(); });
  await win.waitForTimeout(900);
  const preB = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { isMin: w.isMinimized(), isMax: w.isMaximized(), vis: w.isVisible() };
  });
  console.log(`[DIAG] before minimise B (previously maximised): ${JSON.stringify(preB)}`);
  await win.evaluate(() => window.__rx.marks.push({ label: 'min-click-B', t: Date.now() }));
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const minStateB = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { isMin: w.isMinimized(), isMax: w.isMaximized(), vis: w.isVisible() };
  });
  console.log(`[DIAG] after minimise B: ${JSON.stringify(minStateB)}`);
  const rafB = await win.evaluate(() => new Promise((resolve) => {
    const start = Date.now();
    let n = 0;
    const tick = () => { n += 1; if (Date.now() - start < 900) requestAnimationFrame(tick); else resolve({ frames: n, ms: Date.now() - start }); };
    requestAnimationFrame(tick);
  }));
  console.log(`[DIAG] rAF while minimised B: ${JSON.stringify(rafB)}`);

  const b = await startScreencast(win);
  await win.waitForTimeout(200);
  const clickB = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'max-call-B', t }), clickB);
  // The caption maximize button's own IPC (the button is not physically
  // clickable on a minimised window; this is the exact call its onClick makes).
  await win.evaluate(() => window.tflex.maximizeWindow());
  await win.waitForTimeout(1600);
  await stopScreencast(b.cdp);
  const idxB = b.frames.findIndex((f) => f.recv >= clickB);
  const savedB = saveFrames(b.frames, 'diag-restore-frame-direct-fix', idxB, 10);
  console.log(`[DIAG] handler frames total=${b.frames.length} firstAfterClick=${idxB}`);
  console.log(`[DIAG] handler saved: ${JSON.stringify(savedB.map((s, i) => ({ i, dt: rel(s.recv, clickB), path: path.basename(s.path) })))}`);
  const inkB = savedB.map((s, i) => ({ i, dt: rel(s.recv, clickB), ...frameInk(s.path, { x0: 250, x1: 570, y0: 60, y1: 430 }) }));
  console.log(`[DIAG] handler frame ink: ${JSON.stringify(inkB)}`);

  // Post-resume paint check: the visible page canvas must be painted.
  const inkAfterB = await win.evaluate(() => window.__rx.canvasInk());
  console.log(`[DIAG] post-resume canvas ink B: ${JSON.stringify(inkAfterB)}`);

  // ---- Phase C (OS floor): minimise -> main win.maximize() (taskbar preview) ----
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);
  await win.evaluate(() => window.__rx.marks.push({ label: 'min-click-C', t: Date.now() }));
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const clickC = Date.now();
  await win.evaluate((t) => window.__rx.marks.push({ label: 'max-main-C', t }), clickC);
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

  analyzeRestore(main, data, clickA, 'control(restored->maximise)');
  analyzeRestore(main, data, clickB, 'handler(minimised+previouslyMaximised->maximise IPC)');
  analyzeRestore(main, data, clickC, 'osFloor(minimised->main maximize)');

  // rAF deltas around the minimise windows.
  const windowDt = (from, to) => data.frames.filter((f) => f.t >= from && f.t < to).map((f) => f.dt);
  const minA = data.marks.find((m) => m.label === 'min-click-A');
  const minB = data.marks.find((m) => m.label === 'min-click-B');
  if (minA) console.log(`[DIAG] rAF dt while minimised A: ${JSON.stringify(windowDt(minA.t + 200, minA.t + 1100))}`);
  if (minB) console.log(`[DIAG] rAF dt while minimised B: ${JSON.stringify(windowDt(minB.t + 200, minB.t + 1100))}`);

  // Main-process event-loop drift around the clicks.
  const loopAround = (t) => main.loop.filter((s) => s.t >= t - 300 && s.t <= t + 900).map((s) => ({ dt: s.t - t, drift: s.drift }));
  console.log(`[DIAG] main loop drift around control click: ${JSON.stringify(loopAround(clickA))}`);
  console.log(`[DIAG] main loop drift around handler click: ${JSON.stringify(loopAround(clickB))}`);
  console.log(`[DIAG] main loop drift around osFloor click: ${JSON.stringify(loopAround(clickC))}`);
  const maxDrift = main.loop.reduce((m, s) => Math.max(m, s.drift), 0);
  console.log(`[DIAG] main loop max drift over run: ${maxDrift}ms`);

  // Main-process event order around each click.
  const order = (t) => main.log.filter((e) => e.t >= t - 50 && e.t <= t + 900).map((e) => ({ dt: e.t - t, ev: e.ev }));
  console.log(`[DIAG] main event order control: ${JSON.stringify(order(clickA))}`);
  console.log(`[DIAG] main event order handler: ${JSON.stringify(order(clickB))}`);
  console.log(`[DIAG] main event order osFloor: ${JSON.stringify(order(clickC))}`);

  expect(main.log.some((e) => e.ev === 'ev:maximize')).toBe(true);
});
