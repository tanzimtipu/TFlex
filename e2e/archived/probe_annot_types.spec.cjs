// Confirm which annotation types survive save-as. Ink + note (has content).

const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName } = require('pdf-lib');
const { launchDev, openSample, diag , hardClose } = require('./lib/helpers.cjs');

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
  const outPath = path.join(os.tmpdir(), `tflex-probe3-${Date.now()}-${name}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  return outPath;
}

async function scanAnnots(filePath) {
  const pdf = await PDFDocument.load(fs.readFileSync(filePath));
  const annots = [];
  pdf.context.enumerateIndirectObjects().forEach(({ object }) => {
    if (!object || typeof object.get !== 'function') return;
    const type = object.get(PDFName.of('Type'));
    const sub = object.get(PDFName.of('Subtype'));
    if (type && type.asString && type.asString() === 'Annot') {
      const contents = object.get(PDFName.of('Contents'));
      const rect = object.get(PDFName.of('Rect'));
      annots.push({
        subtype: sub && sub.asString ? sub.asString() : null,
        contents: contents && contents.asString ? contents.asString() : null,
        rect: rect && rect.asArray ? rect.asArray().map((x) => x.asNumber()) : null,
      });
    }
  });
  // Also per-page /Annots array size (PDFArray exposes .size).
  const perPage = [];
  for (let p = 0; p < pdf.getPageCount(); p++) {
    const leaf = pdf.getPage(p).node;
    const an = leaf.get(PDFName.of('Annots'));
    let n = 0;
    if (an) {
      const resolved = pdf.context.lookup(an) || an;
      n = resolved && typeof resolved.size === 'number' ? resolved.size : 0;
    }
    perPage.push(n);
  }
  return { annots, perPage };
}

test('PROBE-3: ink AND note annotation persistence through save-as', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const slot = win.locator('.page-slot[data-page="1"]').first();
  await slot.waitFor({ timeout: 10000 });
  const box = await slot.boundingBox();

  // Ink.
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 250, box.y + 250);
  await win.mouse.down();
  await win.mouse.move(box.x + 380, box.y + 330, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(700);

  // Note with content.
  await win.locator('.ann-toolbar button[data-tool="note"]').click();
  await win.waitForTimeout(300);
  await win.mouse.click(box.x + 300, box.y + 420);
  await win.waitForSelector('[data-annotation-editor="note"] textarea, [data-annotation-editor] textarea', { timeout: 6000 }).catch(() => {});
  const noteEditor = win.locator('[data-annotation-editor="note"] textarea, [data-annotation-editor] textarea').first();
  if (await noteEditor.count()) {
    await noteEditor.fill('ROUND TRIP NOTE 42');
    const nc = win.locator('[data-annotation-action="note-confirm"]').first();
    if (await nc.count()) await nc.click({ force: true });
    else await win.keyboard.press('Control+Enter').catch(() => {});
    await win.waitForTimeout(600);
  }

  const d = await diag(win);
  console.log(`[PROBE3] annotations before save = ${JSON.stringify(d.engineState.annotations.map((a) => ({ kind: a.kind, content: a.content })))}`);

  const outPath = await saveAsTo('inknote');
  const { annots, perPage } = await scanAnnots(outPath);
  console.log(`[PROBE3] saved size=${fs.statSync(outPath).size} annotObjects=${JSON.stringify(annots)} perPageAnnots=${JSON.stringify(perPage)}`);

  // Reopen and check engine state.
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2200);
  const d2 = await diag(win);
  console.log(`[PROBE3] annotations after reopen = ${JSON.stringify(d2.engineState.annotations.map((a) => ({ kind: a.kind, content: a.content })))}`);
});
