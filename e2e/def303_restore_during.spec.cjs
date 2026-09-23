// Focused diagnostic (qa, 2026-09-23) — DEF-303 residual.
//
// Two unanswered questions from the last retest:
//   (1) What does the window show DURING the ~120 ms minimise->maximise
//       transition? The prior screencast only looked FROM the OS event on.
//   (2) Does the OS call (win.restore()/win.maximize()) BLOCK the main process,
//       or does the observed 150-166 ms main-loop stall sit outside the call?
//
// Read-only instrument. It spies on the window's OWN restore/maximize methods
// (the product handler calls those) and times around the native call, so the
// CALL DURATION is measured directly. Screencast frames are captured FROM THE
// CLICK through the whole transition and written to
// screenshots/diag-restore-during-*.png. Launches only through the canonical
// e2e/lib/launch.cjs launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const LOG = path.resolve(__dirname, 'def303_restore_during.log');
fs.writeFileSync(LOG, `DEF-303 restore-during diagnostic — ${new Date().toISOString()}\n`);
function out(msg) {
  const line = `[DUR] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) { /* ignore */ }
}

let app = null;
let win = null;
test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def303-during');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now(), ts: ev.metadata ? ev.metadata.timestamp : null });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 80, maxWidth: 720, maxHeight: 540, everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

// Per-frame stats from the in-memory base64 PNG. `dark` = glyph-ish pixels
// (all channels < 180) over the whole frame; `darkPage` = the same over the
// central 50% x 60% rect (the PDF page area, so chrome/toolbar ink cannot be
// mistaken for page content). `meanLum` and `hash` (sampled FNV-1a) let a
// frame be compared to the pre-click retained surface to spot a stale frame.
function frameStats(b64) {
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const { width, height, data } = png;
  const px0 = Math.floor(width * 0.25); const px1 = Math.floor(width * 0.75);
  const py0 = Math.floor(height * 0.2); const py1 = Math.floor(height * 0.8);
  let dark = 0; let darkPage = 0; let sum = 0; let n = 0; let hash = 2166136261;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const isDark = r < 180 && g < 180 && b < 180;
      if (isDark) dark += 1;
      if (isDark && x >= px0 && x <= px1 && y >= py0 && y <= py1) darkPage += 1;
      sum += (r + g + b) / 3; n += 1;
      if ((x + y * width) % 977 === 0) { hash ^= (r << 16) | (g << 8) | b; hash = Math.imul(hash, 16777619); }
    }
  }
  return { dark, darkPage, meanLum: Math.round(sum / n), hash: hash >>> 0, w: width, h: height };
}

function rel(t, base) { return t === null || t === undefined ? null : Math.round(t - base); }

// Main-process probe: spies on the window's OWN methods (the exact OS calls the
// product handler makes) and records the synchronous CALL DURATION (t0 -> t1
// around the native call). Plus the OS events, a 5 ms state poll and a 10 ms
// event-loop drift probe to locate any stall INSIDE vs AFTER the call.
function installMainProbe({ BrowserWindow }) {
  const g = globalThis;
  g.__mx = { log: [], poll: [], loop: [], calls: [] };
  const w = BrowserWindow.getAllWindows()[0];
  const now = () => Date.now();
  const log = (ev, extra) => g.__mx.log.push({ ev, t: now(), ...(extra || {}) });
  for (const m of ['maximize', 'unmaximize', 'restore', 'minimize']) {
    const orig = w[m].bind(w);
    w[m] = (...a) => {
      const t0 = now();
      const r = orig(...a);
      const t1 = now();
      g.__mx.calls.push({ m, t0, t1, dur: t1 - t0 });
      return r;
    };
  }
  for (const ev of ['maximize', 'unmaximize', 'restore', 'minimize', 'resize', 'move', 'show', 'focus']) {
    w.on(ev, () => log('ev:' + ev));
  }
  g.__mxTimer = setInterval(() => {
    const b = w.getBounds();
    g.__mx.poll.push({ t: now(), max: w.isMaximized(), min: w.isMinimized(), vis: w.isVisible(), w: b.width, h: b.height });
  }, 5);
  let last = now();
  g.__mxLoopTimer = setInterval(() => {
    const t = now();
    g.__mx.loop.push({ t, drift: t - last - 10 });
    last = t;
  }, 10);
}

// Renderer probe: marks (clicks + visibility), a per-rAF dt sampler, and a
// capture-phase click listener on the caption maximize button so the control
// case's click time is exact.
function installRendererProbe() {
  const g = window;
  g.__rx = { marks: [], frames: [], vis: [] };
  document.addEventListener('visibilitychange', () => g.__rx.vis.push({ t: Date.now(), state: document.visibilityState }));
  const btn = document.querySelector('[data-window-maximize]');
  if (btn) btn.addEventListener('click', () => g.__rx.marks.push({ label: 'btn-max-click', t: Date.now() }), true);
  let last = performance.now();
  const frame = () => {
    g.__rx.frames.push({ t: Date.now(), dt: Math.round(performance.now() - last), vis: document.visibilityState });
    last = performance.now();
    g.__rx.raf = requestAnimationFrame(frame);
  };
  g.__rx.raf = requestAnimationFrame(frame);
}

// Count rAF frames, ~16 ms timer ticks and visibility state over `ms` while the
// window is minimised (the throttle-cost observation).
function measureWhileMinimised(page, ms) {
  return page.evaluate((windowMs) => new Promise((resolve) => {
    const t0 = Date.now();
    let raf = 0; let timer = 0; let maxDt = 0; let last = performance.now();
    const tick = () => {
      const t = performance.now();
      raf += 1;
      if (t - last > maxDt) maxDt = t - last;
      last = t;
      if (Date.now() - t0 < windowMs) requestAnimationFrame(tick);
      else finish();
    };
    const iv = setInterval(() => { timer += 1; }, 16);
    let done = false;
    const finish = () => { if (done) return; done = true; clearInterval(iv); resolve({ raf, timer, ms: Date.now() - t0, maxDt: Math.round(maxDt), vis: document.visibilityState }); };
    setTimeout(finish, windowMs + 250);
    requestAnimationFrame(tick);
  }), ms);
}
// Save up to `count` frames starting at `from`, returning descriptors.
function saveFrames(frames, prefix, from, count) {
  const saved = [];
  const start = Math.max(0, from);
  for (let i = start; i < Math.min(frames.length, start + count); i += 1) {
    const p = path.join(SHOTS, `${prefix}-${String(i - start).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
    saved.push({ i, recv: frames[i].recv, path: p });
  }
  return saved;
}

