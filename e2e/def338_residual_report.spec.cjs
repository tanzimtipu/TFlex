// DEF-338 residual judgement (QA, Phase 38): report.pdf opened into pane B of
// Multi Mode still steps 403 -> 393 (a 10px change when the multi-page
// document's vertical scrollbar appears). The payslip path is exact.
//
// This harness measures the step and captures the WIDEST frame and the SETTLED
// frame so qa can judge whether the step is visible in the running app. The
// payslip is not used here; report.pdf is a repo fixture.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const SQUIGGLY = path.join(FIX, 'squiggly-native.pdf');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P38-RESID] ${label} ${JSON.stringify(obj)}`);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def338-residual');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function mockOpen(p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

test('DEF-338 residual: report.pdf into pane B step 403->393, widest vs settled frames', async () => {
  // Pane A = squiggly-native.pdf in single mode.
  await mockOpen(SQUIGGLY);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // Multi Mode ON -> pane B empty.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(700);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });

  // CDP screencast so the widest frame can be recovered after the fact.
  const cdp = await win.context().newCDPSession(win);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 100, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });

  // Per-frame probe: slot width, zoom readout, placeholder presence.
  await win.evaluate(() => {
    window.__resid = [];
    const t0 = performance.now();
    const sample = () => {
      const pane = document.querySelector('.tab-pane[data-pane="B"]');
      const slot = pane && pane.querySelector('.page-slot');
      const ph = pane && pane.querySelector('.page-placeholder');
      const zoomEl = document.querySelector('[data-pill-pane="B"] .zoom-percent');
      const sr = slot ? slot.getBoundingClientRect() : null;
      window.__resid.push({
        t: Math.round(performance.now() - t0),
        recv: Date.now(),
        slotW: sr ? Math.round(sr.width) : null,
        ph: !!ph,
        zoom: zoomEl ? zoomEl.textContent.trim() : null,
      });
      if (window.__resid.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await mockOpen(REPORT);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(3000);

  const samples = await win.evaluate(() => window.__resid);
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }

  const opened = samples.filter((s) => s.slotW !== null);
  const slotSeq = [];
  for (const s of opened) if (slotSeq.length === 0 || slotSeq[slotSeq.length - 1] !== s.slotW) slotSeq.push(s.slotW);
  const zoomSeq = [];
  let lastZoom = null;
  for (const s of opened) if (s.zoom !== null && s.zoom !== lastZoom) { zoomSeq.push({ t: s.t, zoom: s.zoom }); lastZoom = s.zoom; }
  const maxSlot = Math.max(...opened.map((s) => s.slotW));
  const finalSlot = opened[opened.length - 1].slotW;
  const widest = opened.find((s) => s.slotW === maxSlot);
  const settled = opened[opened.length - 1];
  log('result', {
    slotSeq, zoomSeq, maxSlot, finalSlot,
    stepPx: maxSlot - finalSlot,
    placeholderFrames: opened.filter((s) => s.ph).length,
    widestRecv: widest.recv, settledRecv: settled.recv,
    frames: frames.length,
  });

  // Recover the screencast frame closest to each state and save it.
  const nearest = (recv) => frames.reduce((best, f) => (Math.abs(f.recv - recv) < Math.abs(best.recv - recv) ? f : best), frames[0]);
  const widestIdx = frames.reduce((best, f, i) => (Math.abs(f.recv - widest.recv) < Math.abs(frames[best].recv - widest.recv) ? i : best), 0);
  const widestFrame = frames[widestIdx];
  const settledFrame = nearest(settled.recv);
  const widestPath = path.join(SHOTS, 'def338-residual-report-widest.png');
  const settledPath = path.join(SHOTS, 'def338-residual-report-settled.png');
  fs.writeFileSync(widestPath, Buffer.from(widestFrame.data, 'base64'));
  fs.writeFileSync(settledPath, Buffer.from(settledFrame.data, 'base64'));
  // The two frames immediately after the widest: if the page ever paints at
  // 403, it must appear here before the step to 393.
  const after1 = frames[Math.min(frames.length - 1, widestIdx + 1)];
  const after2 = frames[Math.min(frames.length - 1, widestIdx + 2)];
  const after1Path = path.join(SHOTS, 'def338-residual-report-after1.png');
  const after2Path = path.join(SHOTS, 'def338-residual-report-after2.png');
  fs.writeFileSync(after1Path, Buffer.from(after1.data, 'base64'));
  fs.writeFileSync(after2Path, Buffer.from(after2.data, 'base64'));
  log('frames', {
    widest: { path: widestPath, deltaMs: widestFrame.recv - widest.recv },
    after1: { path: after1Path, deltaMs: after1.recv - widest.recv },
    after2: { path: after2Path, deltaMs: after2.recv - widest.recv },
    settled: { path: settledPath, deltaMs: settledFrame.recv - settled.recv },
  });

  // The step is the residual under judgement; assert it is the measured 10px
  // (not the old full-stage slab) so the evidence is pinned.
  expect(maxSlot, 'the widest pane B slot is the half-pane fit (not the full stage)').toBeLessThanOrEqual(420);
  expect(maxSlot - finalSlot, 'the residual step is the reported ~10px').toBeLessThanOrEqual(12);
});
