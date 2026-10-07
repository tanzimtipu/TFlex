// TFL-1073 — Phase 111 navigator PERFORMANCE measurements (chunk G QA).
//
// REQUIREMENTS.md Phase 111 names three items to time: view switch, panel
// resize / split drag, and long-list scroll. No numeric budget is written in
// REQUIREMENTS.md or the bundle; the only documented timing is the 140 ms
// motion token. This spec records measured wall-clock numbers and the
// long-list scroll responsiveness (the renderer must not block / must keep the
// scroll position moving). Values are printed for the report; no invented
// threshold is asserted.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const TMP = path.join(os.tmpdir(), 'tfl1073-perf');
fs.mkdirSync(TMP, { recursive: true });
const BIG = path.join(TMP, 'tfl1073-big.pdf');
const PANEL = '[data-context-panel="pages"]';

let app = null;
let win = null;
test.setTimeout(300000);

async function buildBigPdf(file, count) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([612, 792]);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => {
  await buildBigPdf(BIG, 120);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1073-perf');
  app = null;
  win = null;
});

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

test('TF1073-PERF view switch, split toggle, panel resize and long-list scroll', async () => {
  await openFixture(BIG);
  const pageCount = (await win.evaluate(() => window.tflexDiagnostics().pageCount));
  console.log('[TF1073-PERF] pageCount ' + pageCount);

  const timeClick = async (click) => {
    const t0 = Date.now();
    await click();
    return Date.now() - t0;
  };

  // 1. View switch: Pages -> Outline (mount) -> Pages.
  const t0 = Date.now();
  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await expect(win.locator('[data-context-panel-view="outline"]')).toHaveCount(1);
  const toOutline = Date.now() - t0;
  const t1 = Date.now();
  await win.locator('[data-context-panel-view-tab="pages"]').click();
  await expect(win.locator('[data-context-panel-view="pages"]')).toHaveCount(1);
  console.log('[TF1073-PERF] viewSwitch pages->outline ' + toOutline + 'ms, outline->pages ' + (Date.now() - t1) + 'ms');

  // 2. Split toggle.
  const tSplit = Date.now();
  await win.locator('[data-context-panel-more]').click();
  await win.locator('[data-context-panel-layout-split]').click();
  await expect(win.locator('[data-context-panel-split-divider]')).toHaveCount(1);
  console.log('[TF1073-PERF] splitToggle ' + (Date.now() - tSplit) + 'ms');

  // 3. Split divider keyboard drag commit.
  const divider = win.locator('[data-context-panel-split-divider]');
  await divider.focus();
  const tKey = Date.now();
  await win.keyboard.press('ArrowUp');
  await win.waitForTimeout(60);
  console.log('[TF1073-PERF] splitKeyStep ' + (Date.now() - tKey) + 'ms -> aria-valuenow ' + (await divider.getAttribute('aria-valuenow')));

  // 4. Panel resize (keyboard) commit.
  const leftHandle = win.locator('[data-panel-resize="left"]');
  await leftHandle.focus();
  const tResize = Date.now();
  await win.keyboard.press('ArrowRight');
  await win.waitForTimeout(60);
  console.log('[TF1073-PERF] panelResizeStep ' + (Date.now() - tResize) + 'ms -> ' + (await leftHandle.getAttribute('aria-valuenow')) + 'px');

  // 5. Long-list scroll responsiveness on a 120-page document.
  const scroll = await win.evaluate(async () => {
    const inner = document.querySelector('.thumb-scroller-inner');
    const scroller = document.querySelector('.document-scroller');
    const target = inner || scroller;
    if (!target) return null;
    const start = target.scrollTop;
    const t0 = performance.now();
    let frames = 0;
    let raf;
    const tick = () => { frames += 1; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    for (let i = 0; i < 6; i += 1) {
      target.scrollTop += 1200;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => requestAnimationFrame(r));
    }
    cancelAnimationFrame(raf);
    const ms = performance.now() - t0;
    return { start, end: target.scrollTop, ms: Math.round(ms), frames, fps: Math.round((frames / ms) * 1000) };
  });
  console.log('[TF1073-PERF] longListScroll ' + JSON.stringify(scroll));
  expect(scroll).not.toBeNull();
  expect(scroll.end).toBeGreaterThan(scroll.start);
});
