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
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

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

async function openDialog(win) {
  await win.click('[data-print]');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  // Let the printer list settle (real option or empty/error state).
  await win.waitForFunction(
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
}

async function closeDialog(win) {
  await win.click('[data-print-cancel]');
  await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
}

function meta(win) {
  return win.textContent('[data-print-preview-meta]').then((t) => t.trim());
}

function sheetStyle(win) {
  return win.evaluate(() => {
    const el = document.querySelector('[data-print-preview-sheet]');
    return {
      cols: el.style.gridTemplateColumns,
      rows: el.style.gridTemplateRows,
      flow: el.style.gridAutoFlow,
      dir: el.style.direction,
      landscape: el.getAttribute('data-landscape'),
    };
  });
}

function cellCount(win) {
  return win.locator('[data-print-preview-sheet] .print-preview-cell').count();
}

// Override the main-process printer enumeration for the empty/error states.
async function stubPrinters(app, mode) {
  await app.evaluate(({ BrowserWindow }, m) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (m === 'empty') {
      w.webContents.getPrintersAsync = async () => [];
    } else {
      w.webContents.getPrintersAsync = async () => {
        throw new Error('printer subsystem offline');
      };
    }
  }, mode);
}

async function restorePrinters(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    delete w.webContents.getPrintersAsync;
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
    await openDialog(win);
    const options = await win.$$eval('[data-print-printer] option', (opts) =>
      opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })),
    );
    const selected = await win.inputValue('[data-print-printer]');
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
    expect(await win.locator('[data-print-collate]').isDisabled(), 'collate disabled at copies 1').toBe(true);
    await win.fill('[data-print-copies]', '3');
    expect(await win.inputValue('[data-print-copies]'), 'copies accepts 3').toBe('3');
    expect(await win.locator('[data-print-collate]').isDisabled(), 'collate enabled above 1').toBe(false);
    await win.fill('[data-print-copies]', '0');
    expect(await win.inputValue('[data-print-copies]'), 'copies 0 clamps to 1').toBe('1');
    expect(await win.locator('[data-print-collate]').isDisabled(), 'collate disabled again at 1').toBe(true);
    await win.fill('[data-print-copies]', '200');
    expect(await win.inputValue('[data-print-copies]'), 'copies 200 clamps to 99').toBe('99');

    // --- 6. scale percent enabled ONLY for custom -------------------------
    expect(await win.locator('[data-print-scale-percent]').isDisabled(), 'percent disabled for fit').toBe(true);
    await win.click('[data-print-scale-custom]');
    expect(await win.locator('[data-print-scale-percent]').isDisabled(), 'percent enabled for custom').toBe(false);
    await win.fill('[data-print-scale-percent]', '0');
    expect(await win.inputValue('[data-print-scale-percent]'), 'scale 0 clamps to 1').toBe('1');
    await win.fill('[data-print-scale-percent]', '999');
    expect(await win.inputValue('[data-print-scale-percent]'), 'scale 999 clamps to 500').toBe('500');
    await win.click('[data-print-scale-actual]');
    expect(await win.locator('[data-print-scale-percent]').isDisabled(), 'percent disabled for actual').toBe(true);

    // --- 7. orientation -> preview layout --------------------------------
    expect((await sheetStyle(win)).landscape, 'auto on a portrait page is not landscape').toBe('false');
    await win.click('[data-print-orientation-landscape]');
    expect((await sheetStyle(win)).landscape, 'landscape orientation sets data-landscape').toBe('true');
    await win.click('[data-print-orientation-portrait]');
    expect((await sheetStyle(win)).landscape, 'portrait orientation clears data-landscape').toBe('false');

    // --- 8. duplex/colour persist across a preview refresh ----------------
    await win.selectOption('[data-print-duplex]', 'longEdge');
    await win.selectOption('[data-print-color]', 'grey');
    // A preview refresh: N-up changes the preview page set and re-rasters.
    await win.selectOption('[data-print-nup]', '2');
    await win.waitForTimeout(800);
    expect(await win.inputValue('[data-print-duplex]'), 'duplex persists across refresh').toBe('longEdge');
    expect(await win.inputValue('[data-print-color]'), 'colour persists across refresh').toBe('grey');

    await closeDialog(win);

