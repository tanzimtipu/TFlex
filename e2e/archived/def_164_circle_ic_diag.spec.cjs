// Diag: does the Circle (ellipse) bake the same solid /IC as the Square?
// Commit an ellipse, Save As, dump the raw annot dict.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { PDFDocument, PDFName, PDFArray } = require('pdf-lib');

test.setTimeout(300000);

test('diag: circle /IC bake', async () => {
  const electronApp = await launchApp([]);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  const sample = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, sample);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false };
    }, 4);
    await win.waitForTimeout(300);
    if (st.done) break;
  }
  await win.waitForTimeout(900);
  const pr = await win.evaluate(() => {
    const el = document.querySelector('.page-slot[data-page="4"] .pdf-page')
      || document.querySelector('.page-slot[data-page="4"]');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await win.click('[data-annotation-toolbar] [data-tool="ellipse"]');
  await win.waitForTimeout(350);
  const x0 = pr.x + pr.w * 0.34, y0 = pr.y + pr.h * 0.52;
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(x0 + (110 * i) / 8, y0 + (60 * i) / 8);
    await win.waitForTimeout(16);
  }
  await win.mouse.up();
  await win.waitForTimeout(700);
  const dom = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    for (const el of slot.querySelectorAll('ellipse[data-kind="ellipse"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 3) continue;
      const cs = getComputedStyle(el);
      return { fill: cs.fill, stroke: cs.stroke };
    }
    return null;
  });
  process.stdout.write(`[ELLIPSE-DOM] ${JSON.stringify(dom)}\n`);
  const savePath = path.join(os.tmpdir(), `tflex-def164-circle-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 24 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  const doc = await PDFDocument.load(fs.readFileSync(savePath), { ignoreEncryption: true });
  const ctx = doc.context;
  const page = doc.getPages()[3];
  const annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
  for (let i = 0; i < annots.size(); i++) {
    const a = ctx.lookup(annots.get(i));
    const st = a.get(PDFName.of('Subtype')).asString();
    const ic = a.get(PDFName.of('IC'));
    const icArr = ic instanceof PDFArray ? Array.from({ length: ic.size() }, (_, k) => ic.get(k).asNumber()) : null;
    process.stdout.write(`[Bake] ${st} /IC=${JSON.stringify(icArr)}\n`);
  }
  await hardClose(electronApp);
});