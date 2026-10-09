// TFL-1454 (TFL-1415 chunk A) — panel-resize tracking bug-hunt.
//
// Reproduces the TFL-1414 / TFL-1423 "panel resize trail" report: while a real
// pointer drags a panel separator, the panel EDGE does not track the pointer /
// handle, leaving a visible trail. The primary case is page view (a real
// document mounted in .workspace-main, single mode) with MULTIPLE document tabs.
//
// The spec drags the REAL separators ([data-panel-resize="left"] /
// [data-panel-resize="right"]) with the real mouse, sampling on every step the
// panel edge (getBoundingClientRect) and the handle bounding-box centre x, then
// asserts the max |edge - handleCentre| is <= 4px. Before the fix that
// assertion is RED because the workspace grid transitions --tf-rail-w (140ms)
// while the handle, a sibling on .app-main, reads the token instantly.
//
// A second describe block gathers the breadth matrix (1 tab / 2+ tabs / page
// layouts / Home / Book View / Multi Mode) as logged evidence. It runs first so
// the intentional acceptance failure cannot skip it. The matrix is reported in
// prose in the issue report, not as a second spec.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WIN_W = 1440;
const WIN_H = 900;
const MAX_DELTA_PX = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, b) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ width: b.width, height: b.height });
  }, { width, height });
  await sleep(700);
}

