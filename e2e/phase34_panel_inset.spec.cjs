// Phase 34 — criterion 1: the All Tools panel resizes BOTH panes equally.
//
// In Multi Mode the reserved --tf-tools-inset is consumed ONCE at the stage
// level, so opening the panel shrinks pane A and pane B by the SAME amount and
// neither pane carries an internal blank strip (the operator's "blank space on
// its right"). Single mode's panel behaviour (the scroller's margin-right
// inset) is unchanged. Frame sampling across the open and the close reports
// blank frames in either pane.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, openFile, tmpCopy, LONG, SHOTS } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-inset');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Page-area geometry for a Multi Mode pane: the workspace-main (pages region)
// and the document scroller. `blankBand` is the scroller's unexplained empty
// band INSIDE the pages region (the operator's blank strip).
async function paneGeometry(pane) {
  return win.evaluate((p) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) };
    };
    const main = rect(`.tab-pane[data-pane="${p}"] .workspace-main`);
    const scroller = rect(`.tab-pane[data-pane="${p}"] .document-scroller`);
    return {
      main,
      scroller,
      blankBand: main !== null && scroller !== null ? Math.round(main.width - scroller.width) : null,
    };
  }, pane);
}

async function singleGeometry() {
  return win.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) };
    };
    const main = rect('.workspace-main');
    const scroller = rect('.document-scroller');
    return {
      main,
      scroller,
      blankBand: main !== null && scroller !== null ? Math.round(main.width - scroller.width) : null,
    };
  });
}

async function inset() {
  return win.evaluate(() => {
    const el = document.querySelector('.app-main');
    return el ? getComputedStyle(el).getPropertyValue('--tf-tools-inset').trim() : null;
  });
}

async function openPanel() {
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(700);
}
async function closePanel() {
  await win.locator('.tools-palette-close').first().click();
  await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(700);
}

// 16ms in-page frame sampler (mirrors the DEF-274 probe): per pane, the page-1
// canvas presence/size/ink plus the placeholder count.
async function sampleTimeline(durationMs, probes) {
  return win.evaluate(async ({ duration, probeList }) => {
    const read = (sel) => {
      const paneEl = document.querySelector(sel);
      const canvas = paneEl ? paneEl.querySelector('.page-slot[data-page="1"] canvas.pdf-page-canvas') : null;
      let ink = null;
      if (canvas) {
        const W = 32;
        const H = 32;
        const off = document.createElement('canvas');
        off.width = W;
        off.height = H;
        const ctx = off.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(canvas, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 245) ink += 1;
        }
      }
      const ph = paneEl ? paneEl.querySelectorAll('.page-slot[data-page="1"] .page-placeholder').length : 0;
      return { present: !!canvas, w: canvas ? canvas.width : 0, ink, placeholder: ph };
    };
    const samples = [];
    const tick = () => {
      const rec = { t: Math.round(performance.now()) };
      for (const p of probeList) rec[p.key] = read(p.sel);
      samples.push(rec);
    };
    tick();
    const id = setInterval(tick, 16);
    await new Promise((r) => setTimeout(r, duration));
    clearInterval(id);
    tick();
    return samples;
  }, { duration: durationMs, probeList: probes });
}

function analyse(samples, key) {
  const withCanvas = samples.filter((s) => s[key].present);
  const blank = withCanvas.filter((s) => s[key].ink === 0);
  const placeholders = samples.filter((s) => s[key].placeholder > 0);
  return { total: samples.length, withCanvas: withCanvas.length, blank: blank.length, placeholders: placeholders.length };
}

const PROBE_A = { key: 'A', sel: '.tab-pane[data-pane="A"]' };
const PROBE_B = { key: 'B', sel: '.tab-pane[data-pane="B"]' };