// --- 3b. empty printer state -----------------------------------------
    await stubPrinters(app, 'empty');
    await openDialog(win);
    // The dialog keeps the previous list until the new one resolves; wait for
    // the empty state itself rather than the stale options.
    await win.waitForSelector('[data-print-empty]', { state: 'visible', timeout: 8000 });
    expect(await win.locator('[data-print-empty]').isVisible(), 'empty state shown').toBe(true);
    expect(await win.locator('[data-print-printer]').isDisabled(), 'printer select disabled when empty').toBe(true);
    expect(await win.locator('[data-print-confirm]').isDisabled(), 'Print disabled with no printer').toBe(true);
    await closeDialog(win);
    await restorePrinters(app);

    // --- 3c. printer-list error state ------------------------------------
    await stubPrinters(app, 'error');
    await openDialog(win);
    await win.waitForSelector('[data-print-printers-error]', { state: 'visible', timeout: 8000 });
    const errText = (await win.textContent('[data-print-printers-error]')).trim();
    console.log(`[P30sweep] printers-error=${JSON.stringify(errText)}`);
    expect(await win.locator('[data-print-printers-error]').isVisible(), 'error state shown').toBe(true);
    expect(errText, 'error names the failure').toContain('Could not list printers');
    expect(await win.locator('[data-print-confirm]').isDisabled(), 'Print disabled on list error').toBe(true);
    await closeDialog(win);
    await restorePrinters(app);

    // --- 3d. real list returns after restore ------------------------------
    await openDialog(win);
    await win.waitForFunction(
      () => {
        const sel = document.querySelector('[data-print-printer]');
        return sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      },
      null,
      { timeout: 8000 },
    );
    expect(await win.inputValue('[data-print-printer]'), 'real list restored').not.toBe('');
    await closeDialog(win);
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
    await openDialog(win);

    // --- 5. scope changes the preview page/sheet count --------------------
    expect(await meta(win), 'All shows the full document').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );
    await win.click('[data-print-range-current]');
    expect(await meta(win), 'Current shows one page').toBe(`1 page ${MIDDOT} 1 sheet`);
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-2');
    await win.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-print-preview-meta]');
        return el !== null && el.textContent.trim() === want;
      },
      `2 pages ${MIDDOT} 2 sheets`,
      { timeout: 8000 },
    );
    expect(await meta(win), 'custom 1-2 shows two pages').toBe(`2 pages ${MIDDOT} 2 sheets`);

    // --- 5b. malformed range is surfaced, never silently ignored ----------
    await win.fill('[data-print-range-input]', '9-3');
    expect(await win.locator('[data-print-range-error]').isVisible(), 'reversed range error shown').toBe(true);
    const revErr = (await win.textContent('[data-print-range-error]')).trim();
    console.log(`[P30sweep] reversed-range error=${JSON.stringify(revErr)}`);
    expect(revErr).toMatch(/reversed/);
    expect(await win.getAttribute('[data-print-range-error]', 'role'), 'range error is role=alert').toBe('alert');
    expect(await win.locator('[data-print-confirm]').isDisabled(), 'Print disabled on bad range').toBe(true);
    await win.fill('[data-print-range-input]', 'abc');
    expect(await win.locator('[data-print-range-error]').isVisible(), 'non-numeric range error shown').toBe(true);
    const badErr = (await win.textContent('[data-print-range-error]')).trim();
    console.log(`[P30sweep] non-numeric error=${JSON.stringify(badErr)}`);
    expect(badErr).toMatch(/not a valid page or range/);
    await win.fill('[data-print-range-input]', '1-2');
    expect(await win.locator('[data-print-range-error]').count(), 'error clears on a valid range').toBe(0);

    // --- 10. odd/even + reverse change count and order --------------------
    await win.click('[data-print-range-all]');
