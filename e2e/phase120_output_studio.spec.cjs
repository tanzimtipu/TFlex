// Phase 120 D - Focused QA verification of the Output Studio overhaul in the
// dedicated "Print - Jovrel" window (TFL-1258). Proves the Phase 120 surface
// and the CONTROL-INDEX against the REAL Electron app, launched only through
// the canonical e2e/lib/launch.cjs `launchApp` helper.
//
// Covers:
//   1. the print window opens from the real title-bar Print control, and
//      Ctrl+P / the command re-opens it (blast radius);
//   2. the Output Studio surface: sticky header, pinned footer, body scroll;
//   3. two-column settings|preview when wide, stacked compact below the ONE
//      declared breakpoint (720 logical px);
//   4. every CONTROL-INDEX control present and wired;
//   5. the truthful preview sheet/meta driven by real geometry;
//   6. the pre-execution consequence summary;
//   7. full + compact screenshots in light and dark, plus forced-colors high
//      contrast and 200% scaling.
//
// Fixture: test-fixtures/report.pdf (34 pages, text-rich).
// NOT clicked: [data-print-confirm] - a real print can hang the run; the
// confirm payload path is covered by the unit specs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const {
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
  hardClose,
  runTool,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIDDOT = '\u00b7';
const REPORT = path.resolve(__dirname, '..', 'test-fixtures', 'report.pdf');

// Every data-print-* control the Phase 120 CONTROL-INDEX names, split by when
// it is rendered: ALWAYS controls are present as soon as the surface is ready;
// BOOKLET / POSTER controls render only once their layout is chosen.
const ALWAYS = [
  '[data-print-preset]', '[data-print-preset-name]', '[data-print-preset-save]',
  '[data-print-preset-delete]', '[data-print-printer]', '[data-print-layout]',
  '[data-print-copies]', '[data-print-collate]',
  '[data-print-range-all]', '[data-print-range-current]', '[data-print-range-custom]',
  '[data-print-range-input]',
  '[data-print-scale-fit]', '[data-print-scale-actual]', '[data-print-scale-shrink]',
  '[data-print-scale-custom]', '[data-print-scale-percent]',
  '[data-print-orientation-auto]', '[data-print-orientation-portrait]',
  '[data-print-orientation-landscape]', '[data-print-duplex]', '[data-print-color]',
  '[data-print-nup]', '[data-print-page-order]', '[data-print-odd-even]',
  '[data-print-reverse]', '[data-print-annotations]',
  '[data-print-preview]', '[data-print-preview-sheet]', '[data-print-preview-meta]',
  '[data-print-summary]', '[data-print-summary-pages]', '[data-print-summary-destination]',
  '[data-print-summary-format]', '[data-print-cancel]', '[data-print-confirm]',
];
const BOOKLET = [
  '[data-print-booklet-gutter]', '[data-print-booklet-creep]', '[data-print-booklet-subset]',
];
const POSTER = [
  '[data-print-poster-rows]', '[data-print-poster-cols]', '[data-print-poster-overlap]',
  '[data-print-poster-scale]', '[data-print-poster-cut-marks]',
];

async function openFixture(win, app) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

// Resize the standalone print window through main (the surface re-evaluates
// its ONE breakpoint on the resize event).
async function setPrintWinSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tfWindow=print'));
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
}

async function zoomPrintWin(app, factor) {
  await app.evaluate(({ BrowserWindow }, z) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tfWindow=print'));
    if (w) w.webContents.setZoomFactor(z);
  }, factor);
}

function layoutMode(printPage) {
  return printPage.evaluate(() => {
    const body = document.querySelector('.print-body');
    return {
      mode: body ? body.getAttribute('data-print-layout-mode') : null,
      cols: body ? getComputedStyle(body).gridTemplateColumns : null,
    };
  });
}

async function expectControlsPresent(printPage, selectors, label) {
  const missing = [];
  for (const sel of selectors) {
    if ((await printPage.locator(sel).count()) === 0) missing.push(sel);
  }
  if (missing.length) throw new Error(`${label}: missing controls ${JSON.stringify(missing)}`);
}

