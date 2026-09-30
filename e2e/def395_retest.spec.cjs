// DEF-395 FIX-READY retest (QA). Drives the REAL dev build through the
// canonical e2e/lib/launch.cjs helper and reproduces the filed repro on the
// Phase 66 (chunk 1) shell: open test-fixtures/phase56/phase56-comic.cbz
// through the real Open button, enter the canvas "Book View" (the control that
// superseded the removed "Open comic view" trigger), then Close.
//
// The DEF-395 regression guard is unchanged in substance: the reader must open
// and stay idle for >= 5 s with NO uncaught renderer error and NO React #185 /
// "Maximum update depth" console entry, Close must work with a REAL click, and
// the renderer must not be wedged.
//
// SUPERSEDED by Phase 66 (chunk 1): the Phase 56 comic single/double toggles
// were removed; single/double + flip return with Book View chunks 2-3, so their
// clicks are no longer exercised here.
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

async function enterBookView() {
  const openBtn = win.locator('[aria-label="Book View"]');
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await win.waitForSelector('[data-book-view]', {
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

test('DEF-395: Book View is stable and Close responds to a real click', async () => {
  await openCbzDocument();
  const mark = consoleLog.length;
  const tClick = Date.now();
  await enterBookView();
  const visibleMs = Date.now() - tClick;
  // Idle for at least 5 s and watch for the React #185 update loop.
  await win.waitForTimeout(5000);
  const idleMs = Date.now() - tClick;
  const openErrors = errorsSince(mark);
  console.log('DEF395_OPEN ' + JSON.stringify({ visibleMs, idleMs, openErrors }));

  expect(openErrors, 'Book View raised an error on open / while idle').toEqual([]);
  expect(await win.locator('[data-book-view]').count(), 'Book View did not open').toBe(1);
  expect(await win.locator('[data-book-page]').count(), 'Book View rendered no page').toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-def395-book-open.png') });

  // REAL click - close: the book surface must unmount.
  await win.locator('[aria-label="Close book view"]').click();
  await expect(win.locator('[data-book-view]'), 'real close click did not dismiss Book View').toHaveCount(0);

  // Renderer must not be wedged: CDP evaluate returns promptly.
  const tEval = Date.now();
  const ping = await boundedEvaluate(() => 2 + 2, 5000);
  const evalMs = Date.now() - tEval;
  expect(ping).toBe(4);

  // Subsequent real interaction: close the first tab cleanly, then re-open the
  // same CBZ and re-enter Book View.
  const closers = win.locator('[data-tab-id] .tab-close');
  while ((await closers.count()) > 0) {
    await closers.first().click();
    await win.waitForTimeout(250);
  }
  await openCbzDocument();
  await enterBookView();
  expect(await win.locator('[data-book-page]').count(), 're-opened book rendered no page').toBe(1);

  const finalErrors = errorsSince(mark);
  console.log('DEF395_POSTCLOSE ' + JSON.stringify({ evalMs, finalErrors }));
  expect(finalErrors, 'Book View raised an error during the session').toEqual([]);
});
