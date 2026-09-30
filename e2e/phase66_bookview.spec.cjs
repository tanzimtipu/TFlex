// Phase 66 (chunk 1) focused-verification e2e (QA).
//
// Book View entry (canvas top-left, all formats) + the in-canvas read-only
// mode shell. Chunk 1 is single-page read-only ONLY: no spread, crease, flip,
// single/double toggle or annotation wiring (those are chunks 2-3) and this
// spec must not assert any of them.
//
// Launch ONLY through e2e/lib/launch.cjs. The OS open dialog is native, so
// `dialog.showOpenDialog` is stubbed in the main process and the app's real
// Open button is clicked - the same pattern e2e/phase56_reading.spec.cjs uses.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const CBZ = path.join(FIX, 'phase56-comic.cbz');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase66');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function clickOpen() {
  await win.locator('[aria-label="Open PDF document"]').first().click();
}

// A plain PDF opens straight into the workspace; a converted comic shows the
// conversion notice first. Wait for the canvas entry in both cases.
async function openAndWaitEntry(filePath) {
  await stubOpen(filePath);
  await clickOpen();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
}

async function panelState() {
  return win.locator('.app-main').evaluate((el) => ({
    rail: el.getAttribute('data-rail-collapsed'),
    inspector: el.getAttribute('data-inspector-collapsed'),
  }));
}

// ---------------------------------------------------------------------------
// Criterion 1 - the top-left entry opens Book View in the SAME window, for a
// plain PDF and the cbz fixture, and Close dismisses it.
// ---------------------------------------------------------------------------
async function verifyEntryAndSameWindow(fixturePath, tag) {
  await openAndWaitEntry(fixturePath);

  const entry = win.locator('[aria-label="Book View"]');
  expect(await entry.isVisible(), `${tag}: Book View entry is not visible`).toBe(true);
  // Top-left: its left edge sits in the left half of the window frame.
  // Electron's page.viewportSize() is null, so read the real inner size.
  const box = await entry.boundingBox();
  const frame = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box, `${tag}: entry has no layout box`).not.toBeNull();
  expect(box.x, `${tag}: entry is not top-left (x=${box && box.x})`).toBeLessThan(frame.width / 2);
  expect(box.y, `${tag}: entry is not top-left (y=${box && box.y})`).toBeLessThan(frame.height / 2);
  await win.screenshot({ path: path.join(SHOTS, `phase66-${tag}-entry.png`) });

  const windowsBefore = app.windows().length;
  await entry.click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(400);

  expect(await win.locator('[data-book-view]').count(), `${tag}: Book View did not open`).toBe(1);
  expect(app.windows().length, `${tag}: Book View opened a second BrowserWindow`).toBe(windowsBefore);
  // Same window: the book surface is in the window we have been driving.
  expect(await win.locator('.book-view').count()).toBe(1);
  await win.screenshot({ path: path.join(SHOTS, `phase66-${tag}-open.png`) });

  await win.locator('[aria-label="Close book view"]').click();
  await expect(win.locator('[data-book-view]'), `${tag}: Close did not dismiss Book View`).toHaveCount(0);
  expect(app.windows().length, `${tag}: window count changed on close`).toBe(windowsBefore);
}

test('criterion 1: plain PDF opens Book View in the same window and closes', async () => {
  await verifyEntryAndSameWindow(getSamplePath('report.pdf'), 'pdf');
});

test('criterion 1: cbz fixture opens Book View in the same window and closes', async () => {
  await verifyEntryAndSameWindow(CBZ, 'cbz');
});

// ---------------------------------------------------------------------------
// Criterion 2 - while Book View is on the PAGES rail and Inspector are
// collapsed and no Action Dock is present; Close restores the prior state.
// ---------------------------------------------------------------------------
test('criterion 2: Book View collapses rail/inspector, removes the dock, and restores on Close', async () => {
  await openAndWaitEntry(getSamplePath('report.pdf'));

  const before = await panelState();
  const dockBefore = await win.locator('[data-action-dock]').count();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-pdf-before-open.png') });

  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(400);

  const during = await panelState();
  const dockDuring = await win.locator('[data-action-dock]').count();
  console.log('P66_PANEL ' + JSON.stringify({ before, during, dockBefore, dockDuring }));
  expect(during.rail, 'PAGES rail is not collapsed while Book View is open').toBe('true');
  expect(during.inspector, 'Inspector is not collapsed while Book View is open').toBe('true');
  expect(dockDuring, 'an Action Dock is present while Book View is open').toBe(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-pdf-shell.png') });

  await win.locator('[aria-label="Close book view"]').click();
  await expect(win.locator('[data-book-view]')).toHaveCount(0);
  await win.waitForTimeout(500);

  const after = await panelState();
  const dockAfter = await win.locator('[data-action-dock]').count();
  console.log('P66_RESTORE ' + JSON.stringify({ after, dockAfter }));
  expect(after, 'rail/inspector state was not restored after Close').toEqual(before);
  expect(dockAfter, 'Action Dock state was not restored after Close').toBe(dockBefore);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-pdf-restored.png') });
});
