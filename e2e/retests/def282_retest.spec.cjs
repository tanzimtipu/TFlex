// DEF-282 FIX-READY retest (qa, phase 33; restated in Phase 36 chunk 7).
//
// The shared toolbar used to sit on top of the pane headers (the panes
// hard-coded `top: 0`), so `[data-pane-clear]`, the pane-header focus click
// and the strip focus click were pointer-unreachable. Phase 36 chunk 7 retired
// that row entirely: NOTHING is measured, the stage writes no toolbar-height
// variable, the panes own the stage from its top edge (top: 0), and the ONE
// shared Action Dock floats at the stage's BOTTOM (`.multi-dock-layer`), so its
// layer can never reach the header band.
//
// This spec measures that restated invariant at the default window size AND at
// the 640px minimum, asserts the divider's vertical span matches the panes',
// then exercises the gestures the defect broke. Launches only through the
// canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const { SHOTS, twoPaneSetup, focusPaneByPage } = require('../lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def282');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(900);
}

async function geometry() {
  return win.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    };
    const stage = document.querySelector('.tab-stage');
    return {
      // Phase 36 (chunk 7) — the measured toolbar-height offset is RETIRED: the
      // stage must not write `--tf-multi-toolbar-h` at all (nothing is measured,
      // so no offset can arrive after a paint).
      toolbarVar: stage ? getComputedStyle(stage).getPropertyValue('--tf-multi-toolbar-h').trim() : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      stage: rect('.tab-stage'),
      // The ONE shared Action Dock's zero-height bottom layer (Multi Mode only).
      dock: rect('[data-multi-dock-layer]'),
      headerA: rect('.tab-pane[data-pane="A"] [data-pane-header]'),
      headerB: rect('.tab-pane[data-pane="B"] [data-pane-header]'),
      paneA: rect('.tab-pane[data-pane="A"]'),
      paneB: rect('.tab-pane[data-pane="B"]'),
      divider: rect('[data-multi-divider]'),
    };
  });
}

function assertNoOverlap(g, label) {
  console.log(`[DEF282] ${label} geometry=${JSON.stringify(g)}`);
  expect(g.stage, `${label}: stage present`).not.toBeNull();
  expect(g.headerA, `${label}: pane A header present`).not.toBeNull();
  expect(g.headerB, `${label}: pane B header present`).not.toBeNull();
  expect(g.divider, `${label}: divider present`).not.toBeNull();
  // Phase 36 (chunk 7) restated invariant: the retired measured offset is gone,
  // so the stage writes no toolbar-height variable.
  expect(g.toolbarVar, `${label}: the stage still writes the retired --tf-multi-toolbar-h`).toBe('');
  // "above both panes": the panes (and therefore their headers) own the stage
  // from its top edge - no chrome band sits above them.
  expect(Math.abs(g.paneA.top - g.stage.top), `${label}: pane A is not at the stage top`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.paneB.top - g.stage.top), `${label}: pane B is not at the stage top`).toBeLessThanOrEqual(1);
  expect(g.headerA.top - g.stage.top, `${label}: pane A header is not at the stage top`).toBeLessThanOrEqual(1);
  expect(g.headerB.top - g.stage.top, `${label}: pane B header is not at the stage top`).toBeLessThanOrEqual(1);
  // The shared dock layer floats at the stage's BOTTOM, so it cannot reach
  // either pane-header band.
  expect(g.dock, `${label}: shared dock layer present in Multi Mode`).not.toBeNull();
  expect(g.dock.top, `${label}: dock layer reaches pane A header top ${g.headerA.top}`).toBeGreaterThanOrEqual(g.headerA.bottom - 1);
  expect(g.dock.top, `${label}: dock layer reaches pane B header top ${g.headerB.top}`).toBeGreaterThanOrEqual(g.headerB.bottom - 1);
  // The divider's vertical span matches the panes'.
  expect(Math.abs(g.divider.top - g.paneA.top), `${label}: divider top != pane A top`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.divider.top - g.paneB.top), `${label}: divider top != pane B top`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.divider.bottom - g.paneA.bottom), `${label}: divider bottom != pane A bottom`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.divider.bottom - g.paneB.bottom), `${label}: divider bottom != pane B bottom`).toBeLessThanOrEqual(1);
}

test('DEF-282 geometry at default + 640px, reachability, screenshot', async () => {
  await twoPaneSetup(app, win);
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  expect(await stage.getAttribute('data-multi-panes')).toBe('2');

  // ---- default window size ---------------------------------------------
  assertNoOverlap(await geometry(), 'default');

  // ---- 640px minimum width ---------------------------------------------
  await setSize(640, 800);
  assertNoOverlap(await geometry(), 'narrow-640');

  // back to the default size for the visual record
  await setSize(1440, 900);
  await win.waitForTimeout(400);

  // ---- the visual record (both documents loaded) -----------------------
  await win.screenshot({ path: path.join(SHOTS, 'phase33-multi-layout.png') });
  console.log('[DEF282] captured screenshots/phase33-multi-layout.png');

  // ---- reachability: the gestures the defect broke ---------------------
  // 1. pane-header click focuses its pane
  await focusPaneByPage(win, 'B');
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');
  await win.locator('.multi-pane-header[data-pane="A"]').click({ timeout: 10000 });
  await win.waitForTimeout(400);
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused'), 'pane-header click focuses pane A').toBe('true');

  // 2. strip focus: the Phase 33 strip is HEADERLESS (DEF-291), so a thumbnail
  //    click (jumpAndFocus) is the strip's focus path; it must focus its pane.
  const thumbB = win.locator('[data-pane-strip-pane="B"] .thumb-item').first();
  await thumbB.scrollIntoViewIfNeeded();
  await thumbB.click({ timeout: 10000 });
  await win.waitForTimeout(400);
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused'), 'strip thumbnail click focuses pane B').toBe('true');

  // 3. [data-pane-clear] in EACH pane header is clickable and empties the pane
  const clearA = win.locator('.tab-pane[data-pane="A"] [data-pane-clear]');
  expect(await clearA.isVisible(), 'pane A clear control visible').toBe(true);
  await clearA.click({ timeout: 10000 });
  await expect(win.locator('.tab-pane[data-pane="A"][data-pane-empty]'), 'pane A emptied by its clear control').toBeVisible({ timeout: 10000 });

  const clearB = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
  expect(await clearB.isVisible(), 'pane B clear control visible').toBe(true);
  await clearB.click({ timeout: 10000 });
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]'), 'pane B emptied by its clear control').toBeVisible({ timeout: 10000 });

  console.log('[DEF282] reachability OK: pane-header focus, strip-thumb focus, both clear controls');
});
