const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([]);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('B3 rigorous: does a custom-color rect annotation survive save/reopen?', async () => {
  test.setTimeout(120000);
  // Open report.pdf from a temp copy so the source is known
  const sourcePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, sourcePath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.pdf-page', { timeout: 15000 });
  await window.waitForTimeout(1500);

  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // arm rect + custom color #00ff00
  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.waitForTimeout(200);
  await window.click('.ann-color-swatch-main');
  await window.waitForSelector('.color-popover', { timeout: 5000 });
  await window.fill('input[aria-label="Custom color hex"]', '#00ff00');
  await window.press('input[aria-label="Custom color hex"]', 'Enter');
  await window.waitForTimeout(300);
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // drag rect
  await window.mouse.move(pbox.x + 300, pbox.y + 500);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 650, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(700);

  const before = await window.evaluate(() => ({
    modified: window.tflexDiagnostics().modified,
    annCount: document.querySelectorAll('.ann[data-kind="rect"]').length,
    engineAnns: window.tflexDiagnostics().engineState?.annotations,
  }));
  console.log('B3 before save: modified=', before.modified, 'annCount=', before.annCount, 'engineAnns=', JSON.stringify(before.engineAnns));

  // Save As
  const savePath = path.join(os.tmpdir(), `b3-rig-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await window.click('[aria-label="Save As"]');
  await window.click('[data-save-as-confirm="true"]');
  await window.waitForTimeout(2500);
  console.log('B3 modified after save click:', await window.evaluate(() => window.tflexDiagnostics().modified));
  const fileExists = fs.existsSync(savePath);
  const fileSize = fileExists ? fs.statSync(savePath).size : 0;
  console.log('B3 saved file:', savePath, 'exists=', fileExists, 'size=', fileSize);

  // Parse the saved file with pdf-lib
  let pdfInfo = null;
  if (fileExists) {
    const { PDFDocument } = require('pdf-lib');
    const bytes = fs.readFileSync(savePath);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    const anns = pages[0].node ? (pages[0].node.get('Annots') || []) : [];
    const annArr = Array.isArray(anns) ? anns : ([anns] || []);
    const annRaw = annArr.map(a => a.toString().slice(0, 80));
    pdfInfo = { pageCount: pages.length, annotationCount: annArr.length, annRaw };
  }
  console.log('B3 saved pdf-lib info:', JSON.stringify(pdfInfo));

  // Reopen the saved file
  await window.locator('.tab-active .tab-close').click();
  await window.waitForTimeout(1500);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.pdf-page', { timeout: 15000 });
  await window.waitForTimeout(1800);

  const after = await window.evaluate(() => ({
    annCount: document.querySelectorAll('.ann[data-kind="rect"]').length,
    engineAnns: window.tflexDiagnostics().engineState?.annotations,
  }));
  console.log('B3 after reopen: annCount=', after.annCount, 'engineAnns=', JSON.stringify(after.engineAnns));
  await window.screenshot({ path: 'screenshots/b3-rig-after-reopen.png' });
  // canvas pixel sample: look for any green-ish pixel on the page canvas
  const greenPixels = await window.evaluate(() => {
    const canvas = document.querySelector('.pdf-page canvas');
    if (!canvas) return { present: false };
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      let green = 0;
      const step = 8;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (g > 150 && r < 100 && b < 100) green++;
        }
      }
      return { present: true, w, h, greenSamples: green };
    } catch (e) { return { present: true, err: String(e) }; }
  });
  console.log('B3 green pixel sample after reopen:', JSON.stringify(greenPixels));
});