async function shot(win, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[tfl1415 shot] ${p}`);
  return p;
}

// Atomic sample of the panel edge and the handle centre. Reading both inside
// one evaluate avoids a round-trip between the two reads (which would itself
// skew a mid-transition comparison).
async function samplePanel(win, side) {
  return win.evaluate((s) => {
    const panelSel = s === 'left' ? '.context-panel' : '.inspector';
    const handleSel = `[data-panel-resize="${s}"]`;
    const panel = document.querySelector(panelSel);
    const handle = document.querySelector(handleSel);
    const pr = panel ? panel.getBoundingClientRect() : null;
    const hr = handle ? handle.getBoundingClientRect() : null;
    const edge = pr ? (s === 'left' ? pr.right : pr.left) : null;
    const centre = hr ? hr.left + hr.width / 2 : null;
    return {
      edge: edge === null ? null : Math.round(edge * 100) / 100,
      handleCentre: centre === null ? null : Math.round(centre * 100) / 100,
      delta: edge !== null && centre !== null ? Math.abs(edge - centre) : null,
      ariaValue: handle ? handle.getAttribute('aria-valuenow') : null,
      panelCount: document.querySelectorAll(panelSel).length,
      handleCount: document.querySelectorAll(handleSel).length,
    };
  }, side);
}

async function shellInfo(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return {
      tabCount: document.querySelectorAll('[data-animated-tab]').length,
      activeTabId: d ? d.activeTabId : null,
      contextPanels: document.querySelectorAll('.context-panel').length,
      inspectors: document.querySelectorAll('.inspector').length,
      leftHandles: document.querySelectorAll('[data-panel-resize="left"]').length,
      rightHandles: document.querySelectorAll('[data-panel-resize="right"]').length,
    };
  });
}

// Ensure the navigator and inspector are expanded so both separators mount.
async function ensurePanelsExpanded(win) {
  if ((await win.locator('[data-context-panel][data-context-panel-collapsed="true"]').count()) > 0) {
    await win.locator('[data-rail-collapse]').first().click();
    await sleep(500);
  }
  if ((await win.locator('[data-inspector][data-inspector-collapsed="true"]').count()) > 0) {
    await win.locator('[data-inspector-collapsed-strip] [data-inspector-collapse]').first().click();
    await sleep(500);
  }
}

// A REAL pointer drag on the separator: move to the handle centre, press, then
// N moves of `stepPx` with a short settle between steps. On every step sample
// (a) the panel edge and (b) the handle centre, both in one evaluate.
async function dragTrack(win, side, opts = {}) {
  const steps = opts.steps ?? 10;
  const stepPx = opts.stepPx ?? 12;
  const waitMs = opts.waitMs ?? 60;
  const handle = win.locator(`[data-panel-resize="${side}"]`).first();
  await expect(handle).toBeVisible({ timeout: 10000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`dragTrack: no bounding box for ${side} handle`);
  const startX = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const before = await samplePanel(win, side);

  await win.mouse.move(startX, y);
  await win.mouse.down();
  const samples = [];
  let midDone = false;
  for (let i = 1; i <= steps; i += 1) {
    await win.mouse.move(startX + stepPx * i, y);
    await win.waitForTimeout(waitMs);
    samples.push({ step: i, ...(await samplePanel(win, side)) });
    if (opts.onMidShot && !midDone && i === Math.ceil(steps / 2)) {
      midDone = true;
      await opts.onMidShot();
    }
  }
  const midSample = samples[Math.floor(samples.length / 2)];
  await win.mouse.up();
  await win.waitForTimeout(400);
  const after = await samplePanel(win, side);

  const deltas = samples.filter((s) => s.delta !== null).map((s) => s.delta);
  const maxDelta = deltas.length ? Math.max(...deltas) : null;
  return { side, startX, y, before, samples, midSample, after, maxDelta };
}

// Breadth probe: one short drag, logged (never throws). Returns whether the
// handle was present, whether the drag engaged, and the measured max delta.
async function probeShortDrag(win, label, side) {
  const info = await shellInfo(win);
  const present = (side === 'left' ? info.leftHandles : info.rightHandles) > 0;
  if (!present) {
    console.log(`[tfl1415 breadth] ${label} ${side}: handle ABSENT (n/a) panels=${info.contextPanels}/${info.inspectors} tabs=${info.tabCount}`);
    return { label, side, present: false, engaged: false, maxDelta: null, pass: null };
  }
  // Give the +x drag headroom: the left panel grows from its MIN, the right
  // panel shrinks from its MAX (a +x drag on the right handle shrinks it).
  await win.locator(`[data-panel-resize="${side}"]`).first().focus();
  await win.keyboard.press(side === 'left' ? 'Home' : 'End');
  await sleep(250);
  const r = await dragTrack(win, side, { steps: 6, stepPx: 10, waitMs: 60 });
  const engaged = r.after.ariaValue !== r.before.ariaValue;
  const pass = r.maxDelta !== null && r.maxDelta <= MAX_DELTA_PX;
  console.log(`[tfl1415 breadth] ${label} ${side}: present=true engaged=${engaged} maxDelta=${r.maxDelta} settledDelta=${r.after.delta} pass=${pass} width ${r.before.ariaValue}->${r.after.ariaValue}`);
  return { label, side, present: true, engaged, maxDelta: r.maxDelta, pass };
}

// One line summarising both separators for a state.
async function probeBoth(win, label) {
  const l = await probeShortDrag(win, label, 'left');
  const r = await probeShortDrag(win, label, 'right');
  return { label, left: l, right: r };
}

// ===========================================================================
// Breadth matrix (logged evidence; the prose matrix is in the issue report).
// Runs first and never throws so the intentional acceptance failure below can
// never skip it.
// ===========================================================================
test.describe('TFL-1415 breadth matrix', () => {
  let app;
  let win;
  test.setTimeout(300000);

  test.beforeAll(async () => {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await resize(app, WIN_W, WIN_H);
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    await ensurePanelsExpanded(win);
    await sleep(400);
  });

  test.afterAll(async () => {
    await hardClose(app, 'tfl1415-breadth');
  });

  test('breadth matrix across page view, layouts, tabs, Home, Book View, Multi Mode', async () => {
    const results = [];
    results.push(await probeBoth(win, 'page-view:1tab:one-page'));

    for (const mode of ['two', 'four', 'one']) {
      await win.locator(`[data-page-layout-option="${mode}"]:visible`).first().click();
      await sleep(500);
      results.push(await probeBoth(win, `page-view:1tab:${mode}-page`));
    }

    // A second document opens a second tab (the brief's primary state). The
    // generic Open replaces the ACTIVE tab, so create a fresh tab first.
    await win.locator('[data-new-tab]:visible').first().click();
    await sleep(600);
    await openSamplePath(win, app, getSamplePath('form.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    const info2 = await shellInfo(win);
    console.log(`[tfl1415 breadth] after 2nd open: tabs=${info2.tabCount} active=${info2.activeTabId}`);
    await ensurePanelsExpanded(win);
    results.push(await probeBoth(win, 'page-view:2tab:one-page'));

    // Multi Mode.
    await toggleMultiModeViaPalette(win);
    results.push(await probeBoth(win, 'multi-mode'));
    await toggleMultiModeViaPalette(win);

    // Home welcome: close every tab.
    for (let i = 0; i < 8; i += 1) {
      const close = win.locator('[data-animated-tab] .tab-close:visible');
      if ((await close.count()) === 0) break;
      await close.first().click().catch(() => {});
      await sleep(500);
    }
    await win.waitForSelector('.sample-card, .welcome', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    results.push(await probeBoth(win, 'home-welcome'));

    // Book View: reopen one document, then open Book View.
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    await ensurePanelsExpanded(win);
    await sleep(400);
    await win.locator('[data-book-view-open]:visible').first().click();
    await sleep(800);
    results.push(await probeBoth(win, 'book-view'));

    console.log(`[tfl1415 breadth matrix] ${JSON.stringify(results)}`);
  });
});

// ===========================================================================
// Acceptance: page view with 2+ tabs, real pointer drag on both separators.
// The <= 4px assertion is INTENTIONALLY RED before the fix; the measured
// deltas are the evidence of the TFL-1415 panel-resize trail.
// ===========================================================================
test.describe('TFL-1415 acceptance: page view + 2 tabs', () => {
  let app;
  let win;
  test.setTimeout(300000);

  test.beforeAll(async () => {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    // Open a SECOND document tab. The generic Open replaces the ACTIVE tab's
    // document, so create a fresh tab first, then open the fixture into it.
    await win.locator('[data-new-tab]:visible').first().click();
    await sleep(600);
    await openSamplePath(win, app, getSamplePath('form.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    const info = await shellInfo(win);
    console.log(`[tfl1415 accept] tabs=${info.tabCount} active=${info.activeTabId} panels=${info.contextPanels}/${info.inspectors} handles=${info.leftHandles}/${info.rightHandles}`);
    expect(info.tabCount, 'two document tabs are open').toBeGreaterThanOrEqual(2);
    // Re-focus the FIRST tab.
    await win.locator('[data-animated-tab] .tab').first().click();
    await sleep(800);
    await resize(app, WIN_W, WIN_H);
    await ensurePanelsExpanded(win);
    await sleep(500);
  });

  test.afterAll(async () => {
    await hardClose(app, 'tfl1415-accept');
  });

  test('panel edge tracks the pointer within 4px during a real drag (page view, 2 tabs)', async () => {
    const info0 = await shellInfo(win);
    console.log(`[tfl1415 accept] pre-drag ${JSON.stringify(info0)}`);
    expect(info0.leftHandles, 'left separator mounted').toBeGreaterThan(0);
    expect(info0.rightHandles, 'right separator mounted').toBeGreaterThan(0);

    // Left: grow from the MIN so the whole +x drag is in-range.
    await win.locator('[data-panel-resize="left"]').first().focus();
    await win.keyboard.press('Home');
    await sleep(250);
    await shot(win, 'tfl1415_left_drag_start.png');
    const left = await dragTrack(win, 'left', {
      steps: 10,
      stepPx: 12,
      waitMs: 50,
      onMidShot: () => shot(win, 'tfl1415_left_drag_mid.png'),
    });
    await shot(win, 'tfl1415_left_drag_end.png');
    console.log(`[tfl1415 accept] LEFT maxDelta=${left.maxDelta} settledDelta=${left.after.delta} width ${left.before.ariaValue}->${left.after.ariaValue} samples=${JSON.stringify(left.samples.map((s) => [s.step, s.edge, s.handleCentre, s.delta]))}`);

    // Right: shrink from the MAX (a +x drag on the right handle shrinks it).
    await win.locator('[data-panel-resize="right"]').first().focus();
    await win.keyboard.press('End');
    await sleep(250);
    await shot(win, 'tfl1415_right_drag_start.png');
    const right = await dragTrack(win, 'right', {
      steps: 10,
      stepPx: 12,
      waitMs: 50,
      onMidShot: () => shot(win, 'tfl1415_right_drag_mid.png'),
    });
    await shot(win, 'tfl1415_right_drag_end.png');
    console.log(`[tfl1415 accept] RIGHT maxDelta=${right.maxDelta} settledDelta=${right.after.delta} width ${right.before.ariaValue}->${right.after.ariaValue} samples=${JSON.stringify(right.samples.map((s) => [s.step, s.edge, s.handleCentre, s.delta]))}`);

    // The drag must have ENGAGED, else the tracking probe proves nothing.
    expect(left.after.ariaValue, 'left drag changed the panel width').not.toBe(left.before.ariaValue);
    expect(right.after.ariaValue, 'right drag changed the panel width').not.toBe(right.before.ariaValue);

    expect.soft(
      left.maxDelta,
      `LEFT max |edgeRight - handleCentreX| = ${left.maxDelta}px (budget ${MAX_DELTA_PX}px)`,
    ).toBeLessThanOrEqual(MAX_DELTA_PX);
    expect.soft(
      right.maxDelta,
      `RIGHT max |inspectorLeft - handleCentreX| = ${right.maxDelta}px (budget ${MAX_DELTA_PX}px)`,
    ).toBeLessThanOrEqual(MAX_DELTA_PX);
  });
});
