// QA probe — does a saved ink annotation survive as a real PDF annotation
// object AND reload into TFlex on reopen? Also dumps the annotations panel
// DOM so the correct list selector can be pinned.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');
const { launchDev, openSample, diag, shot, scrollToPage , hardClose } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(240000);

test('PROBE: annotation persistence (save/reopen) + panel DOM', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const slot = win.locator('.page-slot[data-page="1"]').first();
  await slot.waitFor({ timeout: 10000 });
  const box = await slot.boundingBox();

  // Arm ink, draw a stroke.
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 250, box.y + 250);
  await win.mouse.down();
  await win.mouse.move(box.x + 380, box.y + 330, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(800);
  const before = await diag(win);
  console.log(`[PROBE] engine annotations before save: ${JSON.stringify(before.engineState.annotations)}`);

  // Save As to a known path.
  const outPath = path.join(os.tmpdir(), `tflex-probe-annot-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  console.log(`[PROBE] saved to ${outPath}`);

  // Parse the saved PDF: count Annots across pages.
  const pdf = await PDFDocument.load(fs.readFileSync(outPath));
  const annotInfo = [];
  for (let p = 0; p < pdf.getPageCount(); p++) {
    const page = pdf.getPage(p);
    const annots = page.node.get('Annots');
    annotInfo.push(annots ? annots.length : 0);
  }
  console.log(`[PROBE] saved pageCount=${pdf.getPageCount()} annotCountsPerPage=${JSON.stringify(annotInfo)}`);

  // Reopen in TFlex.
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);
  await scrollToPage(win, 1);
  const after = await diag(win);
  console.log(`[PROBE] engine annotations after reopen: ${JSON.stringify(after.engineState.annotations)}`);
  const visibleInk = await win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="1"]');
    let n = 0;
    if (s) s.querySelectorAll('.ann-ink').forEach((e) => { if (!e.classList.contains('ann-preview')) n += 1; });
    return n;
  });
  console.log(`[PROBE] visible .ann-ink on page 1 after reopen = ${visibleInk}`);
  await shot('probe-annot-after-reopen.png');

  // Dump annotations panel DOM.
  const annTab = win.locator('button[aria-label="Annotations"], .rail-tab:has-text("Annotations")').first();
  console.log(`[PROBE] annotations tab count=${await annTab.count()}`);
  if (await annTab.count()) {
    await annTab.click();
    await win.waitForTimeout(800);
  }
  const panelHTML = await win.evaluate(() => {
    const rail = document.querySelector('.side-rail, .annotation-rail, [data-annotation-panel]');
    if (rail) return rail.outerHTML.slice(0, 3000);
    // fallback: whatever has annotation items
    const list = document.querySelector('[data-annotation-list], .annotation-list, .annotations-list');
    return list ? list.outerHTML.slice(0, 3000) : 'NO PANEL';
  });
  console.log(`[PROBE] panel HTML (truncated):\n${panelHTML}`);
  await shot('probe-annotations-panel.png');
});
