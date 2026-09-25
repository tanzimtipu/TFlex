// Phase 38 item 5 / DEF-338 — the operator's exact scenario, measured.
//
// report.pdf opens into pane A, Multi Mode turns on, then
// TanzimulIslamPaySlip20260930.pdf (the operator's real payslip, used IN
// PLACE, never copied into the repo) opens into pane B through its own
// [data-pane-open]. A per-frame rAF probe records pane B's slot width, the
// placeholder presence and the pane's zoom readout across the open, so the
// DEF-338 glitch (full-stage-width slot + 204% flash) is either measured as
// gone or reproduced.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const PAYSLIP = 'C:\\Users\\tanzi\\Downloads\\TanzimulIslamPaySlip20260930.pdf';
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P38-DEF338] ${label} ${JSON.stringify(obj)}`);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p38-def338');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function mockOpen(p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

test('P38-DEF338 payslip into pane B: no oversized placeholder, zoom straight to fit', async () => {
  expect(fs.existsSync(PAYSLIP), `operator payslip present at ${PAYSLIP}`).toBe(true);

  // Pane A = report.pdf in single mode.
  await mockOpen(REPORT);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // Multi Mode ON -> pane B empty.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(700);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });

  const paneBW = await win.evaluate(() => {
    const p = document.querySelector('.tab-pane[data-pane="B"]');
    return p ? Math.round(p.getBoundingClientRect().width) : null;
  });
  log('paneB-width', paneBW);
  expect(paneBW, 'pane B has a measured width').toBeGreaterThan(100);

  // Install the per-frame probe BEFORE the open.
  await win.evaluate(() => {
    window.__p38def338 = [];
    const t0 = performance.now();
    const sample = () => {
      const pane = document.querySelector('.tab-pane[data-pane="B"]');
      const slot = pane && pane.querySelector('.page-slot');
      const ph = pane && pane.querySelector('.page-placeholder');
      const zoomEl = document.querySelector('[data-pill-pane="B"] .zoom-percent');
      const sr = slot ? slot.getBoundingClientRect() : null;
      window.__p38def338.push({
        t: Math.round(performance.now() - t0),
        slotW: sr ? Math.round(sr.width) : null,
        ph: !!ph,
        phW: ph ? Math.round(ph.getBoundingClientRect().width) : null,
        zoom: zoomEl ? zoomEl.textContent.trim() : null,
        empty: pane ? pane.hasAttribute('data-pane-empty') : null,
      });
      if (window.__p38def338.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // Open the payslip into pane B through its own [data-pane-open].
  await mockOpen(PAYSLIP);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(3500);

  const samples = await win.evaluate(() => window.__p38def338);
  fs.writeFileSync(path.join(__dirname, 'phase38-def338-payslip-samples.json'), JSON.stringify(samples, null, 1));
  log('samples', samples.length);

  // The open window: after the payslip tab is assigned, until it settles.
  const opened = samples.filter((s) => s.empty === false);
  const maxSlotW = opened.length ? Math.max(...opened.filter((s) => s.slotW !== null).map((s) => s.slotW)) : null;
  const wrongWidthFrames = opened.filter((s) => s.slotW !== null && s.slotW > paneBW * 1.15);
  const wrongWidthPlaceholderFrames = wrongWidthFrames.filter((s) => s.ph);
  const placeholderFrames = opened.filter((s) => s.ph);
  const zoomSeq = [];
  let lastZoom = null;
  for (const s of opened) {
    if (s.zoom !== null && s.zoom !== lastZoom) {
      zoomSeq.push({ t: s.t, zoom: s.zoom });
      lastZoom = s.zoom;
    }
  }
  const finalZoom = await win.evaluate(() => {
    const el = document.querySelector('[data-pill-pane="B"] .zoom-percent');
    return el ? el.textContent.trim() : null;
  });
  const finalSlotW = await win.evaluate(() => {
    const s = document.querySelector('.tab-pane[data-pane="B"] .page-slot');
    return s ? Math.round(s.getBoundingClientRect().width) : null;
  });
  const finalZoomNum = finalZoom ? parseFloat(finalZoom) : null;
  const maxZoom = zoomSeq.reduce((m, z) => Math.max(m, parseFloat(z.zoom) || 0), 0);
  // The strict reference: frames whose slot is wider than the SETTLED fit.
  const overFinalFrames = opened.filter((s) => s.slotW !== null && finalSlotW !== null && s.slotW > finalSlotW + 2);
  const overFinalPlaceholderFrames = overFinalFrames.filter((s) => s.ph);

  log('result', {
    paneBW, maxSlotW, finalSlotW, placeholderFrames: placeholderFrames.length,
    wrongWidthFrames: wrongWidthFrames.length,
    wrongWidthPlaceholderFrames: wrongWidthPlaceholderFrames.length,
    overFinalFrames: overFinalFrames.length,
    overFinalPlaceholderFrames: overFinalPlaceholderFrames.length,
    overFinalWidths: [...new Set(overFinalFrames.map((s) => s.slotW))],
    zoomSeq, finalZoom, maxZoom,
  });
  log('wrong-width-samples', wrongWidthFrames.slice(0, 12));

  // Capture the settled pane B for the operator's scenario BEFORE the verdict.
  const header = await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').innerText().catch(() => '');
  log('paneB-header', header.replace(/\s+/g, ' ').trim());
  expect(header).toContain('TanzimulIslamPaySlip20260930');
  await win.mouse.move(700, 420);
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'phase38-def338-payslip-paneB.png') });
  log('screenshot', path.join(SHOTS, 'phase38-def338-payslip-paneB.png'));

  // Pane B is the second pane: its slot must never exceed the pane width
  // (the DEF-338 full-stage slab is gone).
  expect(maxSlotW, 'pane B slot never exceeds the pane width (no full-stage first pass)')
    .toBeLessThanOrEqual(paneBW);
  // Strict criterion: ZERO placeholder frames at a width other than the
  // settled fit, and the readout straight to that fit.
  expect(overFinalPlaceholderFrames.length, 'ZERO placeholder frames wider than the settled fit').toBe(0);
  expect(maxZoom, 'the zoom readout goes straight to the settled fit (no full-stage flash)')
    .toBeLessThanOrEqual(finalZoomNum + 2);
});
