// TFL-1187 (chunk F verification) — live window minimum 960x640 DIP clamped to
// the display work area. QA independent verification of TFL-1186.
//
// The assigned behaviour:
//   - the main window's effective minimum is
//     min(960, workArea.width) x min(640, workArea.height) for the display it
//     lives on (NOT a hard 960x640 that can exceed a small screen);
//   - resizing below that floor is refused by the OS/Electron path;
//   - the window stays resizable + maximizable;
//   - a detached/tear-out window opens and honours the same clamped floor;
//   - at exactly 960x640 the compact Navigator drawer still exposes content
//     (AR-02) and the reading-location anchor still holds (AR-01) — covered by
//     the tfl1179 re-run, not by this spec.
//
// Launches only through the canonical launchApp helper. Read-only product
// checks: no product source is modified.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1187-min');
  app = null;
  win = null;
});

test('main window minimum equals min(960, workArea.w) x min(640, workArea.h)', async () => {
  const info = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const bounds = w.getBounds();
    const disp = screen.getDisplayMatching(bounds);
    return {
      min: w.getMinimumSize(),
      size: w.getSize(),
      bounds,
      workArea: disp.workArea,
      primaryWorkArea: screen.getPrimaryDisplay().workArea,
      resizable: w.isResizable(),
      maximizable: w.isMaximizable(),
      maximized: w.isMaximized(),
    };
  });
  const expW = Math.min(960, info.workArea.width);
  const expH = Math.min(640, info.workArea.height);
  console.log(`[tfl1187] main bounds=${JSON.stringify(info.bounds)} size=${JSON.stringify(info.size)}`);
  console.log(`[tfl1187] workArea=${JSON.stringify(info.workArea)} primaryWorkArea=${JSON.stringify(info.primaryWorkArea)}`);
  console.log(`[tfl1187] getMinimumSize=${JSON.stringify(info.min)} expected=${expW}x${expH}`);

  expect(info.min[0], 'main window minimum width is min(960, workArea.width)').toBe(expW);
  expect(info.min[1], 'main window minimum height is min(640, workArea.height)').toBe(expH);
  expect(info.resizable, 'main window stays resizable').toBe(true);
  expect(info.maximizable, 'main window stays maximizable').toBe(true);
  await win.screenshot({ path: shot('tfl1187_main_min.png') });
});

test('resizing the main window below the minimum is refused at the floor', async () => {
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const wasMaximized = w.isMaximized();
    if (wasMaximized) w.unmaximize();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const min = w.getMinimumSize();
    w.setSize(400, 300);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterSetSize = w.getSize();
    const b = w.getBounds();
    w.setBounds({ x: b.x, y: b.y, width: 300, height: 200 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterSetBounds = w.getSize();
    return { wasMaximized, min, afterSetSize, afterSetBounds };
  });
  console.log(`[tfl1187] wasMaximized=${r.wasMaximized} min=${JSON.stringify(r.min)} afterSetSize=${JSON.stringify(r.afterSetSize)} afterSetBounds=${JSON.stringify(r.afterSetBounds)}`);
  expect(r.afterSetSize[0], 'setSize clamps width up to the floor').toBe(r.min[0]);
  expect(r.afterSetSize[1], 'setSize clamps height up to the floor').toBe(r.min[1]);
  expect(r.afterSetBounds[0], 'setBounds clamps width up to the floor').toBe(r.min[0]);
  expect(r.afterSetBounds[1], 'setBounds clamps height up to the floor').toBe(r.min[1]);
});

async function tearOut(page) {
  const title = page.locator('[data-tab-id] .tab-title').first();
  const tb = await title.boundingBox();
  const strip = await page.locator('.tab-list').boundingBox();
  const sx = tb.x + Math.min(6, tb.width / 2);
  const sy = tb.y + tb.height / 2;
  const ty = strip.y + strip.height + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 10, { steps: 4 });
  await page.mouse.move(sx, ty, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

test('detached/tear-out window opens and honours the same clamped floor', async () => {
  const sample = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, sample);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await win.waitForTimeout(700);

  const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
  await tearOut(win);
  const second = await secondP;
  expect(second, 'tear-out gesture opened a detached window').not.toBeNull();
  await second.waitForLoadState('domcontentloaded');
  expect(second.url(), 'detached window carries the #detached hash').toContain('#detached');

  const info = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#detached'));
    if (!w) return null;
    const cursor = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    return { min: w.getMinimumSize(), workArea: wa, resizable: w.isResizable(), maximizable: w.isMaximizable() };
  });
  const expW = Math.min(960, info.workArea.width);
  const expH = Math.min(640, info.workArea.height);
  console.log(`[tfl1187] detached workArea=${JSON.stringify(info.workArea)} min=${JSON.stringify(info.min)} expected=${expW}x${expH}`);
  await second.screenshot({ path: shot('tfl1187_detached.png') });
  expect(info.min[0], 'detached window minimum width is min(960, cursor workArea.width)').toBe(expW);
  expect(info.min[1], 'detached window minimum height is min(640, cursor workArea.height)').toBe(expH);
  expect(info.resizable, 'detached window stays resizable').toBe(true);
  expect(info.maximizable, 'detached window stays maximizable').toBe(true);
});
