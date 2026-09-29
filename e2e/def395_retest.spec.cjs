// DEF-395 FIX-READY retest (QA). Drives the REAL dev build through the
// canonical e2e/lib/launch.cjs helper and reproduces the filed repro exactly:
// open test-fixtures/phase56/phase56-comic.cbz through the real Open button,
// enter the comic reading view, then exercise the single/double/close controls
// with REAL Playwright clicks (actionability enforced - no DOM click()).
//
// Acceptance:
//  - no uncaught renderer error and no React #185 / "Maximum update depth"
//    console entry on open and while idle for >= 5 s;
//  - real click on [aria-label="Comic double page"] completes and shows 2
//    pages, real click on [aria-label="Comic single page"] completes and shows
//    1 page, real click on [aria-label="Close reading view"] unmounts the
//    reading region;
//  - the renderer is not wedged afterwards (win.evaluate returns promptly and
//    the same CBZ can be re-opened and re-entered).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const CBZ = path.join(FIX, 'phase56-comic.cbz');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
let consoleLog = [];

test.beforeEach(async () => {
  consoleLog = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def395');
  app = null;
  win = null;
});

test.setTimeout(240000);

async function openCbzDocument() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, CBZ);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 60000 });
}

async function enterComicView() {
  const openBtn = win.locator('[aria-label="Open comic view"]');
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await win.waitForSelector('[data-reading-view][data-reading-mode="comic"]', {
    state: 'visible',
    timeout: 15000,
  });
}

function errorsSince(mark) {
  return consoleLog
    .slice(mark)
    .filter((l) => l.startsWith('[pageerror]') || /#185|Maximum update depth/i.test(l));
}

async function boundedEvaluate(fn, ms) {
  return Promise.race([
    win.evaluate(fn),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`win.evaluate did not return within ${ms}ms`)), ms)),
  ]);
}

test('DEF-395: comic view is stable and single/double/close respond to real clicks', async () => {
  await openCbzDocument();
  const mark = consoleLog.length;
  const tClick = Date.now();
  await enterComicView();
  const visibleMs = Date.now() - tClick;
  // Idle for at least 5 s and watch for the React #185 update loop.
  await win.waitForTimeout(5000);
  const idleMs = Date.now() - tClick;
  const openErrors = errorsSince(mark);
  console.log('DEF395_OPEN ' + JSON.stringify({ visibleMs, idleMs, openErrors }));

  const progress = win.locator('[aria-label="Reading progress"]');
  const stage = win.locator('[data-comic-stage]');
  expect(openErrors, 'comic view raised an error on open / while idle').toEqual([]);
  expect(await progress.getAttribute('aria-valuenow'), 'comic view did not open on page 1').toBe('1');
  expect(await progress.innerText()).toContain('Page 1 of 12');
  expect(await stage.getAttribute('data-comic-layout')).toBe('single');
  expect(await win.locator('[data-comic-page]').count(), 'single layout must show one page').toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase56-comic-single.png') });

  // REAL click - double page: must complete and show 2 pages.
  await win.locator('[aria-label="Comic double page"]').click();
  await expect(stage, 'real double-page click did not apply').toHaveAttribute('data-comic-layout', 'double');
  expect(await win.locator('[data-comic-page]').count(), 'double layout must show two pages').toBe(2);
  await win.screenshot({ path: path.join(SHOTS, 'phase56-comic-double.png') });

  // REAL click - single page: must complete and show 1 page.
  await win.locator('[aria-label="Comic single page"]').click();
  await expect(stage, 'real single-page click did not apply').toHaveAttribute('data-comic-layout', 'single');
  expect(await win.locator('[data-comic-page]').count(), 'single layout must show one page').toBe(1);

  // REAL click - close: reading region must unmount.
  await win.locator('[aria-label="Close reading view"]').click();
  await expect(win.locator('[data-reading-view]'), 'real close click did not dismiss the reader').toHaveCount(0);

  // Renderer must not be wedged: CDP evaluate returns promptly.
  const tEval = Date.now();
  const ping = await boundedEvaluate(() => 2 + 2, 5000);
  const evalMs = Date.now() - tEval;
  expect(ping).toBe(4);

  // Subsequent real interaction: close the first tab cleanly, then re-open the
  // same CBZ and re-enter the comic view.
  const closers = win.locator('[data-tab-id] .tab-close');
  while ((await closers.count()) > 0) {
    await closers.first().click();
    await win.waitForTimeout(250);
  }
  await openCbzDocument();
  await enterComicView();
  expect(await win.locator('[data-comic-page]').count(), 're-opened comic is not on one page').toBe(1);
  expect(await progress.getAttribute('aria-valuenow'), 're-opened comic is not on page 1').toBe('1');

  const finalErrors = errorsSince(mark);
  console.log('DEF395_POSTCLOSE ' + JSON.stringify({ evalMs, finalErrors }));
  expect(finalErrors, 'comic view raised an error during the session').toEqual([]);
});