// The case timeline + per-frame description table, all relative to the click.
function describeCase({ label, frames, tClick, eventDt, prefix }) {
  const after = frames.filter((f) => f.recv >= tClick);
  const before = frames.filter((f) => f.recv < tClick);
  const preClick = before.length ? before[before.length - 1] : null;
  const idx = frames.findIndex((f) => f.recv >= tClick);
  out(`${label}: frames total=${frames.length} beforeClick=${before.length} afterClick=${after.length}`);
  out(`${label}: preClick frame stats=${JSON.stringify(preClick ? frameStats(preClick.data) : null)} at ${preClick ? rel(preClick.recv, tClick) : null}ms`);
  const between = eventDt === null ? [] : after.filter((f) => rel(f.recv, tClick) < eventDt);
  out(`${label}: frames BETWEEN click and OS event (${eventDt}ms): ${between.length}`);
  const saved = process.env.DUR_NO_IMAGES === '1' ? [] : saveFrames(frames, prefix, idx, 6);
  const rows = saved.map((s, k) => {
    const st = frameStats(frames[s.i].data);
    return { k, dt: rel(s.recv, tClick), dark: st.dark, darkPage: st.darkPage, meanLum: st.meanLum, hash: st.hash, path: path.basename(s.path) };
  });
  for (const r of rows) out(`${label} frame ${String(r.k).padStart(2, '0')} +${r.dt}ms dark=${r.dark} darkPage=${r.darkPage} meanLum=${r.meanLum} hash=${r.hash} -> ${r.path}`);
  return { after, preClick, saved, rows, idx, tClick };
}

