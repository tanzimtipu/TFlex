// TFL-1116 C12 (R18 + R19) — OCR suspects review polish + bounded rendering.
//
// Launches the real app through the canonical e2e launcher, opens the dense
// scanned.pdf sample, runs OCR over the document, then asserts the REVIEW
// surface:
//   * R18 - the header reports the suspect COUNT, the list is grouped by page,
//     and clicking a row leaves it VISIBLY SELECTED;
//   * R19 - the noisy fixture mounts a BOUNDED window, not every row; the live
//     total vs mounted counts are logged as measurement.
// Captures screenshots/tfl1116_r18_ocr_review.png.
//
// The pure 3708 / 10000 profiles live in
// test/unit/renderer/tfl1116_ocrPerf.test.ts (run separately and logged).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r18-r19');
  app = null;
  win = null;
});

async function openScannedSample() {
  await win.locator('.sample-card', { hasText: 'scanned.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
}

async function runOcrAllPages() {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'recognize');
  await win.waitForTimeout(300);
  await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
  // Default scope is "All pages"; the dense fixture is what produces the large
  // suspect list this finding is about.
  await win.click('[data-ocr-confirm]');
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 360000 });
  await win.waitForTimeout(800);
}

async function openSuspectsSurface() {
  if ((await win.locator('[data-ocr-suspects-panel]').count()) > 0) return;
  if ((await win.locator('[data-command-palette]').count()) === 0) {
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  }
  await win.fill('[data-command-palette-input]', 'suspects');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="ocrSuspects"]').first().click();
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 8000 });
  await win.waitForTimeout(400);
}

async function measure() {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-ocr-suspects-panel]');
    if (!panel) return null;
    const badge = panel.querySelector('[data-ocr-suspect-count]');
    const total = badge ? Number.parseInt(badge.getAttribute('data-ocr-suspect-count') || '0', 10) : 0;
    const pages = panel.querySelectorAll('[data-ocr-suspects-page]').length;
    const windowed = panel.querySelector('[data-ocr-suspects-window]') !== null;
    const mounted = panel.querySelectorAll('[data-ocr-suspect-word]').length;
    const header = panel.querySelector('.ocr-suspects-summary');
    const navigationOnly = panel.querySelector('[data-ocr-suspects-navigation-only]') !== null;
    return {
      total,
      pages,
      windowed,
      mounted,
      navigationOnly,
      headerText: header ? header.textContent : '',
    };
  });
}

test('R18 + R19: the OCR suspects review is grouped, bounded and selected-row visible', async () => {
  await openScannedSample();
  await runOcrAllPages();
  await openSuspectsSurface();

  const m = await measure();
  console.log(`[tfl1116 R18/R19] ${JSON.stringify(m)}`);
  expect(m, 'the suspects panel + count badge render').not.toBeNull();

  // R18 - header count + page grouping + honest navigation-only label.
  expect(m.total, 'the dense fixture yields a large suspect list').toBeGreaterThan(200);
  expect(m.headerText).toContain('low-confidence');
  expect(m.pages, 'suspects are grouped by page').toBeGreaterThan(0);
  expect(m.navigationOnly, 'the surface is labelled navigation-only').toBe(true);

  // R19 - the large list mounts a bounded window, never every row.
  expect(m.windowed, 'the large list renders a bounded window').toBe(true);
  expect(m.mounted, 'mounted rows stay bounded').toBeGreaterThan(0);
  expect(m.mounted, 'mounted rows stay bounded').toBeLessThan(60);
  expect(m.mounted, 'mounted rows are far fewer than the total').toBeLessThan(m.total);

  // R18 - clicking a row leaves it visibly selected.
  const firstOption = win.locator('[data-ocr-suspects-window] [data-ocr-suspect-word]').first();
  await firstOption.click({ timeout: 8000 });
  await win.waitForSelector('[data-ocr-suspect-selected="true"]', { timeout: 8000 });
  const selected = await win.evaluate(() => {
    const el = document.querySelector('[data-ocr-suspect-selected="true"]');
    return {
      text: el ? el.textContent : null,
      className: el ? String(el.className) : null,
    };
  });
  console.log(`[tfl1116 R18 selected] ${JSON.stringify(selected)}`);
  expect(selected.text, 'a selected row is visible').toBeTruthy();

  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r18_ocr_review.png') });
  console.log(`[tfl1116 R18] screenshot ${path.join(SHOTS, 'tfl1116_r18_ocr_review.png')}`);
});
