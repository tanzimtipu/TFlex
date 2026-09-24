// DEF-283 regression guard (qa, phase 33) — MIGRATED for Phase 37 item 17.
//
// Original repro (kept in DEFECTS.md history): the movable IN-APP print dialog
// clamped only during its HTML drag, so shrinking the window left it clipped
// and its Print/Close controls off-screen.
//
// Phase 37 REMOVED the in-app modal: the print surface is the STANDALONE print
// window, a separate top-level OS window. The observable contract this spec now
// guards is the same user-visible promise — the print controls are never
// clipped and stay actionable — now expressed against the independent window:
// shrinking the APP window must not affect the print window, and the print
// window's own Print action stays inside its own viewport and actionable at
// every size. It trial-clicks Print (NEVER a real print).
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const {
  hardClose,
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('../lib/helpers.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p37-def283');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function setMainWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('tfWindow=print'));
    if (bw) { bw.unmaximize(); bw.setSize(s[0], s[1]); }
  }, [w, h]);
  await win.waitForTimeout(900);
}

async function printWindowBounds() {
  return app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return pw ? { ...pw.getBounds(), id: pw.id } : null;
  });
}

/** Measure the print window's OWN viewport + the confirm action. */
async function measurePrint(printPage) {
  return printPage.evaluate(() => {
    const b = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const confirm = b('[data-print-confirm]');
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      confirm,
      confirmDisabled: (() => { const el = document.querySelector('[data-print-confirm]'); return el ? el.disabled : null; })(),
      offRight: confirm ? Math.round(confirm.right - window.innerWidth) : null,
      offBottom: confirm ? Math.round(confirm.bottom - window.innerHeight) : null,
    };
  });
}

async function trialClickConfirm(printPage) {
  try {
    await printPage.click('[data-print-confirm]', { timeout: 5000, trial: true });
    return { actionable: true, error: null };
  } catch (e) {
    return { actionable: false, error: String(e.message).split('\n')[0] };
  }
}

function insideViewport(m) {
  return m.offRight <= 0 && m.offBottom <= 0 && m.confirm.left >= 0 && m.confirm.top >= 0;
}

test('DEF-283 (migrated): shrinking the app window never clips the standalone print window; Print stays actionable', async () => {
  // Stub the printer list in MAIN so the print window's Print action is enabled
  // (geometry, not a disabled control, is what this spec measures).
  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (!map || typeof map.get !== 'function') throw new Error('listPrinters override unavailable');
    global.__p37origListPrinters = map.get('print:listPrinters');
    map.set('print:listPrinters', async () => ([
      { name: 'TFlex QA Bogus Printer', displayName: 'TFlex QA Bogus Printer', isDefault: true, status: 0 },
    ]));
  });

  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
  await setMainWindowSize(1440, 900);

  const printPage = await openStandalonePrintWindow(app, win);
  await expect(printPage.locator('[data-print-confirm]')).toBeEnabled({ timeout: 15000 });

  // Move the print window to its screen's bottom-right; it stays inside.
  await app.evaluate(({ BrowserWindow, screen }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const wa = screen.getPrimaryDisplay().workAreaSize;
    pw.setBounds({ x: wa.width - 840, y: wa.height - 880, width: 820, height: 860 });
  });
  await win.waitForTimeout(500);
  const base = await measurePrint(printPage);
  const baseClick = await trialClickConfirm(printPage);
  const baseBounds = await printWindowBounds();
  console.log(`[P37-DEF283] baseline print vp=${base.vw}x${base.vh} confirm=${JSON.stringify(base.confirm)} offRight=${base.offRight} offBottom=${base.offBottom} actionable=${baseClick.actionable} bounds=${JSON.stringify(baseBounds)}`);
  expect(insideViewport(base), 'baseline: the Print action is inside the print window viewport').toBe(true);
  expect(baseClick.actionable, 'baseline Print actionable').toBe(true);

  // Shrink the APP window: the independent print window must be unaffected.
  const sizes = [[1100, 760], [900, 620], [700, 560]];
  const results = [];
  for (const [w, h] of sizes) {
    await setMainWindowSize(w, h);
    const m = await measurePrint(printPage);
    const click = await trialClickConfirm(printPage);
    const visible = await printPage.locator('[data-print-confirm]').isVisible();
    results.push({ w, h, m, click, visible });
    console.log(`[P37-DEF283] app ${w}x${h}: print vp=${m.vw}x${m.vh} confirm=${JSON.stringify(m.confirm)} offRight=${m.offRight} offBottom=${m.offBottom} visible=${visible} actionable=${click.actionable} err=${click.error}`);
  }

  // Recovery: move the print window back to the top-left.
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    pw.setBounds({ x: 40, y: 60, width: 820, height: 860 });
  });
  await win.waitForTimeout(500);
  const afterRecover = await measurePrint(printPage);
  const recoverClick = await trialClickConfirm(printPage);
  console.log(`[P37-DEF283] recovery: confirm=${JSON.stringify(afterRecover.confirm)} actionable=${recoverClick.actionable}`);

  const clipped = results.filter((r) => !insideViewport(r.m));
  const notActionable = results.filter((r) => !r.click.actionable);
  console.log(`[P37-DEF283] SUMMARY clippedSizes=${clipped.length}/${results.length} notActionable=${notActionable.length}/${results.length} recoveredActionable=${recoverClick.actionable}`);

  expect(clipped.length, 'the Print action stays fully inside the print window at every app size').toBe(0);
  expect(notActionable.length, 'Print stays actionable after every app resize').toBe(0);
  expect(recoverClick.actionable, 'still actionable after a recovery move').toBe(true);

  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (global.__p37origListPrinters) map.set('print:listPrinters', global.__p37origListPrinters);
  }).catch(() => {});
  await closeStandalonePrintWindow(app, printPage);
});
