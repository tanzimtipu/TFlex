// Phase 122 (TFL-1399) chunk B - focused verification of chunk A.
//
// Chunk A added `showDropzone` to IntakeTray and made the canvas persistent
// panel (`.intake-persistent`, App.tsx) pass `showDropzone={false}` so the
// "Drop files to add them to the queue" hint never renders on the canvas,
// while the default (Home) surface keeps it.
//
// This spec drives the REAL Electron app: it queues several files, opens a
// document so the queue's surviving (failed) rows surface on the canvas, then
// proves the drop-zone hint is absent from the canvas at the default window
// size and at the app's minimum supported size, while the rows and the Open
// control still render. Screenshots are written under screenshots/.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FX = path.resolve(__dirname, '..', 'test-fixtures', 'phase118');
const P = (n) => path.join(FX, n);
const HINT = 'Drop files to add them to the queue';

// Default geometry is 1440x900 (settings.ts DEFAULT_SETTINGS.geometry);
// the app's supported minimum is 960x640 (window.ts DESIRED_MIN_*).
const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_SIZE = { width: 960, height: 640 };

async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    globalThis.__tfl1399Original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: p.length === 0, filePaths: p });
  }, paths);
}

async function restoreOpenDialog(app) {
  await app.evaluate(({ dialog }) => {
    if (globalThis.__tfl1399Original) {
      dialog.showOpenDialog = globalThis.__tfl1399Original;
      delete globalThis.__tfl1399Original;
    }
  });
}

async function setWinSize(app, win, width, height) {
  const before = await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (!w) return null;
    const wasMaximized = w.isMaximized();
    if (wasMaximized) { w.unmaximize(); }
    w.setSize(size.width, size.height);
    return { wasMaximized, bounds: w.getBounds() };
  }, { width, height });
  // The renderer's CSS px must settle on the requested size before capture.
  await win.waitForFunction(
    (want) => Math.abs(window.innerWidth - want.w) <= 20 && Math.abs(window.innerHeight - want.h) <= 40,
    { w: width, h: height },
    { timeout: 15000 },
  );
  return before;
}

async function waitSettled(win, expected) {
  await win.waitForFunction(
    (want) => {
      const rows = document.querySelectorAll('[data-intake-row]');
      const validating = document.querySelectorAll('[data-intake-state="validating"]').length;
      return rows.length === want && validating === 0;
    },
    expected,
    { timeout: 30000 },
  );
}

