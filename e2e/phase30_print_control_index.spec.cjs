// Phase 30 gate — CONTROL-INDEX sweep (qa).
//
// Covers the controls the phase introduces that the two existing specs do not
// already prove:
//   3.  [data-print-printer]  real list + default preselected; empty state;
//       [data-print-printers-error] when the list is unavailable.
//   4.  [data-print-copies] 1..99; [data-print-collate] disabled at 1.
//   5.  range all/current/custom + [data-print-range-input]; malformed range
//       shows [data-print-range-error] (never silently ignored).
//   6.  scale fit/actual/shrink/custom + [data-print-scale-percent] enabled
//       ONLY for custom.
//   7.  orientation auto/portrait/landscape -> preview layout.
//   8.  [data-print-duplex] / [data-print-color] persist across a refresh.
//   9.  [data-print-nup] + [data-print-page-order] -> preview sheet layout.
//   10. [data-print-odd-even] + [data-print-reverse] -> count/order change.
//   12. [data-print-confirm] disabled with no printer (running case is the
//       unit test printDialog.test.tsx "disables Print while running").
//   13. [data-print-cancel] closes; progress/error regions wired (unit test).
//
// NOT clicked: [data-print-confirm] — the real hand-off can hang the run.
// Items 1, 2 and 11 are already proven by phase30_print_dialog.spec.cjs and
// phase30_print_annotations.spec.cjs and are cited, not redone.
//
// Fixtures: test-fixtures/report.pdf (34 pages, portrait) and
// test-fixtures/squiggly-native.pdf (1 page).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIDDOT = '\u00b7';
const REPORT = path.resolve(__dirname, '..', 'test-fixtures', 'report.pdf');
const ONE_PAGE = path.resolve(__dirname, '..', 'test-fixtures', 'squiggly-native.pdf');

async function openFixture(win, app, fixture) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, fixture);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

async function openDialog(app, win) {
  const printPage = await openStandalonePrintWindow(app, win);
  await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  // Let the printer list settle (real option or empty/error state).
  await printPage.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      if (sel === null) return false;
      const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      const settled =
        document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
      return hasReal || settled;
    },
    null,
    { timeout: 20000 },
  );
  return printPage;
}

async function closeDialog(printPage) {
  if (printPage.isClosed()) return;
  const closed = printPage.waitForEvent('close', { timeout: 8000 }).catch(() => {});
  await printPage.click('[data-print-cancel]').catch(() => {});
  await closed;
}

function meta(page) {
  return page.textContent('[data-print-preview-meta]').then((t) => t.trim());
}

function sheetStyle(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-print-preview-sheet]');
    return {
      cols: el.style.gridTemplateColumns,
      rows: el.style.gridTemplateRows,
      landscape: el.getAttribute('data-landscape'),
    };
  });
}

// Phase 33 / DEF-280 — the page order is realised by the shared
// `printSheetLayout` slot assignment (grid dims + explicit slots), NOT by
// `grid-auto-flow` / `direction`. Read each DOM cell's page in cell order.
function cellPages(page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-print-preview-sheet] [data-print-preview-cell]'),
    ).map((c) => {
      const p = c.getAttribute('data-print-preview-page');
      return p === null ? null : Number(p);
    }),
  );
}

function cellCount(page) {
  return page.locator('[data-print-preview-sheet] .print-preview-cell').count();
}

// Override printer enumeration for the empty/error states. The print controls
// live in the standalone print window whose renderer calls `print:listPrinters`
// -> `listPrinters(event.sender)` -> the invoking webContents
// `getPrintersAsync`. Stubbing the WebContents prototype (rather than the main
// window's own property) covers the print window created later.
async function stubPrinters(app, mode) {
  await app.evaluate(({ BrowserWindow }, m) => {
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    if (!globalThis.__p30sweepPrinters) {
      globalThis.__p30sweepPrinters = { proto, orig: proto.getPrintersAsync };
    }
    proto.getPrintersAsync = async () => {
      if (m === 'empty') return [];
      throw new Error('printer subsystem offline');
    };
  }, mode);
}

