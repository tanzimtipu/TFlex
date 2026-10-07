// TFL-1128 (qa) - DEF-619 blast-radius probe for page-size reporting.
//
// The R04 fix coalesces DocumentView's page-size report to one rAF. The
// blast-radius question is whether that delay ever leaves the Inspector (or
// thumb aspect) with MISSING or STALE geometry. This probe verifies the
// Inspector "Size" row is populated on a normally opened document and that it
// survives a tab away/back round trip (the exact moment the refreshed
// screenshots/tfl1116_r04_tab_return.png showed "Not available").
//
// The dev spec and the QA crash probe are left untouched. Every launch goes
// through launchApp.
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
const TMP = path.join(os.tmpdir(), 'tfl1128-geometry');
const BIG = path.join(TMP, 'tfl1128-big-520.pdf');
const SMALL = path.join(TMP, 'tfl1128-small-3.pdf');

let app = null;
let win = null;
test.setTimeout(180000);

async function buildPdf(file, count) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) doc.addPage([612, 792]);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  await buildPdf(BIG, 520);
  await buildPdf(SMALL, 3);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1128-geometry');
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

function inspectorSize() {
  return win.locator('[data-inspector-row="size"]');
}

async function activeTabId() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
}

// TFL-1130 (was DEF-620) - fixed: single mode keys the live page-size map by
// the ACTIVE TAB id, so returning to the big tab at page 260 reads that tab's
// own map instead of the small tab's shared one. Un-fixme'd to run as a guard.
test('Inspector Size is populated on open and survives a tab away/back round trip', async () => {
  await openFixture(BIG);
  const bigTabId = await activeTabId();
  const input = win.locator('input.page-input[aria-label="Current page"]');
  await input.click({ timeout: 20000 });
  await input.fill('');
  await input.fill('260');
  await input.press('Enter');
  await expect(input).toHaveValue('260', { timeout: 20000 });
  await win.waitForTimeout(2500);

  const beforeSwitch = (await inspectorSize().innerText()).trim();
  console.log(`[TFL-1128] inspector size after jump 260 = "${beforeSwitch}"`);
  expect(beforeSwitch, 'Inspector Size populated after committed jump').toContain('612 x 792 pt');

  await openFixture(SMALL);
  await win.waitForFunction(
    () => document.querySelectorAll('[data-tab-id]').length >= 2,
    null,
    { timeout: 15000 },
  );
  const smallTabId = await activeTabId();
  expect(smallTabId).not.toBe(bigTabId);

  await win.locator(`[data-tab-id="${bigTabId}"]`).first().click();
  await win.waitForFunction(
    (id) => {
      const el = document.querySelector('[data-tab-id][aria-selected="true"]');
      return el !== null && el.getAttribute('data-tab-id') === id;
    },
    bigTabId,
    { timeout: 20000 },
  );

  await win.waitForTimeout(3000);
  const afterReturn = (await inspectorSize().innerText()).trim();
  console.log(`[TFL-1128] inspector size after tab return = "${afterReturn}"`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1128_geometry_tab_return.png') });
  expect(afterReturn, 'Inspector Size populated after tab return').toContain('612 x 792 pt');
});