await win.selectOption('[data-print-odd-even]', 'odd');
    expect(await meta(win), 'odd-only halves the 34-page doc').toBe(`17 pages ${MIDDOT} 17 sheets`);
    // Screenshot 2: the odd-only range effect on the preview meta.
    await win.waitForTimeout(400);
    await win.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-sweep-range-oddeven.png'),
    });
    await win.selectOption('[data-print-odd-even]', 'even');
    expect(await meta(win), 'even-only halves the 34-page doc').toBe(`17 pages ${MIDDOT} 17 sheets`);
    await win.selectOption('[data-print-odd-even]', 'all');
    expect(await meta(win), 'all restores the full count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );

    // Reverse changes the ORDER: the first preview page becomes the last.
    await win.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    const firstAlt = await win.getAttribute('[data-print-preview] img', 'alt');
    console.log(`[P30sweep] first preview alt before reverse=${firstAlt}`);
    expect(firstAlt, 'first preview page is page 1').toBe('Page 1');
    await win.click('[data-print-reverse]');
    await win.waitForFunction(
      (want) => {
        const img = document.querySelector('[data-print-preview] img');
        return img !== null && img.getAttribute('alt') === want;
      },
      `Page ${pageCount}`,
      { timeout: 20000 },
    );
    const revAlt = await win.getAttribute('[data-print-preview] img', 'alt');
    console.log(`[P30sweep] first preview alt after reverse=${revAlt}`);
    expect(revAlt, 'reverse makes the last page preview first').toBe(`Page ${pageCount}`);
    await win.click('[data-print-reverse]');

    // --- 9. N-up + page order -> preview sheet arrangement ----------------
    expect(await win.locator('[data-print-page-order]').isDisabled(), 'page order disabled at 1-up').toBe(true);
    await win.selectOption('[data-print-nup]', '4');
    expect(await cellCount(win), '4-up preview has four cells').toBe(4);
    const s4 = await sheetStyle(win);
    console.log(`[P30sweep] 4-up style=${JSON.stringify(s4)}`);
    expect(s4.cols, '4-up grid is 2 columns').toBe('repeat(2, 1fr)');
    expect(s4.rows, '4-up grid is 2 rows').toBe('repeat(2, 1fr)');
    expect(await win.locator('[data-print-page-order]').isDisabled(), 'page order enabled above 1-up').toBe(false);
    expect(await meta(win), '4-up sheet count is ceil(34/4)').toBe(`34 pages ${MIDDOT} 9 sheets`);

    await win.selectOption('[data-print-page-order]', 'vertical');
    expect((await sheetStyle(win)).flow, 'vertical order flows by column').toBe('column');
    await win.selectOption('[data-print-page-order]', 'horizontalReversed');
    expect((await sheetStyle(win)).dir, 'horizontal reversed sets rtl').toBe('rtl');
    await win.selectOption('[data-print-page-order]', 'horizontal');
    expect((await sheetStyle(win)).flow, 'horizontal order flows by row').toBe('row');

    // Screenshot 1: a 4-up preview.
    await win.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    await win.waitForTimeout(600);
    await win.locator('[data-print-preview]').screenshot({
      path: path.join(SHOTS, 'phase30-sweep-nup.png'),
    });

// --- 12. confirm disabled with no printer (running case: unit test) ---
    await stubPrinters(app, 'empty');
    await closeDialog(win);
    await openDialog(win);
    await win.waitForSelector('[data-print-empty]', { state: 'visible', timeout: 8000 });
    expect(await win.locator('[data-print-confirm]').isDisabled(), 'Print disabled with no printer').toBe(true);
    await closeDialog(win);
    await restorePrinters(app);

    // --- 13. cancel closes; progress/error regions wired ------------------
    await openDialog(win);
    expect(await win.locator('[data-print-progress]').count(), 'progress absent when idle').toBe(0);
    expect(await win.locator('[data-print-error]').count(), 'error absent when idle').toBe(0);
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
    expect(await win.locator('[data-print-printer]').count(), 'Cancel closed the dialog').toBe(0);
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
    await win.click('[data-print]');
    await win.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    const firstRasterMs = Date.now() - t0;
    console.log(`[P30sweep] TIMING 34-page first preview raster = ${firstRasterMs}ms`);
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });

    // --- responsiveness: force a longer raster (16-up) and interact --------
    await win.selectOption('[data-print-nup]', '16');
    let caught = false;
    try {
      await win.waitForSelector('[data-print-preview] .print-preview-placeholder', {
        state: 'visible',
        timeout: 4000,
      });
      caught = true;
    } catch {
      caught = false;
    }
    console.log(`[P30sweep] mid-raster placeholder caught=${caught}`);

    // rAF frame-gap probe while the 16-page raster is in flight.
    const probe = await win.evaluate(async (duration) => {
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
    await win.selectOption('[data-print-duplex]', 'shortEdge');
    expect(await win.inputValue('[data-print-duplex]'), 'duplex toggle responded mid-raster').toBe('shortEdge');

    // Cancel reacts mid-raster and closes the dialog.
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
    expect(await win.locator('[data-print-printer]').count(), 'Cancel closed mid-raster').toBe(0);
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
    await win.click('[data-print]');
    await win.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    const firstRasterMs = Date.now() - t0;
    console.log(`[P30sweep] TIMING 1-page first preview raster = ${firstRasterMs}ms`);
    await closeDialog(win);
  } finally {
    await hardClose(app, 'p30sweep4');
  }
});
