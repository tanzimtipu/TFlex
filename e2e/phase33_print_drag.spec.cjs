// Phase 33 e2e (spec 2 of 4) — MIGRATED for Phase 37 item 17.
//
// The in-app print modal (and its HTML drag) was REMOVED. The print surface is
// now the STANDALONE print window, a real top-level OS window. This spec
// verifies the observable equivalent of "the print dialog is movable":
//   - it is a separate top-level window that can be moved outside the app;
//   - moving it does not reflow/clip its content (frame-sampled: constant
//     width/height, no blank frames);
//   - a control still works after a move (pages-per-sheet updates the preview);
//   - a second Print request focuses the SAME window (never a duplicate).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose,
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('./lib/helpers.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p37-p33-drag');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function printWindowBounds() {
  return app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return pw ? { ...pw.getBounds(), id: pw.id } : null;
  });
}

test('C1 standalone print window: separate top-level, movable, no layout shift, controls after move, single instance', async () => {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);

  const printPage = await openStandalonePrintWindow(app, win);
  const mainBounds = await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    return main.getBounds();
  });
  const r0 = await printWindowBounds();
  console.log(`[P37-P33-drag] main=${JSON.stringify(mainBounds)} print=${JSON.stringify(r0)}`);
  expect(r0, 'the standalone print window exists').not.toBeNull();
  expect(r0.width).toBeGreaterThan(200);
  expect(r0.height).toBeGreaterThan(200);

  // --- move it fully OUTSIDE the app window: a top-level window. ---
  await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    const mb = main.getBounds();
    pw.setBounds({ x: mb.x + mb.width + 200, y: mb.y + 120, width: 820, height: 860 });
  });
  await win.waitForTimeout(500);
  const r1 = await printWindowBounds();
  console.log(`[P37-P33-drag] moved print=${JSON.stringify(r1)}`);
  expect(r1.x, 'the print window moved fully outside the app window').toBeGreaterThan(
    mainBounds.x + mainBounds.width,
  );

  // --- frame-sample during a move: no blank frame / layout shift. ---
  const sampler = printPage.evaluate(
    async ({ duration, interval }) => {
      const samples = [];
      const tick = () => {
        const el = document.querySelector('[data-print-window]');
        const r = el ? el.getBoundingClientRect() : null;
        samples.push({ present: !!el, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 });
      };
      tick();
      const id = setInterval(tick, interval);
      await new Promise((r) => setTimeout(r, duration));
      clearInterval(id);
      tick();
      return samples;
    },
    { duration: 1400, interval: 16 },
  );
  await printPage.waitForTimeout(80);
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    pw.setBounds({ x: 60, y: 80, width: 820, height: 860 });
  });
  const samples = await sampler;
  const missing = samples.filter((s) => !s.present || s.w <= 0 || s.h <= 0);
  const widths = new Set(samples.map((s) => s.w));
  const heights = new Set(samples.map((s) => s.h));
  console.log(`[P37-P33-drag] frame samples=${samples.length} blank=${missing.length} distinctW=${widths.size} distinctH=${heights.size}`);
  expect(samples.length, 'sampled frames during the move').toBeGreaterThan(30);
  expect(missing.length, 'no blank/missing print-window frames').toBe(0);
  expect(widths.size, 'the print panel width did not change during the move').toBe(1);
  expect(heights.size, 'the print panel height did not change during the move').toBe(1);

  // --- a control still works after the move. ---
  await printPage.selectOption('[data-print-nup]', '2');
  await printPage.waitForTimeout(500);
  const cellCount = await printPage.locator('[data-print-preview-sheet] .print-preview-cell').count();
  const gridCols = await printPage.evaluate(() => {
    const s = document.querySelector('[data-print-preview-sheet]');
    return getComputedStyle(s).gridTemplateColumns;
  });
  const trackCount = gridCols.trim().split(/\s+/).filter(Boolean).length;
  console.log(`[P37-P33-drag] after move, nup=2 -> cells=${cellCount} cols="${gridCols}"`);
  expect(cellCount, 'preview updated to 2 cells after the move').toBe(2);
  expect(trackCount, 'preview grid is 2 columns after the move').toBe(2);

  // --- a second Print request focuses the SAME window (no duplicate). ---
  const beforeId = r1.id;
  await win.click('[data-print]');
  await win.waitForTimeout(900);
  const after = await printWindowBounds();
  const count = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length);
  console.log(`[P37-P33-drag] after second Print: id ${beforeId} -> ${after.id} windows=${count}`);
  expect(count, 'still exactly ONE print window').toBe(1);
  expect(after.id, 'the same print window is reused (focused, not recreated)').toBe(beforeId);

  await closeStandalonePrintWindow(app, printPage);
});
