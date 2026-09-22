// DEF-282 FIX-READY retest (qa, phase 33).
//
// The shared toolbar used to sit on top of the pane headers (the panes
// hard-coded `top: 0`), so `[data-pane-clear]`, the pane-header focus click
// and the strip-header focus click were pointer-unreachable. The fix drives the
// panes' top from the same measured `--tf-multi-toolbar-h` the divider reads.
//
// This spec measures the geometry at the default window size AND at the 640px
// minimum (where the bar may wrap), asserts zero overlap for BOTH panes and
// that the divider's vertical span matches the panes', then exercises the two
// gestures the defect broke. Launches only through the canonical launchApp.
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
      toolbarVar: stage ? getComputedStyle(stage).getPropertyValue('--tf-multi-toolbar-h').trim() : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      toolbar: rect('[data-shared-toolbar]'),
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
  expect(g.toolbar, `${label}: shared toolbar present`).not.toBeNull();
  expect(g.headerA, `${label}: pane A header present`).not.toBeNull();
  expect(g.headerB, `${label}: pane B header present`).not.toBeNull();
  expect(g.divider, `${label}: divider present`).not.toBeNull();
  // "above both panes": no overlap for either pane.
  expect(g.toolbar.bottom, `${label}: toolbar bottom ${g.toolbar.bottom} overlaps pane A header top ${g.headerA.top}`).toBeLessThanOrEqual(g.headerA.top);
  expect(g.toolbar.bottom, `${label}: toolbar bottom ${g.toolbar.bottom} overlaps pane B header top ${g.headerB.top}`).toBeLessThanOrEqual(g.headerB.top);
  // The panes start at the toolbar's bottom (adjacent, no gap, no drift).
  expect(Math.abs(g.paneA.top - g.toolbar.bottom), `${label}: pane A top not at toolbar bottom`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.paneB.top - g.toolbar.bottom), `${label}: pane B top not at toolbar bottom`).toBeLessThanOrEqual(1);
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

  // ---- 640px minimum width (the bar may wrap) --------------------------
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

  // 2. strip-header click focuses its pane
  await win.locator('[data-pane-strip-pane="B"] [data-pane-strip-header]').click({ timeout: 10000 });
  await win.waitForTimeout(400);
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused'), 'strip-header click focuses pane B').toBe('true');

  // 3. [data-pane-clear] in EACH pane header is clickable and empties the pane
  const clearA = win.locator('.tab-pane[data-pane="A"] [data-pane-clear]');
  expect(await clearA.isVisible(), 'pane A clear control visible').toBe(true);
  await clearA.click({ timeout: 10000 });
  await expect(win.locator('.tab-pane[data-pane="A"][data-pane-empty]'), 'pane A emptied by its clear control').toBeVisible({ timeout: 10000 });

  const clearB = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
  expect(await clearB.isVisible(), 'pane B clear control visible').toBe(true);
  await clearB.click({ timeout: 10000 });
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]'), 'pane B emptied by its clear control').toBeVisible({ timeout: 10000 });

  console.log('[DEF282] reachability OK: pane-header focus, strip-header focus, both clear controls');
});
