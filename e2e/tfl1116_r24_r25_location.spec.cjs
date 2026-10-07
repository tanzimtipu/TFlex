// TFL-1116 C5b - R24 page/range truthfulness + R25 Book View reading location
// (frontend-dev).
//
// R24: in a multi-page layout the ViewStrip jump field carries the FOCUSED page
// (one number) and a SEPARATE "Visible N-M" summary reports the group the
// viewport actually holds (FOUR = 4 pages, TWO = 2). The summary must match the
// page slots on screen.
//
// R25: Book View opens at the current reading location (not page 1) and closing
// carries the reached location back so the DocumentView returns there.
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
const TMP = path.join(os.tmpdir(), 'tfl1116-r24-r25');
const RANGE_FIXTURE = path.join(TMP, 'tfl1116-r24-range.pdf'); // 20 pages
const BOOK_FIXTURE = path.join(TMP, 'tfl1116-r25-book.pdf'); // 12 pages

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
  await buildPdf(RANGE_FIXTURE, 20);
  await buildPdf(BOOK_FIXTURE, 12);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r24-r25');
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
  return pane(tabId).evaluate(() => {
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
  await win.waitForTimeout(2000);
}

// The page slots whose boxes intersect the scroller's viewport.
async function visibleCanvasPages(tabId) {
  return pane(tabId).evaluate((root) => {
    const scroller = root.querySelector('.document-scroller');
    if (scroller === null) return [];
    const v = scroller.getBoundingClientRect();
    return Array.from(root.querySelectorAll('.page-slot[data-page]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > v.top + 2 && r.top < v.bottom - 2;
      })
      .map((el) => Number(el.getAttribute('data-page')))
      .sort((a, b) => a - b);
  });
}

async function shot(name) {
  const file = path.join(SHOTS, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}

function firstPageOfProgress(text) {
  const m = /Page\s+(\d+)/.exec(text);
  return m === null ? null : Number(m[1]);
}

test('R24: the jump field is the focused page and the visible summary matches the on-screen group', async () => {
  await openFixture(RANGE_FIXTURE);
  const tabId = await activeTabId();
  expect(tabId).not.toBeNull();
  expect((await diag(tabId)).pageCount).toBe(20);

  // Four pages in two rows.
  await pane(tabId).locator('[data-page-layout-option="four"]').first().click();
  await win.waitForTimeout(1500);

  await jumpTo(tabId, 7);

  const input = pane(tabId).locator('input.page-input[aria-label="Current page"]');
  await expect(input).toHaveValue('7');

  const summary = pane(tabId).locator('[data-page-visible-range]');
  await expect(summary).toHaveCount(1);
  await expect(summary).toHaveAttribute('data-page-visible-range', '7-10');
  await expect(summary).toHaveText('Visible 7-10');

  // The summary is truthful: the pages it names are on screen.
  await expect
    .poll(
      async () => {
        const visible = await visibleCanvasPages(tabId);
        return visible.includes(7) && visible.includes(10);
      },
      { timeout: 15000 },
    )
    .toBe(true);

  await shot('tfl1116_r24_visible_range');
});

test('R25: Book View opens at the reading location and carries the reached page back', async () => {
  await openFixture(BOOK_FIXTURE);
  const tabId = await activeTabId();
  expect(tabId).not.toBeNull();
  expect((await diag(tabId)).pageCount).toBe(12);

  await jumpTo(tabId, 5);
  const input = pane(tabId).locator('input.page-input[aria-label="Current page"]');
  await expect(input).toHaveValue('5');

  // Open Book View: it must start at the reading location, not page 1.
  await pane(tabId).locator('[data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);

  const progressAtEntry = await win.locator('[data-book-progress]').innerText();
  expect(firstPageOfProgress(progressAtEntry), `Book View opened at "${progressAtEntry}"`).toBe(5);
  await shot('tfl1116_r25_bookview_entry');

  // Turn one page, then read the location the reader reached.
  await win.locator('[data-book-next]').click();
  await win.waitForTimeout(900);
  const progressAfter = await win.locator('[data-book-progress]').innerText();
  const reachedPage = firstPageOfProgress(progressAfter);
  expect(reachedPage).not.toBeNull();
  expect(reachedPage).not.toBe(5);

  // Close: the DocumentView must return to the reached location.
  await win.locator('[aria-label="Close book view"]').click();
  await expect(win.locator('[data-book-view]')).toHaveCount(0);
  await expect(input).toHaveValue(String(reachedPage), { timeout: 15000 });
  await win.waitForFunction(
    (p) => window.tflexDiagnostics().currentPage === p,
    reachedPage,
    { timeout: 20000 },
  );
  await shot('tfl1116_r25_bookview_return');
});

test('DEF-627: leaving Book View by a tab switch carries the reached page back', async () => {
  // Tab A: reach a page in Book View.
  await openFixture(BOOK_FIXTURE);
  const tabA = await activeTabId();
  expect(tabA).not.toBeNull();

  await jumpTo(tabA, 5);
  await pane(tabA).locator('[data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);

  await win.locator('[data-book-next]').click();
  await win.waitForTimeout(900);
  const reachedPage = firstPageOfProgress(await win.locator('[data-book-progress]').innerText());
  expect(reachedPage).not.toBeNull();
  expect(reachedPage).not.toBe(5);
  await shot('tfl1116_r25_bookview_before_tab_switch');

  // A second document tab, then open ITS Book View. The single Book View host
  // switches to tab B, which unmounts tab A's Book View WITHOUT the Close
  // button (the DEF-627 exit route).
  await win.locator('[data-new-tab]').first().click();
  await win.waitForSelector('.welcome', { timeout: 8000 });
  await openFixture(BOOK_FIXTURE);
  const tabB = await activeTabId();
  expect(tabB).not.toBeNull();
  expect(tabB).not.toBe(tabA);

  await pane(tabB).locator('[data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);

  // Return to tab A: its Book View is gone, so the DocumentView shows the
  // PERSISTED location — which must be the page reached in Book View.
  await win.locator(`[data-tab-id="${tabA}"]`).first().click();
  await win.waitForTimeout(1500);
  const inputA = pane(tabA).locator('input.page-input[aria-label="Current page"]');
  await expect(inputA).toHaveValue(String(reachedPage), { timeout: 20000 });
  await win.waitForFunction(
    (p) => window.tflexDiagnostics().currentPage === p,
    reachedPage,
    { timeout: 20000 },
  );
  await shot('tfl1116_r25_bookview_tab_switch_return');
});