// DEF-338 high-frequency in-page probe (QA diagnostic).
//
// Samples pane B's page canvas every animation frame while the payslip opens
// into pane B, recording backing-store size, CSS size, slot rect/background,
// placeholder presence and a 5-point pixel signature. This pins down WHAT is
// on screen during the glitch (canvas vs slot vs placeholder) and for how long.
//
// The payslip is used IN PLACE from the operator's Downloads folder.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const PAYSLIP = 'C:\\Users\\tanzi\\Downloads\\TanzimulIslamPaySlip20260930.pdf';
const OUT = path.resolve(__dirname, 'def338-frames');

let app = null;
let win = null;
const consoleLog = [];

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def338-probe');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function mockOpen(p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

test('DEF-338 probe: per-frame pane B canvas state during the payslip open', async () => {
  await mockOpen(REPORT);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1500);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });

  // Install the sampler.
  await win.evaluate(() => {
    window.__def338 = [];
    const t0 = performance.now();
    const sample = () => {
      const pane = document.querySelector('.tab-pane[data-pane="B"]');
      const canvas = pane && pane.querySelector('canvas.pdf-page-canvas');
      const slot = pane && pane.querySelector('.page-slot');
      const ph = pane && pane.querySelector('.page-placeholder');
      let sig = null, backing = null, css = null, slotRect = null, slotBg = null, canvasBg = null;
      if (canvas) {
        backing = [canvas.width, canvas.height];
        const r = canvas.getBoundingClientRect();
        css = [Math.round(r.width), Math.round(r.height)];
        canvasBg = getComputedStyle(canvas).backgroundColor;
        try {
          const ctx = canvas.getContext('2d');
          const w = canvas.width, h = canvas.height;
          if (w > 0 && h > 0) {
            const pts = [[0.5, 0.05], [0.5, 0.5], [0.5, 0.95], [0.05, 0.5], [0.95, 0.5]];
            sig = pts.map(([fx, fy]) => {
              const d = ctx.getImageData(Math.floor(fx * (w - 1)), Math.floor(fy * (h - 1)), 1, 1).data;
              return [d[0], d[1], d[2]];
            });
          }
        } catch (e) { sig = 'err'; }
      }
      if (slot) {
        const r = slot.getBoundingClientRect();
        slotRect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        slotBg = getComputedStyle(slot).backgroundColor;
      }
      window.__def338.push({
        t: Math.round(performance.now() - t0),
        hasCanvas: !!canvas, backing, css, sig, slotRect, slotBg, canvasBg,
        ph: !!ph, paneEmpty: pane ? pane.hasAttribute('data-pane-empty') : null,
      });
      if (window.__def338.length < 500) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  // Open the payslip into pane B.
  await mockOpen(PAYSLIP);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(3500);

  const samples = await win.evaluate(() => window.__def338);
  fs.writeFileSync(path.join(OUT, 'probe-samples.json'), JSON.stringify(samples, null, 1));
  console.log(`[DEF338-PROBE] samples=${samples.length}`);
  // Print a compact timeline: only rows where the state changes.
  let prev = '';
  for (const s of samples) {
    const key = JSON.stringify([s.hasCanvas, s.backing, s.css, s.sig, s.slotRect, s.slotBg, s.ph, s.paneEmpty]);
    if (key !== prev) {
      console.log(`  t=${s.t} canvas=${s.hasCanvas} backing=${JSON.stringify(s.backing)} css=${JSON.stringify(s.css)} sig=${JSON.stringify(s.sig)} slot=${JSON.stringify(s.slotRect)} slotBg=${s.slotBg} ph=${s.ph} empty=${s.paneEmpty}`);
      prev = key;
    }
  }
  console.log(`[DEF338-PROBE] console/errors (${consoleLog.length}):`);
  for (const l of consoleLog) console.log(`  ${l}`);
  expect(samples.length).toBeGreaterThan(10);
});
