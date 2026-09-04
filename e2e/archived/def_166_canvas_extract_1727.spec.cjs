// DEF-166 diag 2 (v1.7.27): open the saved round-trip file in TFlex, extract
// the page CANVAS pixels for the textbox/callout regions to PNGs, and diff the
// canvas against a pure pdf.js render of the SAME file at the same scale.
// Purpose: prove whether TFlex's canvas carries the annotation text TWICE
// (its own bake + pdf.js's generated appearance) while pure pdf.js has it once.
const { test } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const SAVE = path.resolve(__dirname, '..', '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

test('diag2: extract TFlex canvas regions of the reopened annotations', async () => {
  const electronApp = await launchApp([]);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, SAVE);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
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
  await win.waitForTimeout(1500);

  const out = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return { noSlot: true };
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { noCanvas: true };
    const scale = canvas.width / pr.width;
    const grab = (reg) => {
      const x0 = Math.max(0, Math.floor(reg.x * scale)), y0 = Math.max(0, Math.floor(reg.y * scale));
      const w = Math.ceil(reg.w * scale), h = Math.ceil(reg.h * scale);
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
      return { url: tmp.toDataURL('image/png'), scale: +scale.toFixed(4), w, h };
    };
    return {
      scale: +scale.toFixed(4),
      tb: grab({ x: 208.1, y: 359, w: 183.9, h: 49.5 }),
      co: grab({ x: 815.8, y: 618.6, w: 170, h: 49.5 }),
      canvasCount: slot.querySelectorAll('canvas').length,
    };
  });
  const write = (name, b64) => fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64.split(',')[1], 'base64'));
  write('def-166-1727-tflex-canvas-textbox.png', out.tb.url);
  write('def-166-1727-tflex-canvas-callout.png', out.co.url);
  process.stdout.write(`[DIAG2] scale=${out.scale} canvasCount=${out.canvasCount} tb=${out.tb.w}x${out.tb.h} co=${out.co.w}x${out.co.h}\n`);
  await hardClose(electronApp);
});
