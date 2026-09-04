const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([]);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }

async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('B14 precise: does OCR suspects panel overlap the shapes/ann-toolbar?', async () => {
  test.setTimeout(180000);
  await openSample('scanned.pdf');

  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="recognizeText"]');
  await window.waitForSelector('.ocr-dialog', { timeout: 10000 });
  const curScope = window.locator('[data-ocr-scope="currentPage"]');
  if (await curScope.count()) { await curScope.check({ force: true }); }
  await window.waitForTimeout(300);
  await window.click('[data-ocr-confirm]');

  // poll for suspects panel
  for (let i = 0; i < 60; i++) {
    await window.waitForTimeout(1000);
    const has = await window.locator('[data-ocr-suspects-panel]').count();
    if (has) break;
  }
  await window.waitForTimeout(800);

  const geom = await window.evaluate(() => {
    function rect(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    const panel = rect('[data-ocr-suspects-panel]');
    const ann = rect('.ann-toolbar');
    const pageView = rect('.page-view, .workspace');
    return { panel, ann, pageView, docW: window.innerWidth, docH: window.innerHeight };
  });
  console.log('B14 geometry:', JSON.stringify(geom, null, 2));

  function intersections(a, b) {
    if (!a || !b) return false;
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return { overlapW: Math.round(ix), overlapH: Math.round(iy), overlaps: ix > 0 && iy > 0 };
  }
  const panelVsAnn = intersections(geom.panel, geom.ann);
  console.log('B14 panel vs ann-toolbar intersection:', JSON.stringify(panelVsAnn));

  await window.screenshot({ path: 'screenshots/b14-precise-overlap.png' });
});
