// DEF-391 (Phase 54) — `imageImportDefaults` was validated and stored but never
// applied on the import path: every Phase 54 unit test injected the options
// directly, so the missing settings-to-options wiring was invisible. This spec
// drives the REAL Open button (which calls `convert.toDocument(docId, path)`
// with no options) and proves the stored settings now change the produced page
// box. Launches ONLY through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const IMG = path.resolve(__dirname, '..', 'test-fixtures', 'phase54', 'dpi-72.png');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def391');
  app = null;
  win = null;
});

test.setTimeout(300000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function saveImageDefaults(patch) {
  return win.evaluate(async (p) => {
    const cur = await window.tflex.loadSettings();
    const s = cur && cur.ok ? cur.value : {};
    s.imageImportDefaults = p;
    await window.tflex.saveSettings(s);
    return true;
  }, patch);
}

async function importImage() {
  await stubOpen(IMG);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 90000 });
  const d = await win.evaluate(() => window.tflexDiagnostics());
  const b64 = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.getDocumentBytes(id);
    if (!r.ok) return null;
    const bytes = new Uint8Array(r.value);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, d.engineDocId);
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(Buffer.from(b64, 'base64'));
  const b = doc.getPage(0).getMediaBox();
  const closers = win.locator('[data-tab-id] .tab-close');
  if ((await closers.count()) > 0) {
    await closers.last().click();
    await win.waitForTimeout(400);
  }
  return { width: b.width, height: b.height, pageCount: d.pageCount };
}

test('DEF-391: imageImportDefaults.pageSizeMode and rotationDeg change the imported page box', async () => {
  await saveImageDefaults({ pageSizeMode: 'image', fixedPageSize: 'a4', fit: 'contain', rotationDeg: 0 });
  const imageMode = await importImage();
  await saveImageDefaults({ pageSizeMode: 'fixed', fixedPageSize: 'a4', fit: 'contain', rotationDeg: 0 });
  const fixedMode = await importImage();
  await saveImageDefaults({ pageSizeMode: 'image', fixedPageSize: 'a4', fit: 'contain', rotationDeg: 90 });
  const rotated = await importImage();
  console.log('DEF391 ' + JSON.stringify({ imageMode, fixedMode, rotated }));

  // pageSizeMode 'fixed' must produce an A4 portrait page.
  expect(fixedMode.width, 'fixed pageSizeMode did not produce an A4 width').toBeCloseTo(595, 0);
  expect(fixedMode.height, 'fixed pageSizeMode did not produce an A4 height').toBeCloseTo(842, 0);
  // pageSizeMode 'image' must differ from 'fixed' (the image's own physical size).
  expect(
    Math.abs(imageMode.width - fixedMode.width) > 1 || Math.abs(imageMode.height - fixedMode.height) > 1,
    'pageSizeMode had no observable effect on the page box',
  ).toBe(true);
  // rotationDeg 90 must transpose the image-mode page box.
  expect(rotated.width, 'rotationDeg 90 did not transpose the page width').toBeCloseTo(imageMode.height, 0);
  expect(rotated.height, 'rotationDeg 90 did not transpose the page height').toBeCloseTo(imageMode.width, 0);
});
