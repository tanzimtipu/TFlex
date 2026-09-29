// Phase 57 feature G focused e2e (QA). Proves that a SAVED document's catalog
// /Dests and /OpenAction page references resolve to the OUTPUT page object
// (remapped through the serializer's page map), not a cloned source-context
// ref. Launches ONLY through the canonical launchApp helper. One test, one
// screenshot. The native open/save dialogs are stubbed in the main process
// (standard repo pattern) and the app's real Open / Save As controls are used.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFArray, PDFDict } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test.setTimeout(180000);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(500);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p57g');
  app = null;
  win = null;
});

test('feature G: saved /Dests and /OpenAction page refs resolve to the OUTPUT page object', async () => {
  // 1. Build the fixture: 3 pages, then a catalog /Dests entry and an
  //    /OpenAction GoTo both pointing at page 3 (index 2).
  const srcPath = path.join(os.tmpdir(), `tflex-p57g-src-${Date.now()}.pdf`);
  const srcDoc = await PDFDocument.create();
  srcDoc.addPage([200, 200]);
  srcDoc.addPage([200, 200]);
  const page3 = srcDoc.addPage([200, 200]);
  srcDoc.catalog.set(
    PDFName.of('Dests'),
    srcDoc.context.obj({ chapter3: srcDoc.context.obj([page3.ref, 'Fit']) }),
  );
  srcDoc.catalog.set(
    PDFName.of('OpenAction'),
    srcDoc.context.obj({ S: 'GoTo', D: srcDoc.context.obj([page3.ref, 'Fit']) }),
  );
  fs.writeFileSync(srcPath, await srcDoc.save());
  const srcPage3Ref = page3.ref.toString();

  // 2. Open the fixture through the real Open button (native dialog stubbed).
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, srcPath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // 3. Save As to a fresh path (native save dialog stubbed).
  const savePath = path.join(os.tmpdir(), `tflex-p57g-out-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');

  // Wait until the saved file exists and is non-zero.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (fs.existsSync(savePath) && fs.statSync(savePath).size > 0) break;
    await win.waitForTimeout(200);
  }
  expect(fs.existsSync(savePath)).toBe(true);
  expect(fs.statSync(savePath).size).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(SHOTS, 'p57g-dest-remap.png') });

  // 4. Re-parse the SAVED file and assert the remap.
  const savedDoc = await PDFDocument.load(fs.readFileSync(savePath));
  const savedPage3Ref = savedDoc.getPage(2).ref.toString();
  console.log(`[P57G] srcPage3Ref=${srcPage3Ref} savedPage3Ref=${savedPage3Ref}`);

  expect(savedDoc.getPageCount()).toBe(3);

  const destsRaw = savedDoc.catalog.get(PDFName.of('Dests'));
  expect(destsRaw).toBeDefined();
  const dests = savedDoc.context.lookupMaybe(destsRaw, PDFDict);
  expect(dests).toBeDefined();
  const chapter3 = savedDoc.context.lookupMaybe(dests.get(PDFName.of('chapter3')), PDFArray);
  expect(chapter3).toBeDefined();
  expect(chapter3.get(0).toString()).toBe(savedPage3Ref);

  const oaRaw = savedDoc.catalog.get(PDFName.of('OpenAction'));
  expect(oaRaw).toBeDefined();
  const oa = savedDoc.context.lookupMaybe(oaRaw, PDFDict);
  expect(oa).toBeDefined();
  expect(oa.get(PDFName.of('S')).toString()).toBe('/GoTo');
  const oaD = savedDoc.context.lookupMaybe(oa.get(PDFName.of('D')), PDFArray);
  expect(oaD).toBeDefined();
  expect(oaD.get(0).toString()).toBe(savedPage3Ref);
});
