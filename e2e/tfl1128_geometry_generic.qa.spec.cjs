// TFL-1128 (qa) - generic check: is Inspector "Size" lost after a tab
// away/back round trip even on small documents (no 520-page crash path)? Used
// to decide whether the missing geometry seen in the DEF-619 blast-radius
// probe is pre-existing/generic or specific to the R04 fix.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const TMP = path.join(os.tmpdir(), 'tfl1128-geometry');
const A = path.join(TMP, 'tfl1128-a-3.pdf');
const B = path.join(TMP, 'tfl1128-b-5.pdf');

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
  if (app) await hardClose(app, 'tfl1128-geometry-generic');
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

// TFL-1130 (was DEF-620) - fixed: single mode keys the live page-size map by
// the ACTIVE TAB id, so a tab away/back round trip restores the re-activated
// tab's own geometry. Un-fixme'd to run as a real guard.
test('generic: Inspector Size after a small-doc tab away/back round trip', async () => {
  await openFixture(A);
  const aTab = await activeTabId();
  await win.waitForTimeout(1500);
  const sizeA = (await win.locator('[data-inspector-row="size"]').innerText()).trim();
  console.log(`[TFL-1128-generic] A size on open = "${sizeA}"`);

  await openFixture(B);
  await win.waitForFunction(
    () => document.querySelectorAll('[data-tab-id]').length >= 2,
    null,
    { timeout: 15000 },
  );
  const bTab = await activeTabId();
  console.log(`[TFL-1128-generic] aTab=${aTab} bTab=${bTab}`);
  await win.waitForTimeout(1500);
  const sizeB = (await win.locator('[data-inspector-row="size"]').innerText()).trim();
  console.log(`[TFL-1128-generic] B size on open = "${sizeB}"`);

  await win.locator(`[data-tab-id="${aTab}"]`).first().click();
  await win.waitForFunction(
    (id) => {
      const el = document.querySelector('[data-tab-id][aria-selected="true"]');
      return el !== null && el.getAttribute('data-tab-id') === id;
    },
    aTab,
    { timeout: 20000 },
  );
  await win.waitForTimeout(3000);
  const sizeReturn = (await win.locator('[data-inspector-row="size"]').innerText()).trim();
  console.log(`[TFL-1128-generic] A size after tab return = "${sizeReturn}"`);
  expect(sizeReturn, 'Inspector Size returns to the re-activated tab').toContain('612 x 792 pt');
});