test('C1 Multi Mode: the panel shrinks both panes equally and leaves no internal blank strip', async () => {
  await twoPaneSetup(app, win);
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  const frac = await win.evaluate(() => {
    const st = document.querySelector('.tab-stage');
    return st ? getComputedStyle(st).getPropertyValue('--tf-split-frac').trim() : null;
  });
  console.log(`[P34-inset] split fraction at measure = ${frac} (default 50/50)`);

  const beforeA = await paneGeometry('A');
  const beforeB = await paneGeometry('B');
  console.log(`[P34-inset] panel CLOSED inset=${await inset()} A=${JSON.stringify(beforeA)} B=${JSON.stringify(beforeB)}`);

  // --- open, sampling frames in both panes ---
  const p = sampleTimeline(2000, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(60);
  await openPanel();
  const openSamples = await p;
  const openA = analyse(openSamples, 'A');
  const openB = analyse(openSamples, 'B');

  const afterA = await paneGeometry('A');
  const afterB = await paneGeometry('B');
  const insetOpen = await inset();
  const deltaA = beforeA.main.width - afterA.main.width;
  const deltaB = beforeB.main.width - afterB.main.width;
  console.log(`[P34-inset] panel OPEN inset=${insetOpen} A.main ${beforeA.main.width}->${afterA.main.width} (delta ${deltaA}); B.main ${beforeB.main.width}->${afterB.main.width} (delta ${deltaB})`);
  console.log(`[P34-inset] open frame sampling: A=${JSON.stringify(openA)} B=${JSON.stringify(openB)}`);

  // Both panes shrink by the SAME amount (within a pixel) at the 50/50 split.
  expect(deltaA).toBeGreaterThan(50);
  expect(deltaB).toBeGreaterThan(50);
  expect(Math.abs(deltaA - deltaB), `pane shrink deltas differ: A=${deltaA} B=${deltaB}`).toBeLessThanOrEqual(1);

  // Neither pane gains an internal blank reserved strip when the panel opens.
  expect(afterA.blankBand - beforeA.blankBand, `pane A blank band grew ${beforeA.blankBand}->${afterA.blankBand}`).toBeLessThanOrEqual(2);
  expect(afterB.blankBand - beforeB.blankBand, `pane B blank band grew ${beforeB.blankBand}->${afterB.blankBand}`).toBeLessThanOrEqual(2);
  expect(Math.abs(afterA.blankBand), `pane A carries a blank strip (${afterA.blankBand}px)`).toBeLessThanOrEqual(4);
  expect(Math.abs(afterB.blankBand), `pane B carries a blank strip (${afterB.blankBand}px)`).toBeLessThanOrEqual(4);

  // No blank frame in either pane across the open.
  expect(openA.blank, `blank frames in pane A on open: ${openA.blank}`).toBe(0);
  expect(openB.blank, `blank frames in pane B on open: ${openB.blank}`).toBe(0);
  expect(openA.placeholders).toBe(0);
  expect(openB.placeholders).toBe(0);

  // Visual record: the panel open with both panes resized equally.
  await win.screenshot({ path: path.join(SHOTS, 'phase34-panel-open.png') });
  console.log('[P34-inset] captured screenshots/phase34-panel-open.png');

  // --- close, sampling frames again ---
  const p2 = sampleTimeline(2000, [PROBE_A, PROBE_B]);
  await win.waitForTimeout(60);
  await closePanel();
  const closeSamples = await p2;
  const closeA = analyse(closeSamples, 'A');
  const closeB = analyse(closeSamples, 'B');
  const backA = await paneGeometry('A');
  const backB = await paneGeometry('B');
  console.log(`[P34-inset] panel CLOSED again A.main=${backA.main.width} B.main=${backB.main.width}; close sampling A=${JSON.stringify(closeA)} B=${JSON.stringify(closeB)}`);
  expect(Math.abs(backA.main.width - beforeA.main.width), 'pane A did not return to its closed width').toBeLessThanOrEqual(1);
  expect(Math.abs(backB.main.width - beforeB.main.width), 'pane B did not return to its closed width').toBeLessThanOrEqual(1);
  expect(closeA.blank).toBe(0);
  expect(closeB.blank).toBe(0);
  expect(closeA.placeholders).toBe(0);
  expect(closeB.placeholders).toBe(0);
});

test('C2 Single mode: the panel behaviour is unchanged', async () => {
  await openFile(app, win, tmpCopy(LONG, 'p34-single.pdf'));
  await win.waitForTimeout(900);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');
  expect(await win.locator('[data-pane]').count()).toBe(0);

  const before = await singleGeometry();
  console.log(`[P34-inset] single CLOSED inset=${await inset()} ${JSON.stringify(before)}`);
  await openPanel();
  const after = await singleGeometry();
  const insetOpen = await inset();
  const shrink = before.scroller.width - after.scroller.width;
  console.log(`[P34-inset] single OPEN inset=${insetOpen} ${JSON.stringify(after)} scrollerShrink=${shrink}`);

  // The single document's page area still shrinks by the reserved inset (the
  // pre-Phase-34 margin-right behaviour is untouched) and the stage stays out
  // of Multi Mode.
  expect(shrink).toBeGreaterThan(50);
  expect(shrink).toBeGreaterThan(300);
  expect(await win.locator('[data-pane]').count()).toBe(0);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');

  await closePanel();
  const back = await singleGeometry();
  console.log(`[P34-inset] single CLOSED again ${JSON.stringify(back)}`);
  expect(Math.abs(back.scroller.width - before.scroller.width)).toBeLessThanOrEqual(1);
});