async function restorePrinters(app) {
  await app.evaluate(() => {
    const s = globalThis.__p30sweepPrinters;
    if (s) {
      s.proto.getPrintersAsync = s.orig;
      globalThis.__p30sweepPrinters = null;
    }
  });
}

test('Phase 30 sweep: printer list states, copies/collate, scale, orientation, duplex/colour persistence', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, REPORT);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P30sweep] report.pdf pageCount=${pageCount}`);
    expect(pageCount).toBeGreaterThanOrEqual(3);

    // --- 3a. real printer list, default preselected -----------------------
    let printPage = await openDialog(app, win);
    const options = await printPage.$$eval('[data-print-printer] option', (opts) =>
      opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })),
    );
    const selected = await printPage.inputValue('[data-print-printer]');
    console.log(`[P30sweep] printers=${JSON.stringify(options)} selected=${selected}`);
    expect(options.length, 'real printer list has options').toBeGreaterThanOrEqual(1);
    expect(selected, 'a printer is preselected').not.toBe('');
    const defaultOpt = options.find((o) => /\(default\)/.test(o.text));
    if (defaultOpt) {
      expect(selected, 'system default is preselected').toBe(defaultOpt.value);
    } else {
      expect(selected, 'first printer preselected when no default is flagged').toBe(options[0].value);
    }

    // --- 4. copies 1..99 + collate disabled at 1 --------------------------
    expect(await printPage.locator('[data-print-collate]').isDisabled(), 'collate disabled at copies 1').toBe(true);
    await printPage.fill('[data-print-copies]', '3');
    expect(await printPage.inputValue('[data-print-copies]'), 'copies accepts 3').toBe('3');
    expect(await printPage.locator('[data-print-collate]').isDisabled(), 'collate enabled above 1').toBe(false);
    await printPage.fill('[data-print-copies]', '0');
    expect(await printPage.inputValue('[data-print-copies]'), 'copies 0 clamps to 1').toBe('1');
    expect(await printPage.locator('[data-print-collate]').isDisabled(), 'collate disabled again at 1').toBe(true);
    await printPage.fill('[data-print-copies]', '200');
    expect(await printPage.inputValue('[data-print-copies]'), 'copies 200 clamps to 99').toBe('99');

    // --- 6. scale percent enabled ONLY for custom -------------------------
    expect(await printPage.locator('[data-print-scale-percent]').isDisabled(), 'percent disabled for fit').toBe(true);
    await printPage.click('[data-print-scale-custom]');
    expect(await printPage.locator('[data-print-scale-percent]').isDisabled(), 'percent enabled for custom').toBe(false);
    await printPage.fill('[data-print-scale-percent]', '0');
    expect(await printPage.inputValue('[data-print-scale-percent]'), 'scale 0 clamps to 1').toBe('1');
    await printPage.fill('[data-print-scale-percent]', '999');
    expect(await printPage.inputValue('[data-print-scale-percent]'), 'scale 999 clamps to 500').toBe('500');
    await printPage.click('[data-print-scale-actual]');
    expect(await printPage.locator('[data-print-scale-percent]').isDisabled(), 'percent disabled for actual').toBe(true);

    // --- 7. orientation -> preview layout --------------------------------
    expect((await sheetStyle(printPage)).landscape, 'auto on a portrait page is not landscape').toBe('false');
    await printPage.click('[data-print-orientation-landscape]');
    expect((await sheetStyle(printPage)).landscape, 'landscape orientation sets data-landscape').toBe('true');
    await printPage.click('[data-print-orientation-portrait]');
    expect((await sheetStyle(printPage)).landscape, 'portrait orientation clears data-landscape').toBe('false');

    // --- 8. duplex/colour persist across a preview refresh ----------------
    await printPage.selectOption('[data-print-duplex]', 'longEdge');
    await printPage.selectOption('[data-print-color]', 'grey');
    // A preview refresh: N-up changes the preview page set and re-rasters.
    await printPage.selectOption('[data-print-nup]', '2');
    await printPage.waitForTimeout(800);
    expect(await printPage.inputValue('[data-print-duplex]'), 'duplex persists across refresh').toBe('longEdge');
    expect(await printPage.inputValue('[data-print-color]'), 'colour persists across refresh').toBe('grey');

    await closeDialog(printPage);

// --- 3b. empty printer state -----------------------------------------
    await stubPrinters(app, 'empty');
    printPage = await openDialog(app, win);
    // The dialog keeps the previous list until the new one resolves; wait for
    // the empty state itself rather than the stale options.
    await printPage.waitForSelector('[data-print-empty]', { state: 'visible', timeout: 8000 });
    expect(await printPage.locator('[data-print-empty]').isVisible(), 'empty state shown').toBe(true);
    expect(await printPage.locator('[data-print-printer]').isDisabled(), 'printer select disabled when empty').toBe(true);
    expect(await printPage.locator('[data-print-confirm]').isDisabled(), 'Print disabled with no printer').toBe(true);
    await closeDialog(printPage);
    await restorePrinters(app);

    // --- 3c. printer-list error state ------------------------------------
    await stubPrinters(app, 'error');
    printPage = await openDialog(app, win);
    await printPage.waitForSelector('[data-print-printers-error]', { state: 'visible', timeout: 8000 });
    const errText = (await printPage.textContent('[data-print-printers-error]')).trim();
    console.log(`[P30sweep] printers-error=${JSON.stringify(errText)}`);
    expect(await printPage.locator('[data-print-printers-error]').isVisible(), 'error state shown').toBe(true);
    expect(errText, 'error names the failure').toContain('Could not list printers');
    expect(await printPage.locator('[data-print-confirm]').isDisabled(), 'Print disabled on list error').toBe(true);
    await closeDialog(printPage);
    await restorePrinters(app);

    // --- 3d. real list returns after restore ------------------------------
    printPage = await openDialog(app, win);
    await printPage.waitForFunction(
      () => {
        const sel = document.querySelector('[data-print-printer]');
        return sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      },
      null,
      { timeout: 8000 },
    );
    expect(await printPage.inputValue('[data-print-printer]'), 'real list restored').not.toBe('');
    await closeDialog(printPage);
  } finally {
    await hardClose(app, 'p30sweep1');
  }
});
test('Phase 30 sweep: range, odd/even, reverse, N-up, page order, confirm/cancel', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, REPORT);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    expect(pageCount).toBeGreaterThanOrEqual(3);
    let printPage = await openDialog(app, win);

    // --- 5. scope changes the preview page/sheet count --------------------
    expect(await meta(printPage), 'All shows the full document').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );
    await printPage.click('[data-print-range-current]');
    expect(await meta(printPage), 'Current shows one page').toBe(`1 page ${MIDDOT} 1 sheet`);
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-2');
    await printPage.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-print-preview-meta]');
        return el !== null && el.textContent.trim() === want;
      },
      `2 pages ${MIDDOT} 2 sheets`,
      { timeout: 8000 },
    );
    expect(await meta(printPage), 'custom 1-2 shows two pages').toBe(`2 pages ${MIDDOT} 2 sheets`);

    // --- 5b. malformed range is surfaced, never silently ignored ----------
    await printPage.fill('[data-print-range-input]', '9-3');
    expect(await printPage.locator('[data-print-range-error]').isVisible(), 'reversed range error shown').toBe(true);
    const revErr = (await printPage.textContent('[data-print-range-error]')).trim();
    console.log(`[P30sweep] reversed-range error=${JSON.stringify(revErr)}`);
    expect(revErr).toMatch(/reversed/);
    expect(await printPage.getAttribute('[data-print-range-error]', 'role'), 'range error is role=alert').toBe('alert');
    expect(await printPage.locator('[data-print-confirm]').isDisabled(), 'Print disabled on bad range').toBe(true);
    await printPage.fill('[data-print-range-input]', 'abc');
    expect(await printPage.locator('[data-print-range-error]').isVisible(), 'non-numeric range error shown').toBe(true);
    const badErr = (await printPage.textContent('[data-print-range-error]')).trim();
    console.log(`[P30sweep] non-numeric error=${JSON.stringify(badErr)}`);
    expect(badErr).toMatch(/not a valid page or range/);
    await printPage.fill('[data-print-range-input]', '1-2');
    expect(await printPage.locator('[data-print-range-error]').count(), 'error clears on a valid range').toBe(0);

    // --- 10. odd/even + reverse change count and order --------------------
    await printPage.click('[data-print-range-all]');
    await printPage.selectOption('[data-print-odd-even]', 'odd');
    expect(await meta(printPage), 'odd-only halves the 34-page doc').toBe(`17 pages ${MIDDOT} 17 sheets`);
    // Screenshot 2: the odd-only range effect on the preview meta.
    await printPage.waitForTimeout(400);
    await printPage.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-sweep-range-oddeven.png'),
    });
    await printPage.selectOption('[data-print-odd-even]', 'even');
    expect(await meta(printPage), 'even-only halves the 34-page doc').toBe(`17 pages ${MIDDOT} 17 sheets`);
    await printPage.selectOption('[data-print-odd-even]', 'all');
    expect(await meta(printPage), 'all restores the full count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );

    // Reverse changes the ORDER: the first preview page becomes the last.
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    const firstAlt = await printPage.getAttribute('[data-print-preview] img', 'alt');
    console.log(`[P30sweep] first preview alt before reverse=${firstAlt}`);
    expect(firstAlt, 'first preview page is page 1').toBe('Page 1');
    await printPage.click('[data-print-reverse]');
    await printPage.waitForFunction(
      (want) => {
        const img = document.querySelector('[data-print-preview] img');
        return img !== null && img.getAttribute('alt') === want;
      },
      `Page ${pageCount}`,
      { timeout: 20000 },
    );
    const revAlt = await printPage.getAttribute('[data-print-preview] img', 'alt');
    console.log(`[P30sweep] first preview alt after reverse=${revAlt}`);
    expect(revAlt, 'reverse makes the last page preview first').toBe(`Page ${pageCount}`);
    await printPage.click('[data-print-reverse]');

    // --- 9. N-up + page order -> preview sheet arrangement ----------------
    expect(await printPage.locator('[data-print-page-order]').isDisabled(), 'page order disabled at 1-up').toBe(true);
    await printPage.selectOption('[data-print-nup]', '4');
    expect(await cellCount(printPage), '4-up preview has four cells').toBe(4);
    const s4 = await sheetStyle(printPage);
    console.log(`[P30sweep] 4-up style=${JSON.stringify(s4)}`);
    expect(s4.cols, '4-up grid is 2 columns').toBe('repeat(2, 1fr)');
    expect(s4.rows, '4-up grid is 2 rows').toBe('repeat(2, 1fr)');
    expect(await printPage.locator('[data-print-page-order]').isDisabled(), 'page order enabled above 1-up').toBe(false);
    expect(await meta(printPage), '4-up sheet count is ceil(34/4)').toBe(`34 pages ${MIDDOT} 9 sheets`);

    await printPage.selectOption('[data-print-page-order]', 'vertical');
    // Phase 33 — 4-up is a 2x2 grid for EVERY order; the order shows in the
    // per-cell page sequence (vertical fills by column: [1,3,2,4]).
    await expect.poll(() => cellPages(printPage), { timeout: 10000 }).toEqual([1, 3, 2, 4]);
    expect((await sheetStyle(printPage)).cols, 'vertical 4-up stays a 2-column grid').toBe('repeat(2, 1fr)');
    expect((await sheetStyle(printPage)).rows, 'vertical 4-up stays a 2-row grid').toBe('repeat(2, 1fr)');
    await printPage.selectOption('[data-print-page-order]', 'horizontalReversed');
    // Horizontal-reversed reverses each row: [2,1,4,3].
    await expect.poll(() => cellPages(printPage), { timeout: 10000 }).toEqual([2, 1, 4, 3]);
    await printPage.selectOption('[data-print-page-order]', 'horizontal');
    // Horizontal fills row-major: [1,2,3,4].
    await expect.poll(() => cellPages(printPage), { timeout: 10000 }).toEqual([1, 2, 3, 4]);
    expect((await sheetStyle(printPage)).cols, 'horizontal 4-up is a 2-column grid').toBe('repeat(2, 1fr)');
    expect((await sheetStyle(printPage)).rows, 'horizontal 4-up is a 2-row grid').toBe('repeat(2, 1fr)');

    // Screenshot 1: a 4-up preview.
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    await printPage.waitForTimeout(600);
    await printPage.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-sweep-nup.png'),
    });

// --- 12. confirm disabled with no printer (running case: unit test) ---
    await closeDialog(printPage);
    await stubPrinters(app, 'empty');
    printPage = await openDialog(app, win);
    await printPage.waitForSelector('[data-print-empty]', { state: 'visible', timeout: 8000 });
    expect(await printPage.locator('[data-print-confirm]').isDisabled(), 'Print disabled with no printer').toBe(true);
    await closeDialog(printPage);
    await restorePrinters(app);

    // --- 13. cancel closes; progress/error regions wired ------------------
    printPage = await openDialog(app, win);
    expect(await printPage.locator('[data-print-progress]').count(), 'progress absent when idle').toBe(0);
    expect(await printPage.locator('[data-print-error]').count(), 'error absent when idle').toBe(0);
    await closeDialog(printPage);
    expect(printPage.isClosed(), 'Cancel closed the dialog').toBe(true);
  } finally {
    await hardClose(app, 'p30sweep2');
  }
});

test('Phase 30 sweep: responsiveness during preview raster + 34-page timing', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, REPORT);

    // --- timing: click [data-print] -> first preview raster ----------------
    const t0 = Date.now();
    const pagePromise = app.waitForEvent('window');
    await win.click('[data-print]');
    const printPage = await pagePromise;
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    const firstRasterMs = Date.now() - t0;
    console.log(`[P30sweep] TIMING 34-page first preview raster = ${firstRasterMs}ms`);
    await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });

    // --- responsiveness: force a longer raster (16-up) and interact --------
    await printPage.selectOption('[data-print-nup]', '16');
    let caught = false;
    try {
      await printPage.waitForSelector('[data-print-preview] .print-preview-placeholder', {
        state: 'visible',
        timeout: 4000,
      });
      caught = true;
    } catch {
      caught = false;
    }
    console.log(`[P30sweep] mid-raster placeholder caught=${caught}`);

    // rAF frame-gap probe while the 16-page raster is in flight.
    const probe = await printPage.evaluate(async (duration) => {
      const gaps = [];
      let last = performance.now();
      const start = last;
      await new Promise((resolve) => {
        const tick = (t) => {
          gaps.push(t - last);
          last = t;
          if (t - start < duration) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return { frames: gaps.length, maxGap: Math.round(Math.max(...gaps)) };
    }, 1500);
    console.log(`[P30sweep] rAF probe during 16-up raster = ${JSON.stringify(probe)}`);

    // UI still responds mid-raster: a state toggle updates.
    await printPage.selectOption('[data-print-duplex]', 'shortEdge');
    expect(await printPage.inputValue('[data-print-duplex]'), 'duplex toggle responded mid-raster').toBe('shortEdge');

    // Cancel reacts mid-raster and closes the print window.
    await closeDialog(printPage);
    expect(printPage.isClosed(), 'Cancel closed mid-raster').toBe(true);
  } finally {
    await hardClose(app, 'p30sweep3');
  }
});

test('Phase 30 sweep: 1-page timing', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, ONE_PAGE);
    const t0 = Date.now();
    const pagePromise = app.waitForEvent('window');
    await win.click('[data-print]');
    const printPage = await pagePromise;
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    const firstRasterMs = Date.now() - t0;
    console.log(`[P30sweep] TIMING 1-page first preview raster = ${firstRasterMs}ms`);
    await closeDialog(printPage);
  } finally {
    await hardClose(app, 'p30sweep4');
  }
});
