// Phase 33 e2e (spec 2 of 4) — criterion 1: the print dialog is movable.
//
// Drag [data-print-drag-handle] by a known delta and assert the panel moved by
// that delta; drag to each of the four extremes and assert the panel stays
// fully inside the window; assert a control still works after a move (change
// pages-per-sheet and see the preview update); assert reopening re-centres;
// and frame-sample (~16ms) during the drag for blank frames / layout shifts.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');
const { REPORT } = require('./lib/p33_common.cjs');
const P = require('./lib/p33_print.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p33-drag');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function shellRect() {
  const box = await win.locator('[data-print-dialog-shell]').boundingBox();
  if (box === null) throw new Error('print dialog shell not found');
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    width: box.width,
    height: box.height,
  };
}
async function viewport() {
  return win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}
async function dragHeaderTo(targetX, targetY) {
  const header = win.locator('[data-print-drag-handle]');
  const hb = await header.boundingBox();
  if (hb === null) throw new Error('print drag handle not found');
  const sx = hb.x + hb.width / 2;
  const sy = hb.y + hb.height / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(targetX, targetY, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(250);
}
async function dragHeaderBy(dx, dy) {
  const header = win.locator('[data-print-drag-handle]');
  const hb = await header.boundingBox();
  if (hb === null) throw new Error('print drag handle not found');
  const sx = hb.x + hb.width / 2;
  const sy = hb.y + hb.height / 2;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(250);
}

// In-page ~16ms frame sampler: the dialog shell's presence and rect.
async function sampleDrag(durationMs, intervalMs) {
  return win.evaluate(
    async ({ duration, interval }) => {
      const samples = [];
      const tick = () => {
        const el = document.querySelector('[data-print-dialog-shell]');
        const r = el ? el.getBoundingClientRect() : null;
        samples.push({
          t: Math.round(performance.now()),
          present: !!el,
          w: r ? Math.round(r.width) : 0,
          h: r ? Math.round(r.height) : 0,
          x: r ? Math.round(r.left) : 0,
          y: r ? Math.round(r.top) : 0,
        });
      };
      tick();
      const id = setInterval(tick, interval);
      await new Promise((r) => setTimeout(r, duration));
      clearInterval(id);
      tick();
      return samples;
    },
    { duration: durationMs, interval: intervalMs },
  );
}

test('C1 print dialog drag: known delta, four clamps, controls after move, re-centre, no blank frames', async () => {
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
  await P.openDialog(win);

  const vp = await viewport();
  const r0 = await shellRect();
  console.log(`[P33-drag] viewport=${JSON.stringify(vp)} initial shell=${JSON.stringify(r0)}`);
  expect(r0.left).toBeGreaterThanOrEqual(-1);
  expect(r0.top).toBeGreaterThanOrEqual(-1);
  expect(r0.right).toBeLessThanOrEqual(vp.w + 1);
  expect(r0.bottom).toBeLessThanOrEqual(vp.h + 1);

  // ---- known delta: move by (dx, dy) and assert the panel moved by it ----
  const roomRight = vp.w - r0.right;
  const roomDown = vp.h - r0.bottom;
  const dx = Math.max(12, Math.min(40, Math.floor(roomRight) - 6));
  const dy = Math.max(12, Math.min(30, Math.floor(roomDown) - 6));
  await dragHeaderBy(dx, dy);
  const r1 = await shellRect();
  console.log(`[P33-drag] known delta (${dx},${dy}): shell ${JSON.stringify(r0)} -> ${JSON.stringify(r1)}`);
  expect(Math.abs(r1.left - (r0.left + dx)), 'panel moved by dx').toBeLessThanOrEqual(2);
  expect(Math.abs(r1.top - (r0.top + dy)), 'panel moved by dy').toBeLessThanOrEqual(2);
  const dragX = await win.locator('[data-print-dialog-shell]').getAttribute('data-drag-x');
  const dragY = await win.locator('[data-print-dialog-shell]').getAttribute('data-drag-y');
  console.log(`[P33-drag] data-drag-x=${dragX} data-drag-y=${dragY}`);
  expect(Number(dragX)).toBeGreaterThan(0);
  expect(Number(dragY)).toBeGreaterThan(0);

  // ---- frame sampling during a drag: no blank frame / layout shift ------
  const sampler = sampleDrag(1400, 16);
  await win.waitForTimeout(80);
  await dragHeaderBy(-Math.min(60, dx + 20), -Math.min(40, dy + 10));
  const samples = await sampler;
  const missing = samples.filter((s) => !s.present || s.w <= 0 || s.h <= 0);
  const widths = new Set(samples.map((s) => s.w));
  const heights = new Set(samples.map((s) => s.h));
  const xs = new Set(samples.map((s) => s.x));
  console.log(
    `[P33-drag] frame samples=${samples.length} missing/blank=${missing.length} ` +
      `distinctW=${widths.size} distinctH=${heights.size} distinctX=${xs.size}`,
  );
  expect(samples.length, 'sampled frames during the drag').toBeGreaterThan(30);
  expect(missing.length, `blank/missing dialog frames: ${JSON.stringify(missing.slice(0, 3))}`).toBe(0);
  expect(widths.size, 'dialog width did not change during the drag (no layout shift)').toBe(1);
  expect(heights.size, 'dialog height did not change during the drag (no layout shift)').toBe(1);
  expect(xs.size, 'the dialog actually moved during the drag').toBeGreaterThan(1);

  // ---- four extremes: the panel stays fully inside the window -----------
  await dragHeaderTo(2, (await shellRect()).top + 10);
  let r = await shellRect();
  console.log(`[P33-drag] left extreme: ${JSON.stringify(r)}`);
  expect(r.left, 'left edge clamped inside').toBeGreaterThanOrEqual(-1);
  expect(r.left, 'left edge reached the window edge').toBeLessThanOrEqual(3);

  await dragHeaderTo(vp.w - 2, (await shellRect()).top + 10);
  r = await shellRect();
  console.log(`[P33-drag] right extreme: ${JSON.stringify(r)}`);
  expect(r.right, 'right edge clamped inside').toBeLessThanOrEqual(vp.w + 1);
  expect(r.right, 'right edge reached the window edge').toBeGreaterThanOrEqual(vp.w - 3);

  await dragHeaderTo((await shellRect()).left + 10, 2);
  r = await shellRect();
  console.log(`[P33-drag] top extreme: ${JSON.stringify(r)}`);
  expect(r.top, 'top edge clamped inside').toBeGreaterThanOrEqual(-1);
  expect(r.top, 'top edge reached the window edge').toBeLessThanOrEqual(3);

  await dragHeaderTo((await shellRect()).left + 10, vp.h - 2);
  r = await shellRect();
  console.log(`[P33-drag] bottom extreme: ${JSON.stringify(r)}`);
  expect(r.bottom, 'bottom edge clamped inside').toBeLessThanOrEqual(vp.h + 1);
  expect(r.bottom, 'bottom edge reached the window edge').toBeGreaterThanOrEqual(vp.h - 3);
  // All four edges still inside after the extreme tour.
  expect(r.left).toBeGreaterThanOrEqual(-1);
  expect(r.top).toBeGreaterThanOrEqual(-1);
  expect(r.right).toBeLessThanOrEqual(vp.w + 1);

  // ---- a control still works after the move -----------------------------
  await win.selectOption('[data-print-nup]', '2');
  await win.waitForTimeout(450);
  const cellCount = await win.locator('[data-print-preview-sheet] .print-preview-cell').count();
  const gridCols = await win.evaluate(() => {
    const s = document.querySelector('[data-print-preview-sheet]');
    return getComputedStyle(s).gridTemplateColumns;
  });
  console.log(`[P33-drag] after move, nup=2 -> preview cells=${cellCount} cols="${gridCols}"`);
  expect(cellCount, 'preview updated to 2 cells after the move').toBe(2);
  expect(P.trackCount(gridCols), 'preview grid is 2 columns after the move').toBe(2);

  // ---- reopening re-centres ---------------------------------------------
  await P.closeDialog(win);
  await P.openDialog(win);
  const r2 = await shellRect();
  const dragX2 = await win.locator('[data-print-dialog-shell]').getAttribute('data-drag-x');
  const dragY2 = await win.locator('[data-print-dialog-shell]').getAttribute('data-drag-y');
  const centerX = r2.left + r2.width / 2;
  console.log(`[P33-drag] reopened: shell=${JSON.stringify(r2)} data-drag-x=${dragX2} data-drag-y=${dragY2} centerX=${Math.round(centerX)} vpW/2=${Math.round(vp.w / 2)}`);
  expect(Number(dragX2), 'reopened dialog has no x offset').toBe(0);
  expect(Number(dragY2), 'reopened dialog has no y offset').toBe(0);
  expect(Math.abs(centerX - vp.w / 2), 'reopened dialog is horizontally centred').toBeLessThanOrEqual(2);
  await P.closeDialog(win);
});