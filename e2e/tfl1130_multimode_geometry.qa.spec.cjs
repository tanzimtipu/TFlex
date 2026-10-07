// TFL-1133 (TFL-1116 DEF-620) - blast-radius probe for the page-size scope key.
//
// `livePageSizeScopeKey` keeps the PANE branch for Multi Mode (pane "A" / "B").
// The DEF-620 fix only changed the single-mode branch (tab id), and the pane
// branch is byte-identical to the pre-fix `pane ?? "single"` key, so this probe
// documents the neighbouring surface.
//
// RESULT (2026-10-07, qa TFL-1133): both panes read Inspector Size "Not
// available" for normally-opened documents - filed as DEF-622, a PRE-EXISTING
// gap (Multi Mode reuses the tab-panes without remount, and the report effect
// keys only on `[pageSizes]`, so the pane maps never receive a report). Not a
// regression of the DEF-620 fix.
//
// FIXED (TFL-1116): DocumentView's page-size report effect now also keys on the
// pane scope (`multiPane`), so entering Multi Mode / binding a document to a
// pane re-publishes that pane's own measured map. The probe is live again (the
// `test.fixme` was removed) and guards the fix.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1130-multimode');
const A = path.join(TMP, 'tfl1130-alpha-612x792.pdf');
const B = path.join(TMP, 'tfl1130-beta-595x842.pdf');

let app = null;
let win = null;
test.setTimeout(180000);

async function buildPdf(file, count, w, h) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([w, h]);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  await buildPdf(A, 3, 612, 792);
  await buildPdf(B, 5, 595, 842);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1130-multimode');
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
  await win.waitForTimeout(1000);
}

async function focusPaneByPage(pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPaneByPage: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width / 2, vp.w - 30));
  const y = Math.max(70, Math.min(box.y + box.height / 2, vp.h - 30));
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
}

test('Multi Mode two-pane geometry resolves each pane own page-size map', async () => {
  // DEF-622 fixed (TFL-1116): the report effect now keys on the pane scope, so
  // entering Multi Mode / binding a document to a pane re-publishes each pane's
  // own measured map and the Inspector reads the pane's real Size.
  await openFixture(A);
  await openFixture(B);
  await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 2, null, {
    timeout: 15000,
  });
  // Make ALPHA the active tab so Multi Mode seeds pane A with it.
  await win.locator('[data-tab-id]').filter({ hasText: 'tfl1130-alpha' }).first().click();
  await win.waitForTimeout(500);

  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({
    timeout: 15000,
  });
  await win
    .locator('.tab-pane[data-pane="B"] [data-pane-pick]')
    .filter({ hasText: 'tfl1130-beta' })
    .first()
    .click();
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({
    timeout: 30000,
  });
  await win.waitForTimeout(1500);

  const size = win.locator('[data-inspector-row="size"]');
  const focusAttr = (pane) =>
    win.locator(`.tab-pane[data-pane="${pane}"]`).getAttribute('data-pane-focused');

  await focusPaneByPage('A');
  await win.waitForTimeout(1500);
  const sizeA = (await size.innerText()).trim();
  const focusA = await focusAttr('A');
  console.log(`[TFL-1130-mm] pane A focused=${focusA} size="${sizeA}"`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1130_multimode_pane_a.png') });

  await focusPaneByPage('B');
  await win.waitForTimeout(1500);
  const sizeB = (await size.innerText()).trim();
  const focusB = await focusAttr('B');
  console.log(`[TFL-1130-mm] pane B focused=${focusB} size="${sizeB}"`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1130_multimode_pane_b.png') });

  expect(focusA, 'pane A focused for the first read').toBe('true');
  expect(sizeA, 'pane A Size reads A own geometry').toContain('612 x 792 pt');
  expect(focusB, 'pane B focused for the second read').toBe('true');
  expect(sizeB, 'pane B Size reads B own geometry').toContain('595 x 842 pt');
});