test('DEF-303 restore-during: frames from the click + OS-call duration + throttle cost', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def303-during.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { wcBackgroundThrottling: w.webContents.backgroundThrottling };
  });
  out(`webPreferences: ${JSON.stringify(prefs)}`);

  await app.evaluate(installMainProbe);
  await win.evaluate(installRendererProbe);
  await win.waitForTimeout(400);

  // ---- Case B (control): RESTORED -> maximise via the caption button ----
  const scB = await startScreencast(win);
  await win.waitForTimeout(200);
  await win.locator('[data-window-maximize]').first().click();
  await win.waitForTimeout(1600);
  await stopScreencast(scB.cdp);

  // Back to the restored (normal) state for the minimised case, then maximise
  // first so the pre-minimise state is "maximised".
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
  await win.waitForTimeout(800);
  await win.locator('[data-window-maximize]').first().click();
  await win.waitForTimeout(800);
  const preA = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { min: w.isMinimized(), max: w.isMaximized() }; });
  out(`case A pre-minimise state (expect maximized): ${JSON.stringify(preA)}`);

  // ---- Case A (minimised -> maximise) ----
  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(1200);
  const throttled = await measureWhileMinimised(win, 900);
  out(`renderer while minimised (900ms): ${JSON.stringify(throttled)}`);

  const scA = await startScreencast(win);
  await win.waitForTimeout(200);
  const tA = Date.now();
  await win.evaluate((t) => {
    window.__rx.marks.push({ label: 'ipc-max-A', t });
    window.tflex.maximizeWindow();
  }, tA);
  await win.waitForTimeout(2000);
  await stopScreencast(scA.cdp);

  // ---- Collect ----
  const marks = await win.evaluate(() => { cancelAnimationFrame(window.__rx.raf); return { marks: window.__rx.marks, vis: window.__rx.vis }; });
  const main = await app.evaluate(() => {
    clearInterval(globalThis.__mxTimer);
    clearInterval(globalThis.__mxLoopTimer);
    return { log: globalThis.__mx.log, poll: globalThis.__mx.poll, loop: globalThis.__mx.loop, calls: globalThis.__mx.calls };
  });
  out(`visibility events: ${JSON.stringify(marks.vis)}`);

  const btnClick = marks.marks.filter((m) => m.label === 'btn-max-click')[0];
  const ipcA = marks.marks.filter((m) => m.label === 'ipc-max-A')[0];
  const tB = btnClick ? btnClick.t : null;
  out(`click marks: B(button)=${tB} A(ipc)=${ipcA ? ipcA.t : null}`);

  // OS calls with their synchronous duration.
  out(`OS calls: ${JSON.stringify(main.calls.map((c) => ({ dt: rel(c.t0, tB), m: c.m, durMs: c.dur })))}`);
  const callsA = main.calls.filter((c) => ipcA && c.t0 >= ipcA.t - 50);
  for (const c of callsA) {
    out(`case A call ${c.m}: started +${rel(c.t0, ipcA.t)}ms, ended +${rel(c.t1, ipcA.t)}ms, CALL DURATION ${c.dur}ms`);
  }
  const eventOf = (ev, t) => { const e = main.log.filter((x) => x.ev === ev && x.t >= t).sort((a, b) => a.t - b.t)[0]; return e ? e.t : null; };
  const evB = tB ? eventOf('ev:maximize', tB) : null;
  const evArestore = ipcA ? eventOf('ev:restore', ipcA.t) : null;
  const evAmax = ipcA ? eventOf('ev:maximize', ipcA.t) : null;
  const evA = evArestore || evAmax;
  const dB = evB !== null && tB ? evB - tB : null;
  const dA = evA !== null && ipcA ? evA - ipcA.t : null;
  out(`case B control: click -> maximize event = ${dB}ms`);
  out(`case A minimised: click -> restore event = ${evArestore !== null ? rel(evArestore, ipcA.t) : null}ms, maximize event = ${evAmax !== null ? rel(evAmax, ipcA.t) : null}ms (earliest = ${dA}ms)`);
  out(`DELTA minimised-event minus control-event = ${(dA !== null && dB !== null) ? dA - dB : 'n/a'}ms (before the option: 101ms; last retest: 120ms)`);

  // Where the stall lives: the drift probe's samples around each call.
  const loopAround = (t) => main.loop.filter((s) => s.t >= t - 60 && s.t <= t + 400).map((s) => ({ dt: rel(s.t, t), drift: s.drift }));
  if (tB) out(`main loop drift around control maximize: ${JSON.stringify(loopAround(tB))}`);
  if (ipcA) out(`main loop drift around minimised restore: ${JSON.stringify(loopAround(ipcA.t))}`);
  if (callsA[0]) {
    const c = callsA[0];
    const inside = main.loop.filter((s) => s.t >= c.t0 && s.t <= c.t1 + 20).map((s) => ({ dt: rel(s.t, c.t0), drift: s.drift }));
    out(`loop samples spanning the case-A call [t0..t1]: ${JSON.stringify(inside)}`);
  }
  out(`main loop max drift over run: ${main.loop.reduce((m, s) => Math.max(m, s.drift), 0)}ms`);

  // ---- Frames ----
  const A = describeCase({ label: 'CASE A(minimised->maximise)', frames: scA.frames, tClick: ipcA.t, eventDt: evA !== null ? rel(evA, ipcA.t) : null, prefix: 'diag-restore-during-min' });
  const B = describeCase({ label: 'CASE B(restored->maximise control)', frames: scB.frames, tClick: tB, eventDt: evB !== null ? rel(evB, tB) : null, prefix: 'diag-restore-during-ctrl' });

  const firstReal = (d) => {
    const f = d.after.find((x) => frameStats(x.data).darkPage > 50);
    return f ? rel(f.recv, d.tClick) : null;
  };
  out(`first frame with real page content (darkPage>50): CASE A +${firstReal(A)}ms, CASE B +${firstReal(B)}ms after the click`);

  expect(main.calls.length).toBeGreaterThanOrEqual(3);
  expect(A.after.length).toBeGreaterThanOrEqual(1);
  expect(B.after.length).toBeGreaterThanOrEqual(1);
});

