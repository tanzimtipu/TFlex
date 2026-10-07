// TFL-1116 C5 / R04 - QA isolation probe (qa). Added because the dev's
// e2e/tfl1116_r04_navigation_sync.spec.cjs fails deterministically on the
// current fresh build with a renderer React #185 (max update depth) during the
// first external jump. This probe narrows the trigger: does merely opening the
// 520-page fixture crash the pane, or does the committed 1 -> 260 jump?
//
// The dev's spec is left untouched. Every launch goes through launchApp.
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
const TMP = path.join(os.tmpdir(), 'tfl1116-r04-qa');
const BIG_FIXTURE = path.join(TMP, 'tfl1116-r04-qa-520.pdf');

let app = null;
let win = null;
let consoleErrors = [];
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
  await buildPdf(BIG_FIXTURE, 520);
});

test.beforeEach(async () => {
  consoleErrors = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().split('\n')[0]);
  });
  win.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r04-qa');
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

async function activePaneInput() {
  const tabId = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
  return win.locator(`[data-pane-tab="${tabId}"] input.page-input[aria-label="Current page"]`);
}

test('QA-D: verbatim dev-spec flow; screenshot the crashed shell when it happens', async () => {
  await openFixture(BIG_FIXTURE);
  const tabId = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
  const pane = win.locator(`[data-pane-tab="${tabId}"]`);
  console.log(`[QA-D] pageCount=${(await pane.evaluate(() => window.tflexDiagnostics())).pageCount}`);
  await pane.locator('.thumb-item[data-page="2"] [data-thumb-checkbox]').check();
  await expect(pane.locator('[data-context-panel-selection-count]')).toContainText('1 selected');
  const input = pane.locator('input.page-input[aria-label="Current page"]');
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill('260');
  await input.press('Enter');
  try {
    await expect(input).toHaveValue('260', { timeout: 20000 });
    await win.waitForFunction(
      (p) => window.tflexDiagnostics().currentPage === p,
      260,
      { timeout: 20000 },
    );
  } catch (err) {
    console.log(`[QA-D] post-jump assertion threw: ${err.message.split('\n')[0]}`);
  }
  await win.waitForTimeout(2500);
  const count = await input.count();
  const errors = consoleErrors.length;
  console.log(`[QA-D] paneAfterJump=${count} consoleErrors=${errors}`);
  if (count === 0 || errors > 0) {
    await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r04_qa_crash.png') });
    console.log('[QA-D] CRASH captured -> screenshots/tfl1116_r04_qa_crash.png');
  } else {
    await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r04_qa_ok.png') });
    console.log('[QA-D] no crash this run');
  }
  console.log(`[QA-D] errors=${JSON.stringify(consoleErrors.slice(0, 2))}`);
});

test('QA-E: same committed-jump flow on a 40-page doc (size dependence)', async () => {
  const SMALL = path.join(TMP, 'tfl1116-r04-qa-40.pdf');
  await buildPdf(SMALL, 40);
  await openFixture(SMALL);
  const tabId = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
  const pane = win.locator(`[data-pane-tab="${tabId}"]`);
  const input = pane.locator('input.page-input[aria-label="Current page"]');
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill('30');
  await input.press('Enter');
  await win.waitForTimeout(4000);
  const count = await input.count();
  console.log(`[QA-E] paneAfterJump=${count} consoleErrors=${consoleErrors.length}`);
  console.log(`[QA-E] errors=${JSON.stringify(consoleErrors.slice(0, 2))}`);
  expect(count, '40-page pane survives the committed jump').toBe(1);
});

test('QA-A: opening the 520-page fixture and idling does not crash the pane', async () => {
  await openFixture(BIG_FIXTURE);
  const input = await activePaneInput();
  await win.waitForTimeout(3000);
  await expect(input).toHaveCount(1);
  const count = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[QA-A] pageCount=${count} consoleErrors=${consoleErrors.length}`);
  console.log(`[QA-A] errors=${JSON.stringify(consoleErrors.slice(0, 3))}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r04_qa_idle520.png') });
  expect(consoleErrors, 'no renderer console errors on idle open').toHaveLength(0);
});

test('QA-B: committed 1 -> 260 jump (no selection) survives', async () => {
  await openFixture(BIG_FIXTURE);
  const input = await activePaneInput();
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill('260');
  await input.press('Enter');
  await win.waitForTimeout(5000);
  const count = await input.count();
  console.log(`[QA-B] pane input count after jump=${count}`);
  console.log(`[QA-B] pageCount=${await win.evaluate(() => { try { return window.tflexDiagnostics().pageCount; } catch (e) { return 'ERR:' + e.message; } })}`);
  console.log(`[QA-B] errors=${JSON.stringify(consoleErrors.slice(0, 3))}`);
  expect(count, 'pane survives the committed jump').toBe(1);
});

test('QA-C: page-2 selection THEN committed 1 -> 260 jump (dev spec order)', async () => {
  await openFixture(BIG_FIXTURE);
  const tabId = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
  const pane = win.locator(`[data-pane-tab="${tabId}"]`);
  const input = pane.locator('input.page-input[aria-label="Current page"]');
  await pane.locator('.thumb-item[data-page="2"] [data-thumb-checkbox]').check();
  await expect(pane.locator('[data-context-panel-selection-count]')).toContainText('1 selected');
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill('260');
  await input.press('Enter');
  await expect(input).toHaveValue('260', { timeout: 20000 });
  await win.waitForFunction(
    (p) => window.tflexDiagnostics().currentPage === p,
    260,
    { timeout: 20000 },
  );
  await win.waitForTimeout(2500);
  const count = await input.count();
  console.log(`[QA-C] pane input count after jump=${count}`);
  console.log(`[QA-C] errors=${JSON.stringify(consoleErrors.slice(0, 3))}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r04_qa_c.png') });
  expect(count, 'pane survives the selection + committed jump').toBe(1);
});
