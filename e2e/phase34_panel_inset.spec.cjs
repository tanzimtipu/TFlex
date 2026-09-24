// Phase 34 — criterion 1 (migrated at the Phase 36 chunk 5/6 gate): the right
// panel resizes BOTH Multi Mode panes equally.
//
// The panel is the Phase-36 INSPECTOR now (the All-tools palette is retired),
// open by default whenever a real document is open. In Multi Mode the reserved
// --tf-tools-inset is consumed ONCE at the stage level, so both panes shrink by
// the SAME amount and neither pane carries an internal blank strip (the
// operator's "blank space on its right"). The single-mode inset is 264px.
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

// Phase 36 (chunk 5/6) — the right panel is the INSPECTOR now, open by default
// whenever a real document is open (there is no toggle; the retired All-tools
// palette's badge/palette are gone). Its single width is INSPECTOR_W_PX = 264,
// reserved through the same --tf-tools-inset machinery. These tests measure the
// surviving invariants: both Multi Mode panes shrink equally, neither carries
// an internal blank strip, the page-area floor holds, and single mode stays out
// of Multi Mode.
async function assertInspectorOpen() {
  const insetVal = await inset();
  expect(insetVal, 'the Inspector reserves its 264px inset').toBe('264px');
  expect(await win.locator('[data-inspector]').count(), 'the Inspector is the right panel').toBe(1);
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

test('C1 Multi Mode: the Inspector inset shrinks both panes equally and leaves no internal blank strip', async () => {
  await twoPaneSetup(app, win);
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  await assertInspectorOpen();

  const a = await paneGeometry('A');
  const b = await paneGeometry('B');
  console.log(`[P34-inset] multi inset=${await inset()} A=${JSON.stringify(a)} B=${JSON.stringify(b)}`);

  // Both panes shrink by the SAME amount: equal page-area widths under the
  // shared 264px inset.
  expect(Math.abs(a.main.width - b.main.width), `pane widths differ: A=${a.main.width} B=${b.main.width}`).toBeLessThanOrEqual(2);
  // The page-area floor: neither pane collapses.
  expect(a.main.width).toBeGreaterThan(200);
  expect(b.main.width).toBeGreaterThan(200);
  // Neither pane gains an internal blank reserved strip.
  expect(Math.abs(a.blankBand), `pane A carries a blank strip (${a.blankBand}px)`).toBeLessThanOrEqual(4);
  expect(Math.abs(b.blankBand), `pane B carries a blank strip (${b.blankBand}px)`).toBeLessThanOrEqual(4);

  // No blank frame / placeholder through a Multi Mode OFF -> ON cycle (the
  // geometry change the shared inset drives).
  const p = sampleTimeline(2400, [PROBE_A, PROBE_B]);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(800);
  await win.locator('[data-header-multi-mode]').click();
  const samples = await p;
  const cycA = analyse(samples, 'A');
  const cycB = analyse(samples, 'B');
  console.log(`[P34-inset] cycle sampling A=${JSON.stringify(cycA)} B=${JSON.stringify(cycB)}`);
  expect(cycA.blank, `blank frames in pane A across the cycle: ${cycA.blank}`).toBe(0);
  expect(cycB.blank, `blank frames in pane B across the cycle: ${cycB.blank}`).toBe(0);
  expect(cycA.placeholders).toBe(0);
  expect(cycB.placeholders).toBe(0);

  await win.screenshot({ path: path.join(SHOTS, 'phase34-panel-open.png') });
  console.log('[P34-inset] captured screenshots/phase34-panel-open.png');
});

test('C2 Single mode: the Inspector inset is 264px and the stage stays out of Multi Mode', async () => {
  await openFile(app, win, tmpCopy(LONG, 'p34-single.pdf'));
  await win.waitForTimeout(900);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');
  expect(await win.locator('[data-pane]').count()).toBe(0);
  await assertInspectorOpen();

  const g = await singleGeometry();
  console.log(`[P34-inset] single inset=${await inset()} ${JSON.stringify(g)}`);
  // The scroller is inset by the Inspector width (its margin-right), so the
  // page area is narrower than its host by ~264px and the floor still holds.
  expect(g.main.width - g.scroller.width, 'the single pane is inset by the Inspector width').toBeGreaterThanOrEqual(255);
  expect(g.main.width - g.scroller.width).toBeLessThanOrEqual(272);
  expect(g.scroller.width, 'the page area keeps a usable floor').toBeGreaterThan(200);
  expect(await win.locator('[data-pane]').count()).toBe(0);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');
});