async function waitForMeta(printPage, want, timeout = 8000) {
  await printPage.waitForFunction(
    (expected) => {
      const el = document.querySelector('[data-print-preview-meta]');
      return el !== null && el.textContent.trim() === expected;
    },
    want,
    { timeout },
  );
  return (await printPage.textContent('[data-print-preview-meta]')).trim();
}

async function shot(printPage, name) {
  const p = path.join(SHOTS, name);
  await printPage.screenshot({ path: p });
  console.log(`[P120] screenshot ${p}`);
  return p;
}

test('Phase 120 Output Studio: sticky chrome, adaptive layout, controls, truthful preview, summary', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P120] fixture=report.pdf pageCount=${pageCount}`);
    expect(pageCount, 'fixture has >= 3 pages').toBeGreaterThanOrEqual(3);

    // --- 1. the real title-bar Print control opens the standalone window. ---
    const printPage = await openStandalonePrintWindow(app, win);
    const title = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tfWindow=print'));
      return w ? w.getTitle() : null;
    });
    console.log(`[P120] window title=${JSON.stringify(title)}`);
    expect(title, 'window keeps its real title').toBe('Print - Jovrel');

    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await printPage.waitForTimeout(600);

    // --- 2. Output Studio chrome: sticky header, real title + doc metadata. ---
    const chrome = await printPage.evaluate(() => {
      const header = document.querySelector('.print-studio-header');
      const titleEl = document.querySelector('.print-window-title');
      const doc = document.querySelector('[data-print-window-doc]');
      const panel = document.querySelector('.print-window-panel');
      return {
        headerPos: header ? getComputedStyle(header).position : null,
        title: titleEl ? titleEl.textContent.trim() : null,
        doc: doc ? doc.textContent.trim() : null,
        panelRows: panel ? getComputedStyle(panel).gridTemplateRows : null,
      };
    });
    console.log(`[P120] chrome=${JSON.stringify(chrome)}`);
    expect(chrome.headerPos, 'header is sticky').toBe('sticky');
    expect(chrome.title, 'surface title is Print').toBe('Print');
    expect(chrome.doc, 'document name is shown').toContain('report');

    // --- 3. wide layout: two columns (settings | preview). ---
    const wide = await layoutMode(printPage);
    console.log(`[P120] wide layout=${JSON.stringify(wide)}`);
    expect(wide.mode, 'wide above the breakpoint').toBe('wide');
    expect(wide.cols.split(' ').filter(Boolean).length, 'two grid tracks when wide').toBeGreaterThanOrEqual(2);

    // --- 4. every always-on CONTROL-INDEX control present. ---
    await expectControlsPresent(printPage, ALWAYS, 'wide');
    expect(await printPage.locator('[data-print-preview-cell]').count(), 'preview has cells').toBeGreaterThanOrEqual(1);

    // --- 5. truthful preview meta from real geometry. ---
    const metaText = (await printPage.textContent('[data-print-preview-meta]')).trim();
    console.log(`[P120] preview meta=${JSON.stringify(metaText)}`);
    expect(metaText, 'preview starts at the full document count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );

    // --- 6. consequence summary: pages / destination / format. ---
    const summary = await printPage.evaluate(() => ({
      pages: document.querySelector('[data-print-summary-pages]')?.textContent.trim() || '',
      dest: document.querySelector('[data-print-summary-destination]')?.textContent.trim() || '',
      format: document.querySelector('[data-print-summary-format]')?.textContent.trim() || '',
    }));
    console.log(`[P120] summary=${JSON.stringify(summary)}`);
    expect(summary.pages, 'summary states the selected pages').toContain(String(pageCount));
    expect(summary.dest, 'summary states the destination').not.toBe('');
    expect(summary.format, 'summary states the output format').not.toBe('');

    // --- 7. pinned footer: body scrolls, header + action stay visible. ---
    await printPage.evaluate(() => {
      const b = document.querySelector('.print-window-panel .modal-body');
      if (b) b.scrollTop = b.scrollHeight;
    });
    await printPage.waitForTimeout(250);
    const pinned = await printPage.evaluate(() => {
      const h = document.querySelector('.print-studio-header').getBoundingClientRect();
      const c = document.querySelector('[data-print-confirm]').getBoundingClientRect();
      const body = document.querySelector('.print-window-panel .modal-body');
      return {
        overflow: body ? body.scrollHeight > body.clientHeight + 1 : false,
        headerTop: h.top,
        headerVisible: h.height > 0 && h.top >= -1,
        confirmBottom: c.bottom,
        confirmVisible: c.width > 0 && c.bottom <= window.innerHeight + 1,
        vh: window.innerHeight,
      };
    });
    console.log(`[P120] pinned=${JSON.stringify(pinned)}`);
    expect(pinned.overflow, 'the panel body really scrolls').toBe(true);
    expect(pinned.headerVisible, 'sticky header remains visible after scroll').toBe(true);
    expect(pinned.confirmVisible, 'pinned Print action stays inside the viewport').toBe(true);

    // --- 8. controls are WIRED (observable results, not just presence). ---
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-2');
    expect(await waitForMeta(printPage, `2 pages ${MIDDOT} 2 sheets`), 'custom range drives the preview').toBe(
      `2 pages ${MIDDOT} 2 sheets`,
    );
    await printPage.fill('[data-print-range-input]', '9-3');
    expect(await printPage.locator('[data-print-range-error]').isVisible(), 'invalid range surfaces an error').toBe(true);
    await printPage.fill('[data-print-range-input]', '1-2');
    await printPage.click('[data-print-range-all]');
    expect(await printPage.isChecked('[data-print-range-all]'), 'All radio is the checked range control').toBe(true);
    expect(await printPage.isChecked('[data-print-range-custom]'), 'Custom radio clears when All is chosen').toBe(false);
    expect(await printPage.locator('[data-print-range-input]').isDisabled(), 'custom input disabled under All').toBe(true);
    expect(await waitForMeta(printPage, `${pageCount} pages ${MIDDOT} ${pageCount} sheets`), 'All restores the full count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );

    expect(await printPage.locator('[data-print-scale-percent]').isDisabled(), 'percent disabled for fit').toBe(true);
    await printPage.click('[data-print-scale-custom]');
    expect(await printPage.locator('[data-print-scale-percent]').isDisabled(), 'percent enabled for custom').toBe(false);
    await printPage.click('[data-print-scale-fit]');

    expect(await printPage.locator('[data-print-collate]').isDisabled(), 'collate disabled at 1 copy').toBe(true);
    await printPage.fill('[data-print-copies]', '3');
    expect(await printPage.locator('[data-print-collate]').isDisabled(), 'collate enabled above 1 copy').toBe(false);
    await printPage.fill('[data-print-copies]', '1');

    await printPage.selectOption('[data-print-layout]', 'booklet');
    await expectControlsPresent(printPage, BOOKLET, 'booklet');
    await printPage.selectOption('[data-print-layout]', 'poster');
    await expectControlsPresent(printPage, POSTER, 'poster');
    await printPage.selectOption('[data-print-layout]', 'single');
    console.log('[P120] CONTROL-INDEX controls present and wired');

    // --- 9. screenshots: full + compact, light + dark. ---
    await setPrintWinSize(app, 960, 860);
    await printPage.evaluate(() => {
      const b = document.querySelector('.print-window-panel .modal-body');
      if (b) b.scrollTop = 0;
    });
    await printPage.waitForTimeout(400);
    await expect(printPage.locator('[data-print-preview]'), 'preview stage visible in the wide layout').toBeVisible();
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await printPage.waitForTimeout(250);
    await shot(printPage, 'phase120-output-studio-wide-light.png');

    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await printPage.waitForTimeout(250);
    await shot(printPage, 'phase120-output-studio-wide-dark.png');

    await setPrintWinSize(app, 560, 860);
    await printPage.waitForFunction(() => {
      const b = document.querySelector('.print-body');
      return b !== null && b.getAttribute('data-print-layout-mode') === 'compact';
    }, null, { timeout: 8000 });
    const compact = await layoutMode(printPage);
    console.log(`[P120] compact layout=${JSON.stringify(compact)}`);
    expect(compact.mode, 'compact below the breakpoint').toBe('compact');
    expect(compact.cols.split(' ').filter(Boolean).length, 'one grid track when compact').toBe(1);

    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await printPage.waitForTimeout(250);
    await shot(printPage, 'phase120-output-studio-compact-light.png');
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await printPage.waitForTimeout(250);
    await shot(printPage, 'phase120-output-studio-compact-dark.png');

    // The stacked preview sits below the settings in compact - capture it too.
    await printPage.evaluate(() => {
      const b = document.querySelector('.print-window-panel .modal-body');
      if (b) b.scrollTop = b.scrollHeight;
    });
    await printPage.waitForTimeout(300);
    await expect(printPage.locator('[data-print-preview]'), 'preview stage visible in the compact layout').toBeVisible();
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await printPage.waitForTimeout(200);
    await shot(printPage, 'phase120-output-studio-compact-preview.png');

    // --- 10. high contrast (platform forced-colors path). ---
    await setPrintWinSize(app, 960, 860);
    await printPage.evaluate(() => {
      const b = document.querySelector('.print-window-panel .modal-body');
      if (b) b.scrollTop = 0;
    });
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await printPage.emulateMedia({ forcedColors: 'active' });
    await printPage.waitForTimeout(300);
    await shot(printPage, 'phase120-output-studio-high-contrast.png');
    await printPage.emulateMedia({ forcedColors: 'none' });

    // --- 11. 200% scaling: no overlap, action still reachable. ---
    await zoomPrintWin(app, 2);
    await printPage.waitForTimeout(400);
    const scaled = await printPage.evaluate(() => {
      const c = document.querySelector('[data-print-confirm]').getBoundingClientRect();
      const h = document.querySelector('.print-studio-header').getBoundingClientRect();
      return { confirmVisible: c.width > 0 && c.bottom <= window.innerHeight + 1, headerVisible: h.height > 0 && h.top >= -1 };
    });
    console.log(`[P120] 200% scaling=${JSON.stringify(scaled)}`);
    expect(scaled.headerVisible, 'header remains visible at 200%').toBe(true);
    expect(scaled.confirmVisible, 'Print action reachable at 200%').toBe(true);
    await shot(printPage, 'phase120-output-studio-200-percent.png');
    await zoomPrintWin(app, 1);

    // --- 12. Cancel closes the window and keeps the source document open. ---
    await printPage.click('[data-print-cancel]');
    await printPage.waitForEvent('close', { timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(500);
    const afterCancel = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('tfWindow=print')).length);
    expect(afterCancel, 'Cancel closed the print window').toBe(0);
    expect(await win.locator('.pdf-page canvas').count(), 'source document stays open after Cancel').toBeGreaterThanOrEqual(1);
  } finally {
    await hardClose(app, 'p120-studio');
  }
});

test('Phase 120 blast radius: Ctrl+P re-opens the window; the export dialog is unchanged', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app);

    // --- Ctrl+P (native input path) re-opens the standalone window. ---
    const p = app.waitForEvent('window');
    await win.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
    });
    const printPage = await p;
    await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
    await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 20000 });
    console.log('[P120] Ctrl+P opened the standalone print window');
    await closeStandalonePrintWindow(app, printPage);

    // --- the export surface is untouched by this phase. ---
    await runTool(win, 'exportPages');
    await win.waitForSelector('[data-export-dialog]', { state: 'visible', timeout: 15000 });
    const exportShape = await win.evaluate(() => ({
      formats: Array.from(document.querySelectorAll('[data-export-format]')).map((n) => n.getAttribute('data-export-format')),
      hasRange: document.querySelector('[data-export-range]') !== null,
      hasConfirm: document.querySelector('[data-export-confirm]') !== null,
      hasShellClose: document.querySelector('[data-dialog-shell] .modal-close, [data-dialog-shell] .sheet-close') !== null,
    }));
    console.log(`[P120] export dialog=${JSON.stringify(exportShape)}`);
    expect(exportShape.formats).toEqual(expect.arrayContaining(['png', 'jpeg', 'tiff']));
    expect(exportShape.hasRange, 'export keeps its range control').toBe(true);
    expect(exportShape.hasConfirm, 'export keeps its confirm action').toBe(true);
    expect(exportShape.hasShellClose, 'export keeps its dialog-shell close').toBe(true);
    await win.locator('[data-dialog-shell] .modal-close, [data-dialog-shell] .sheet-close').first().click();
    await win.waitForSelector('[data-export-dialog]', { state: 'detached', timeout: 8000 });
    console.log('[P120] export dialog opens and cancels as before');
  } finally {
    await hardClose(app, 'p120-blast');
  }
});
