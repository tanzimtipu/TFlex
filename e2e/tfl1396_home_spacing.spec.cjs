// TFL-1396 (Phase 121 chunk B) - focused QA verification of the Home stack gap.
//
// Proves the Home drop zone ([data-intake-dropzone]) clears the editable tool
// row above it ([data-home-tools]) by at least the documented minimum (16px)
// with no overlap, at the default window size AND at the app minimum window
// size. The fix under test is CSS-only:
//   .welcome-intake { margin-top: var(--space-stack-min); }  (16px = --sp-4)
//
// Launches ONLY through the canonical e2e/lib/launch.cjs `launchApp` helper.
// Captures before/after-default + after-min screenshots under screenshots/.
// QA evidence only - nothing is committed.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);

const GAP_MIN = 16;

// Measure the tool-row -> drop-zone geometry plus the wrapper's computed
// margin-top, entirely in-page against the real rendered DOM.
async function measureGap(win) {
  return win.evaluate(() => {
    const tools = document.querySelector('[data-home-tools]');
    const drop = document.querySelector('[data-intake-dropzone]');
    const intake = document.querySelector('[data-home-intake]');
    const toolsBottom = tools.getBoundingClientRect().bottom;
    const dropTop = drop.getBoundingClientRect().top;
    return {
      toolsBottom,
      dropTop,
      gap: dropTop - toolsBottom,
      computedMarginTop: intake ? getComputedStyle(intake).marginTop : null,
    };
  });
}

test('TFL-1396 Home drop zone clears the tool row by >= 16px at default and minimum size', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
    await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
    await win.waitForSelector('[data-home-intake]', { timeout: 30000 });
    await win.waitForSelector('[data-intake-tray]', { timeout: 30000 });
    await win.waitForSelector('[data-intake-dropzone]', { timeout: 30000 });

    // ---- DEFAULT size (window launches maximized on this host) ----
    const after = await measureGap(win);
    await win.screenshot({ path: shotPath('tfl1396-after-default.png') });

    // ---- BEFORE state: remove the fix in-page to reproduce the pre-fix gap ----
    const dropPair = await win.evaluate(() => {
      const intake = document.querySelector('[data-home-intake]');
      const tools = document.querySelector('[data-home-tools]');
      const drop = document.querySelector('[data-intake-dropzone]');
      intake.style.marginTop = '0px';
      const toolsBottom = tools.getBoundingClientRect().bottom;
      const dropTop = drop.getBoundingClientRect().top;
      return { gap: dropTop - toolsBottom, computedMarginTop: getComputedStyle(intake).marginTop };
    });
    await win.screenshot({ path: shotPath('tfl1396-before-default.png') });
    await win.evaluate(() => {
      document.querySelector('[data-home-intake]').style.marginTop = '';
    });

    // ---- MINIMUM window size ----
    const min = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
      );
      return w ? w.getMinimumSize() : null;
    });
    const minPair = Array.isArray(min) && min.length === 2 && min[0] > 0 && min[1] > 0
      ? min
      : [960, 640];

    // Unmaximize first: setSize is ignored while maximized.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
      );
      if (w && w.isMaximized()) w.unmaximize();
    });
    await win.waitForTimeout(350);
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
      );
      if (w) w.setSize(size[0], size[1]);
    }, minPair);
    await win.waitForTimeout(300);

    const afterMin = await measureGap(win);
    await win.screenshot({ path: shotPath('tfl1396-after-min.png') });

    // ---- ONE JSON probe ----
    const probe = {
      gapMin: GAP_MIN,
      default: {
        gap: after.gap,
        overlap: after.dropTop < after.toolsBottom,
        computedMarginTop: after.computedMarginTop,
        toolsBottom: after.toolsBottom,
        dropTop: after.dropTop,
      },
      before: { gap: dropPair.gap, computedMarginTop: dropPair.computedMarginTop },
      minimum: {
        minPair,
        gap: afterMin.gap,
        overlap: afterMin.dropTop < afterMin.toolsBottom,
        computedMarginTop: afterMin.computedMarginTop,
        toolsBottom: afterMin.toolsBottom,
        dropTop: afterMin.dropTop,
      },
    };
    console.log(`[TFL-1396] ${JSON.stringify(probe)}`);

    // ---- Assertions ----
    expect(probe.default.gap, 'default gap >= 16').toBeGreaterThanOrEqual(GAP_MIN);
    expect(probe.default.overlap, 'default no overlap').toBe(false);
    expect(parseFloat(probe.default.computedMarginTop), 'default computed margin-top >= 16').toBeGreaterThanOrEqual(GAP_MIN);
    expect(probe.minimum.gap, 'minimum gap >= 16').toBeGreaterThanOrEqual(GAP_MIN);
    expect(probe.minimum.overlap, 'minimum no overlap').toBe(false);
    expect(parseFloat(probe.minimum.computedMarginTop), 'minimum computed margin-top >= 16').toBeGreaterThanOrEqual(GAP_MIN);
    // The A/B must be explicit: the fix closes the pre-fix gap.
    expect(probe.before.gap, 'pre-fix gap is smaller than the fixed gap').toBeLessThan(probe.default.gap);
  } finally {
    await hardClose(app, 'tfl1396-home-spacing');
  }
});
