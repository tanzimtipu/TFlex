// Diagnostic: open the SAVED callout file, page 4, and scan the PAGE CANVAS
// for annotation-blue pixels (rgb(37,99,235) = #2563eb). The app's DOM
// overlay never paints into the canvas, so any blue pixels there come from
// the baked FreeText appearance pdf.js renders at the baked /Rect.
// Reports the page-local y bands of blue pixels - expected: ~788-838px
// (the flipped /Rect) if the save bakes top-down y into bottom-up space.
const { test } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAVE = 'C:\\Users\\tanzi\\AppData\\Local\\Temp\\tflex-def161-callout-1788479046572.pdf';

test.setTimeout(240000);

test('diag: canvas scan for baked blue annotation render', async () => {
  const electronApp = await launchApp([]);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await electronApp.evaluate(({ dialog }, p) => {
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

  const scan = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    const pageEl = slot && (slot.querySelector('.pdf-page') || slot);
    const pr = pageEl.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    const cx = canvas.getContext('2d');
    const img = cx.getImageData(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / pr.width;
    const rows = new Map();
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const i = (y * img.width + x) * 4;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - 37) < 45 && Math.abs(g - 99) < 45 && Math.abs(b - 235) < 45) {
          const py = Math.round(y / scale);
          rows.set(py, (rows.get(py) || 0) + 1);
        }
      }
    }
    // cluster adjacent rows into bands
    const bands = [];
    let cur = null;
    const sorted = [...rows.keys()].sort((a, b) => a - b);
    for (const y of sorted) {
      const n = rows.get(y);
      if (cur && y - cur.y2 <= 3) { cur.y2 = y; cur.n += n; }
      else { cur = { y1: y, y2: y, n }; bands.push(cur); }
    }
    const overlay = document.querySelector('.page-slot[data-page="4"] div.ann-callout[data-kind="callout"]');
    const or = overlay ? overlay.getBoundingClientRect() : null;
    return {
      bands: bands.filter((b) => b.n > 50).map((b) => ({ yTop: b.y, yBot: b.y2, px: b.n })),
      overlayBoxPageLocal: or ? { x: +(or.x - pr.x).toFixed(1), y: +(or.y - pr.y).toFixed(1), w: +or.width.toFixed(1), h: +or.height.toFixed(1) } : null,
      canvasScale: +scale.toFixed(3),
    };
  });
  process.stdout.write(`\n[DIAG-CANVAS] ${JSON.stringify(scan)}\n`);
  await win.screenshot({ path: path.join(SHOTS, 'def-161-1725-canvas-scan.png') });
  await hardClose(electronApp);
});