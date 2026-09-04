// Decisive probe: does engine state (rotation) survive save-as, while the drawn
// ink annotation does not? Isolates save-as behaviour from annotation serialization.

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');
const { launchDev, openSample, diag, scrollToPage , hardClose } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(180000);

async function saveAsTo(name) {
  const outPath = path.join(os.tmpdir(), `tflex-probe2-${Date.now()}-${name}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  return outPath;
}

test('PROBE-2: rotation survives save-as; ink annotation does not', async () => {
  await openSample(win, electronApp, 'report.pdf');

  // Rotate page 1 (definite engine mutation).
  await win.click('[data-toolbar-rotate-cw]');
  await win.waitForTimeout(1200);
  const d0 = await diag(win);
  console.log(`[PROBE2] after rotate rotations[0]=${d0.engineState.rotations[0]} modified=${d0.modified}`);

  const rotPath = await saveAsTo('rot');
  const rotPdf = await PDFDocument.load(fs.readFileSync(rotPath));
  const rotP1 = rotPdf.getPage(0);
  console.log(`[PROBE2] rotation-saved page1 /Rotate=${rotP1.getRotation().angle} size=${fs.statSync(rotPath).size}`);

  // Now draw an ink and save.
  const slot = win.locator('.page-slot[data-page="1"]').first();
  await slot.waitFor({ timeout: 10000 });
  const box = await slot.boundingBox();
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 250, box.y + 250);
  await win.mouse.down();
  await win.mouse.move(box.x + 380, box.y + 330, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(800);
  const d1 = await diag(win);
  console.log(`[PROBE2] annotations after ink = ${JSON.stringify(d1.engineState.annotations)} modified=${d1.modified}`);

  const inkPath = await saveAsTo('ink');
  const inkPdf = await PDFDocument.load(fs.readFileSync(inkPath));
  const { PDFName } = require('pdf-lib');
  // Enumerate every indirect object; find annotation-like dicts and page /Annots.
  const subtypes = [];
  const annotRects = [];
  inkPdf.context.enumerateIndirectObjects().forEach(({ ref, object }) => {
    if (!object || typeof object.get !== 'function') return;
    const sub = object.get(PDFName.of('Subtype'));
    if (sub && sub.asString && sub.asString() === 'Annot') {
      const kind = object.get(PDFName.of('Subtype'));
      const rect = object.get(PDFName.of('Rect'));
      let rectVals = null;
      if (rect && rect.asArray) rectVals = rect.asArray().map((x) => x.asNumber());
      annotRects.push({ ref: ref.toString(), rect: rectVals });
    }
  });
  console.log(`[PROBE2] ink-saved size=${fs.statSync(inkPath).size} totalAnnotObjs=${annotRects.length}`);
  console.log(`[PROBE2] annotObjects=${JSON.stringify(annotRects)}`);
  // Per-page /Annots array sizes via high-level refs.
  const perPage = [];
  for (let p = 0; p < inkPdf.getPageCount(); p++) {
    const leaf = inkPdf.getPage(p).node;
    const an = leaf.get(PDFName.of('Annots'));
    let len = 0;
    if (an) {
      const resolved = inkPdf.context.lookup(an) || an;
      len = (resolved && typeof resolved.length === 'number') ? resolved.length : 0;
    }
    perPage.push(len);
  }
  console.log(`[PROBE2] perPageAnnots=${JSON.stringify(perPage)}`);
});
