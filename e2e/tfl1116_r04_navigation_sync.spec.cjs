// TFL-1116 C5 - R04 navigation synchronization (frontend-dev).
//
// One document-scoped navigation model: a committed page jump from OUTSIDE
// the thumbnail rail (the ViewStrip page input, the Next/Previous buttons)
// must reveal the viewed page's thumbnail, keep the footer input in step,
// and leave the page SELECTION set untouched. Ordinary main-view scrolling
// must not recentre the rail (the Bug 3 gate). Switching away and back to a
// tab must restore that document's stored reading page with the rail marker
// and the footer input agreeing.
//
// Every tab-pane stays MOUNTED (MultiPane keys each by tab id), so every
// locator is scoped to the pane under test via `[data-pane-tab="<id>"]`.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1116-r04');
const BIG_PAGES = 520;
const BIG_FIXTURE = path.join(TMP, 'tfl1116-r04-520.pdf');
const SMALL_FIXTURE = path.join(TMP, 'tfl1116-r04-small.pdf');

let app = null;
let win = null;
test.setTimeout(300000);

async function buildPdf(file, count) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([612, 792]);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  await buildPdf(BIG_FIXTURE, BIG_PAGES);
  await buildPdf(SMALL_FIXTURE, 3);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r04');
  app = null;
  win = null;
});

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-context-panel="pages"] .thumb-item', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function activeTabId() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
}

function pane(tabId) {
  return win.locator(`[data-pane-tab="${tabId}"]`);
}

async function diag(tabId) {
  return pane(tabId).evaluate((root) => {
    const d = window.tflexDiagnostics();
    return { pageCount: d.pageCount, currentPage: d.currentPage };
  });
}

async function jumpTo(tabId, page) {
  const input = pane(tabId).locator('input.page-input[aria-label="Current page"]');
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill(String(page));
  await input.press('Enter');
  await expect(input).toHaveValue(String(page), { timeout: 20000 });
  await win.waitForFunction(
    (p) => window.tflexDiagnostics().currentPage === p,
    page,
    { timeout: 20000 },
  );
  // A far smooth scroll through a 520-page document lets the virtualised
  // canvas mount a fresh window; give that settle before the next gesture.
  await win.waitForTimeout(2500);
}

// The viewed page's current marker must sit INSIDE the rail's scroll viewport
// (the rail revealed it after the committed jump).
async function railMarkerState(tabId, page) {
  return pane(tabId).evaluate((root, p) => {
    const marker = root.querySelector(
      `.thumb-item[data-page="${p}"] [data-thumb-current-marker]`,
    );
    const viewport = root.querySelector('.thumb-scroller-inner');
    if (marker === null || viewport === null) return { found: false, inside: false };
    const m = marker.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    return {
      found: true,
      inside: m.top >= v.top - 1 && m.bottom <= v.bottom + 1,
    };
  }, page);
}

async function shot(name) {
  const file = path.join(SHOTS, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}

test('R04 external jumps reveal the rail, keep the footer in step and selection independent; tab return agrees', async () => {
  await openFixture(BIG_FIXTURE);
  const bigTabId = await activeTabId();
  expect(bigTabId).not.toBeNull();
  const eng0 = await diag(bigTabId);
  expect(eng0.pageCount).toBe(BIG_PAGES);
  expect(eng0.currentPage).toBe(1);

  const input = pane(bigTabId).locator('input.page-input[aria-label="Current page"]');

  // Selection is host-owned and independent of the viewed page.
  await pane(bigTabId).locator('.thumb-item[data-page="2"] [data-thumb-checkbox]').check();
  await expect(pane(bigTabId).locator('[data-context-panel-selection-count]')).toContainText('1 selected');

  // --- jump 1 -> 260 (ViewStrip input) ------------------------------------
  await jumpTo(bigTabId, 260);
  await expect(input).toHaveValue('260');
  expect((await diag(bigTabId)).currentPage).toBe(260);
  await expect
    .poll(async () => (await railMarkerState(bigTabId, 260)).inside, { timeout: 10000 })
    .toBe(true);
  await shot('tfl1116_r04_jump260');

  // The selection set did not move with the viewed page.
  await expect(pane(bigTabId).locator('[data-context-panel-selection-count]')).toContainText('1 selected');
  await expect(pane(bigTabId).locator('.thumb-item[data-page="2"]')).toHaveClass(/thumb-selected/);

  // --- jump 260 -> 520 (ViewStrip input) ----------------------------------
  await jumpTo(bigTabId, 520);
  await expect(input).toHaveValue('520');
  expect((await diag(bigTabId)).currentPage).toBe(520);
  await expect
    .poll(async () => (await railMarkerState(bigTabId, 520)).inside, { timeout: 10000 })
    .toBe(true);
  await expect(pane(bigTabId).locator('[data-view-strip] button[aria-label="Next page"]')).toBeDisabled();
  await shot('tfl1116_r04_jump520');

  await expect(pane(bigTabId).locator('[data-context-panel-selection-count]')).toContainText('1 selected');

  // Let the 520-page smooth scroll finish landing before the view transition,
  // then capture the big tab's reading page straight from its own pane.
  await win.waitForTimeout(1500);
  const preSwitchPage = Number(await input.inputValue());
  expect(preSwitchPage).toBe(520);

  // --- tab reactivation ---------------------------------------------------
  await openFixture(SMALL_FIXTURE);
  await win.waitForFunction(
    () => document.querySelectorAll('[data-tab-id]').length >= 2,
    null,
    { timeout: 15000 },
  );
  const smallTabId = await activeTabId();
  expect(smallTabId).not.toBe(bigTabId);
  await jumpTo(smallTabId, 2);
  expect((await diag(smallTabId)).currentPage).toBe(2);

  await win.locator(`[data-tab-id="${bigTabId}"]`).first().click();
  await win.waitForFunction(
    (id) => {
      const el = document.querySelector('[data-tab-id][aria-selected="true"]');
      return el !== null && el.getAttribute('data-tab-id') === id;
    },
    bigTabId,
    { timeout: 20000 },
  );
  // All tabs stay mounted, so read the big tab's own pane (tflexDiagnostics
  // reports the ACTIVE tab and cannot address a hidden one). The stored
  // reading page is restored and the footer input and rail marker AGREE on it
  // - the captured 520/150 split must not occur.
  await expect(input).toHaveValue(String(preSwitchPage));
  await expect(pane(smallTabId).locator('input.page-input[aria-label="Current page"]')).toHaveValue('2');
  await expect
    .poll(async () => (await railMarkerState(bigTabId, preSwitchPage)).inside, { timeout: 10000 })
    .toBe(true);
  await shot('tfl1116_r04_tab_return');
});