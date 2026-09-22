// DEF-283 regression guard (qa, phase 33) — ADV-069 accepted, fix verified.
//
// Original repro (kept in DEFECTS.md history): the movable print dialog's clamp
// ran only inside onHeaderPointerMove (anchor captured at drag start). After
// dragging the panel to the bottom-right and then SHRINKING the window without
// reopening the dialog, the stored translate offset was never re-clamped, so the
// panel's right edge sat past the viewport and the Print/Close controls were
// off-screen and unclickable.
//
// The fix registers a `window` `resize` listener while the dialog is open and
// re-applies `clampDragOffset` to the stored offset against the live viewport.
// This spec now asserts the FIXED behaviour: after dragging to the bottom-right
// at 1440x900 and shrinking the WINDOW to 1100x760 / 900x620 / 700x560 (no
// reopen), the panel stays fully inside the viewport and `[data-print-confirm]`
// is actionable at every size. It trial-clicks Print (NEVER a real print).
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, openSamplePath } = require('../lib/helpers.cjs');
const { REPORT } = require('../lib/p33_common.cjs');
const P = require('../lib/p33_print.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def283');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { bw.unmaximize(); bw.setSize(s[0], s[1]); }
  }, [w, h]);
  await win.waitForTimeout(900);
}

async function measure() {
  return win.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
    };
    const dlg = r('.print-dialog');
    const confirm = r('[data-print-confirm]');
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      dialog: dlg,
      confirm,
      confirmDisabled: (() => { const el = document.querySelector('[data-print-confirm]'); return el ? el.disabled : null; })(),
      dragX: (() => { const el = document.querySelector('[data-print-dialog-shell]'); return el ? el.getAttribute('data-drag-x') : null; })(),
      dragY: (() => { const el = document.querySelector('[data-print-dialog-shell]'); return el ? el.getAttribute('data-drag-y') : null; })(),
      offRight: dlg ? Math.round(dlg.right - window.innerWidth) : null,
      offBottom: dlg ? Math.round(dlg.bottom - window.innerHeight) : null,
      offLeft: dlg ? Math.round(dlg.left) : null,
      offTop: dlg ? Math.round(dlg.top) : null,
    };
  });
}

async function trialClickConfirm() {
  try {
    await win.click('[data-print-confirm]', { timeout: 5000, trial: true });
    return { actionable: true, error: null };
  } catch (e) {
    return { actionable: false, error: String(e.message).split('\n')[0] };
  }
}

async function dragHeader(dx, dy) {
  const hb = await win.locator('[data-print-drag-handle]').boundingBox();
  if (hb === null) return false;
  // Grab a point on the header that is actually inside the viewport: when the
  // panel is clipped the header's CENTRE can itself be off-screen, but its
  // visible left part is still grabbable (as a real user would).
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const gx = Math.min(Math.max(hb.x + hb.width / 2, 20), vp.w - 20);
  const gy = Math.min(Math.max(hb.y + hb.height / 2, 20), vp.h - 20);
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + dx, gy + dy, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  return true;
}

/** The panel is fully inside the viewport (no edge past any side). */
function insideViewport(m) {
  return m.offRight <= 0 && m.offBottom <= 0 && m.offLeft >= 0 && m.offTop >= 0;
}

test('DEF-283: dialog re-clamps on window shrink; Print stays inside and actionable', async () => {
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);

  // Make the Print button genuinely enabled so "actionable" measures geometry,
  // not a disabled control (a printer-less box disables it by design).
  await win.evaluate(() => {
    window.tflex.listPrinters = async () => [
      { name: 'TFlex QA Bogus Printer', displayName: 'TFlex QA Bogus Printer', isDefault: true, status: 0 },
    ];
  });

  await setWindowSize(1440, 900);
  await P.openDialog(win);
  await win.waitForTimeout(500);
  await expect(win.locator('[data-print-confirm]')).toBeEnabled({ timeout: 15000 });

  // Drag hard to the bottom-right; the drag clamp holds it inside.
  const dragged = await dragHeader(6000, 6000);
  expect(dragged, 'drag handle present').toBe(true);
  const base = await measure();
  console.log(`[DEF283] baseline 1440x900 vp=${base.vw}x${base.vh} dialog=${JSON.stringify(base.dialog)} offRight=${base.offRight} offBottom=${base.offBottom} confirm=${JSON.stringify(base.confirm)} disabled=${base.confirmDisabled} drag=${base.dragX},${base.dragY}`);
  const baseClick = await trialClickConfirm();
  console.log(`[DEF283] baseline Print actionable=${baseClick.actionable} err=${baseClick.error}`);

  // The drag must actually have moved the panel, or the shrink assertions are vacuous.
  expect(Number(base.dragX), 'dialog was dragged horizontally').not.toBe(0);
  expect(Number(base.dragY), 'dialog was dragged vertically').not.toBe(0);
  expect(insideViewport(base), 'baseline panel fully inside the viewport').toBe(true);
  expect(baseClick.actionable, 'baseline Print actionable').toBe(true);

  const sizes = [[1100, 760], [900, 620], [700, 560]];
  const results = [];
  for (const [w, h] of sizes) {
    await setWindowSize(w, h);
    const m = await measure();
    const click = await trialClickConfirm();
    const visible = await win.locator('[data-print-confirm]').isVisible();
    results.push({ w, h, m, click, visible });
    console.log(`[DEF283] ${w}x${h} vp=${m.vw}x${m.vh} dialog=${JSON.stringify(m.dialog)} offRight=${m.offRight} offBottom=${m.offBottom} confirm=${JSON.stringify(m.confirm)} visible=${visible} actionable=${click.actionable} err=${click.error}`);
  }

  // Recovery: drag the header up-left at the smallest size.
  const beforeRecover = await measure();
  await dragHeader(-2000, -1200);
  const afterRecover = await measure();
  const recoverClick = await trialClickConfirm();
  console.log(`[DEF283] recovery: before=${JSON.stringify(beforeRecover.dialog)} after=${JSON.stringify(afterRecover.dialog)} offRight=${afterRecover.offRight} actionable=${recoverClick.actionable} err=${recoverClick.error}`);

  const clipped = results.filter((r) => !insideViewport(r.m));
  const notActionable = results.filter((r) => !r.click.actionable);
  console.log(`[DEF283] SUMMARY clippedSizes=${clipped.length}/${results.length} notActionable=${notActionable.length}/${results.length} recoveredActionable=${recoverClick.actionable}`);

  // The fix: after every shrink the panel is re-clamped fully inside the
  // viewport and the Print control stays actionable.
  expect(clipped.length, 'dialog stays fully inside the viewport after every shrink').toBe(0);
  expect(notActionable.length, 'Print stays actionable after every shrink').toBe(0);
  expect(recoverClick.actionable, 'panel still actionable after a recovery drag').toBe(true);
});