// Canvas-surface state: what the persistent panel actually renders.
async function canvasState(win) {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-intake-persistent]');
    const tray = panel ? panel.querySelector('[data-intake-tray]') : null;
    const rows = panel ? panel.querySelectorAll('[data-intake-row]') : [];
    const open = panel ? panel.querySelector('[data-intake-open]') : null;
    const box = panel ? panel.getBoundingClientRect() : null;
    return {
      panelPresent: panel !== null,
      trayPresent: tray !== null,
      dropzoneCount: panel ? panel.querySelectorAll('[data-intake-dropzone]').length : 0,
      rowCount: rows.length,
      openPresent: open !== null,
      panelHasHintText: panel ? panel.textContent.includes('Drop files to add them to the queue') : false,
      bodyHasHintText: document.body.textContent.includes('Drop files to add them to the queue'),
      hintNodeCount: document.querySelectorAll('.intake-dropzone').length,
      box: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
      inner: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

test('TFL-1399: canvas persistent tray omits the drop-zone hint at default and minimum sizes', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.welcome', { timeout: 30000 });
    await win.waitForSelector('[data-intake-tray]', { timeout: 15000 });

    // Default window size on the canvas run.
    const sizeBefore = await setWinSize(app, win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    console.log(`[TFL-1399] default size set (wasMaximized=${sizeBefore?.wasMaximized}, ${JSON.stringify(sizeBefore?.bounds)})`);

    // Queue several files: one real PDF (opens) plus two that settle failed,
    // so the canvas panel keeps rows + the Open control after dispatch.
    await stubOpenDialog(app, [P('report-a.pdf'), P('unsupported.xyz'), P('misleading.png')]);
    await win.locator('[data-home-tool="open"]').first().click();
    await waitSettled(win, 3);

    // Dispatch: the real PDF opens as a document, Home unmounts, the failed
    // rows surface in the canvas `.intake-persistent` panel (DEF-645).
    await win.locator('[data-intake-open]').click();
    await win.waitForSelector('.pdf-page canvas:visible', { timeout: 30000 });
    await win.waitForSelector('[data-intake-persistent]', { timeout: 20000 });
    await win.waitForTimeout(500);

    const atDefault = await canvasState(win);
    console.log(`[TFL-1399] canvas@default=${JSON.stringify(atDefault)}`);
    expect(atDefault.panelPresent, 'canvas persistent panel renders on the canvas').toBe(true);
    expect(atDefault.trayPresent, 'persistent tray renders').toBe(true);
    expect(atDefault.rowCount, 'surviving queued rows render').toBeGreaterThan(0);
    expect(atDefault.openPresent, 'Open control renders with the queue').toBe(true);
    expect(atDefault.dropzoneCount, 'no [data-intake-dropzone] in the canvas panel').toBe(0);
    expect(atDefault.hintNodeCount, 'no .intake-dropzone node anywhere').toBe(0);
    expect(atDefault.panelHasHintText, 'hint text absent from the canvas panel').toBe(false);
    expect(atDefault.bodyHasHintText, 'hint text absent from the whole document').toBe(false);
    // No clipping/overlap regression: the panel sits inside the viewport.
    expect(atDefault.box.x).toBeGreaterThanOrEqual(0);
    expect(atDefault.box.y).toBeGreaterThanOrEqual(0);
    expect(atDefault.box.x + atDefault.box.w).toBeLessThanOrEqual(atDefault.inner.w + 1);
    expect(atDefault.box.y + atDefault.box.h).toBeLessThanOrEqual(atDefault.inner.h + 1);

    await win.screenshot({ path: path.join(SHOTS, 'tfl1399-canvas-persistent-default-1440x900.png') });

    // Minimum supported window size.
    const sizeMin = await setWinSize(app, win, MIN_SIZE.width, MIN_SIZE.height);
    console.log(`[TFL-1399] minimum size set (wasMaximized=${sizeMin?.wasMaximized}, ${JSON.stringify(sizeMin?.bounds)})`);
    await win.waitForTimeout(400);
    const atMin = await canvasState(win);
    console.log(`[TFL-1399] canvas@min=${JSON.stringify(atMin)}`);
    expect(atMin.panelPresent, 'canvas panel still renders at the minimum size').toBe(true);
    expect(atMin.rowCount, 'rows still render at the minimum size').toBeGreaterThan(0);
    expect(atMin.openPresent, 'Open still renders at the minimum size').toBe(true);
    expect(atMin.dropzoneCount, 'no dropzone in the canvas panel at the minimum size').toBe(0);
    expect(atMin.hintNodeCount, 'no .intake-dropzone node at the minimum size').toBe(0);
    expect(atMin.bodyHasHintText, 'hint text absent at the minimum size').toBe(false);
    expect(atMin.box.x).toBeGreaterThanOrEqual(0);
    expect(atMin.box.y).toBeGreaterThanOrEqual(0);
    expect(atMin.box.x + atMin.box.w).toBeLessThanOrEqual(atMin.inner.w + 1);
    expect(atMin.box.y + atMin.box.h).toBeLessThanOrEqual(atMin.inner.h + 1);
    // Two genuinely different window sizes were captured.
    expect(atMin.inner.w, 'minimum window is narrower than default').toBeLessThan(atDefault.inner.w);
    expect(atMin.inner.h, 'minimum window is shorter than default').toBeLessThan(atDefault.inner.h);

    await win.screenshot({ path: path.join(SHOTS, 'tfl1399-canvas-persistent-min-960x640.png') });

    console.log('[TFL-1399] canvas drop-zone hint absent at default and minimum sizes');
  } finally {
    await restoreOpenDialog(app);
    await hardClose(app, 'tfl1399-canvas-drop-hint');
  }
});
