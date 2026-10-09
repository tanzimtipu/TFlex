// TFL-1520 focused verification — the Home intake tray is ONE shared box.
//
// TFL-1521 merged Home's drop zone and queued-file list into a single
// `.intake-tray` boundary: the drop zone renders first, then the rows, with a
// 1px `.intake-sep` hairline between the drop zone and the first row and
// between each adjacent pair (no trailing separator). The old separate
// `.intake-list` / `.intake-dropzone` borders are gone.
//
// This spec drives the REAL Electron app through e2e/lib/launch.cjs and:
//   - asserts the empty Home state is one box (drop zone only, no separators);
//   - asserts the populated Home state is one box with separators === rows and
//     no trailing divider;
//   - captures before/after screenshots at default (1440x900) and minimum
//     (960x640) window sizes, in light and dark themes.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FX = path.resolve(__dirname, '..', 'test-fixtures', 'phase118');
const P = (n) => path.join(FX, n);

// Default geometry 1440x900; supported minimum 960x640 (window.ts).
const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN_SIZE = { width: 960, height: 640 };

async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    globalThis.__tfl1520Original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: p.length === 0, filePaths: p });
  }, paths);
}

async function restoreOpenDialog(app) {
  await app.evaluate(({ dialog }) => {
    if (globalThis.__tfl1520Original) {
      dialog.showOpenDialog = globalThis.__tfl1520Original;
      delete globalThis.__tfl1520Original;
    }
  });
}

async function setWinSize(app, win, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    w.setSize(size.width, size.height);
  }, { width, height });
  await win.waitForFunction(
    (want) => Math.abs(window.innerWidth - want.w) <= 20 && Math.abs(window.innerHeight - want.h) <= 40,
    { w: width, h: height },
    { timeout: 15000 },
  );
}

async function setTheme(win, theme) {
  await win.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await win.waitForTimeout(250);
}

async function shot(win, name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[TFL-1520] screenshot ${p}`);
  return p;
}

// Wait until every queued row has left `validating` (real detection settled).
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

// Structural + computed-style snapshot of the Home intake box.
async function boxState(win) {
  return win.evaluate(() => {
    const trays = document.querySelectorAll('[data-intake-tray]');
    const tray = trays[0] ?? null;
    const dropzones = document.querySelectorAll('[data-intake-dropzone]');
    const seps = document.querySelectorAll('.intake-sep');
    const rows = document.querySelectorAll('[data-intake-row]');
    const list = document.querySelector('.intake-list');
    const cs = tray ? getComputedStyle(tray) : null;
    const sep = seps[0] ? getComputedStyle(seps[0]) : null;
    const dz = dropzones[0] ? getComputedStyle(dropzones[0]) : null;
    const kids = list
      ? Array.from(list.children).map((el) =>
          el.classList.contains('intake-sep') ? 'sep' : 'row',
        )
      : [];
    return {
      trayCount: trays.length,
      dropzoneCount: dropzones.length,
      sepCount: seps.length,
      rowCount: rows.length,
      empty: !!document.querySelector('.intake-empty'),
      trayBorderTop: cs ? cs.borderTopWidth : null,
      trayBorderStyle: cs ? cs.borderTopStyle : null,
      trayRadius: cs ? cs.borderTopLeftRadius : null,
      sepHeight: sep ? sep.height : null,
      sepBg: sep ? sep.backgroundColor : null,
      listBorderTop: list ? getComputedStyle(list).borderTopWidth : null,
      dropzoneBorderTop: dz ? dz.borderTopWidth : null,
      kids,
      inner: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

test('TFL-1520: Home intake is one shared box with separators (screenshots)', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.welcome', { timeout: 30000 });
    await win.waitForSelector('[data-intake-tray]', { timeout: 15000 });

    // ---- Empty state (before): drop zone only, one box, no separators. ----
    await setWinSize(app, win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await setTheme(win, 'light');
    const empty = await boxState(win);
    console.log(`[TFL-1520] empty=${JSON.stringify(empty)}`);
    expect(empty.trayCount, 'exactly one [data-intake-tray] boundary').toBe(1);
    expect(empty.dropzoneCount, 'drop zone renders').toBe(1);
    expect(empty.rowCount, 'no rows when empty').toBe(0);
    expect(empty.empty, 'empty hint renders').toBe(true);
    expect(empty.sepCount, 'no separators in the empty state').toBe(0);
    expect(empty.trayBorderStyle, 'shared box carries a border').toBe('solid');
    expect(empty.trayBorderTop, 'shared box border is a hairline').toBe('1px');
    expect(empty.dropzoneBorderTop, 'drop zone no longer owns its own border').toBe('0px');

    await shot(win, 'tfl1520-intake-empty-default-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'tfl1520-intake-empty-default-dark.png');

    await setWinSize(app, win, MIN_SIZE.width, MIN_SIZE.height);
    await setTheme(win, 'light');
    await shot(win, 'tfl1520-intake-empty-min-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'tfl1520-intake-empty-min-dark.png');

    // ---- Populated state (after): drop zone + 2 rows + 2 separators. ----
    await setWinSize(app, win, DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await setTheme(win, 'light');
    await stubOpenDialog(app, [P('report-a.pdf'), P('report-b.pdf')]);
    await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('[data-intake-row="1"]', { timeout: 20000 });
    await waitSettled(win, 2);

    const pop = await boxState(win);
    console.log(`[TFL-1520] populated=${JSON.stringify(pop)}`);
    expect(pop.trayCount, 'still exactly one [data-intake-tray] boundary').toBe(1);
    expect(pop.dropzoneCount, 'drop zone still renders with a queue').toBe(1);
    expect(pop.rowCount, 'two rows staged').toBe(2);
    expect(pop.sepCount, 'separators === rows (drop zone counts as leading item)').toBe(2);
    expect(pop.kids, 'order is sep, row, sep, row — no trailing separator').toEqual([
      'sep',
      'row',
      'sep',
      'row',
    ]);
    expect(pop.listBorderTop, 'the list no longer draws its own box').toBe('0px');
    expect(pop.sepHeight, 'separator is a 1px hairline').toBe('1px');

    await shot(win, 'tfl1520-intake-populated-default-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'tfl1520-intake-populated-default-dark.png');

    await setWinSize(app, win, MIN_SIZE.width, MIN_SIZE.height);
    await setTheme(win, 'light');
    const popMin = await boxState(win);
    expect(popMin.trayCount, 'one box at the minimum size').toBe(1);
    expect(popMin.sepCount, 'separators persist at the minimum size').toBe(2);
    expect(popMin.inner.w, 'minimum window is narrower than default').toBeLessThan(pop.inner.w);
    expect(popMin.inner.h, 'minimum window is shorter than default').toBeLessThan(pop.inner.h);
    await shot(win, 'tfl1520-intake-populated-min-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'tfl1520-intake-populated-min-dark.png');

    console.log('[TFL-1520] single-box intake structure verified with screenshots');
  } finally {
    await restoreOpenDialog(app);
    await hardClose(app, 'tfl1520-intake-box');
  }
});
