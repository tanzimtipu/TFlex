// DEF-342 focused regression (QA, Phase 38 migration; updated for TFL-1570):
// switching to a tab while the EDIT stage is active used to reset edit mode
// while the Stage Rail kept showing EDIT, and re-selecting EDIT did not
// re-enable it (the stage effect only fired on a stage CHANGE). The fix re-runs
// the stage effect whenever the active stage becomes applicable again, so the
// edit surface returns.
//
// TFL-1570 made the stage PER TAB (`StageState.perTab`): a newly opened tab
// starts on the default stage (PAGES) and each tab remembers its own stage.
// This spec therefore pins the fix through a real TAB SWITCH — tab A in EDIT,
// switch to a freshly opened tab B (PAGES), switch back to A — the EDIT stage
// and its edit mode must return while B stays on PAGES.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const log = (label, obj) => console.log(`[DEF342] ${label} ${JSON.stringify(obj)}`);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def342');
  app = null;
  win = null;
});
test.setTimeout(180000);

const state = () => win.evaluate(() => ({
  stage: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') ?? null,
  // Phase 41 (item 2) — the legacy edit toolbar is retired; the edit layer
  // (mounted only while edit mode is on and a tool is armed) is the observable.
  editLayer: document.querySelectorAll('.edit-layer').length,
}));

// Arm the edit-text tool through the EDIT dock. When edit mode is OFF the
// handler is a no-op, so the edit layer stays unmounted — a faithful probe of
// "is edit mode on in the EDIT stage".
async function armEditText() {
  const verb = win.locator('[data-dock-verb="editText"]');
  if ((await verb.count()) > 0) {
    await verb.click();
    await win.waitForTimeout(400);
  }
}

test('DEF-342: EDIT stage returns its edit mode after a tab switch (fixed)', async () => {
  // Tab A = report.pdf. Phase 118: generic Open enqueues into Intake, so drive
  // the current shared helper (real Open control + Intake Tray Open button).
  const report = getSamplePath('report.pdf');
  await openSamplePath(win, app, report);
  await win.waitForTimeout(1000);

  // Enter EDIT in tab A: the stage is the switch, so edit mode turns on.
  await win.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(600);
  await armEditText();
  const inEdit = await state();
  log('in-edit', inEdit);
  expect(inEdit.stage, 'the EDIT stage is active').toBe('edit');
  expect(inEdit.editLayer, 'entering EDIT enables edit mode (the edit layer mounts)').toBeGreaterThan(0);

  const tabA = await win.evaluate(() => {
    const el = document.querySelector('.tab-area [role="tab"][aria-selected="true"]');
    return el ? el.getAttribute('data-tab-id') : null;
  });
  expect(tabA, 'tab A is the active tab').not.toBeNull();

  // Open a SECOND document: TFL-1570 gives every new tab its own stage, so the
  // fresh tab B starts on the default stage (PAGES) and edit mode is off.
  const long = getSamplePath('long.pdf');
  await openSamplePath(win, app, long);
  await win.waitForTimeout(1200);
  const tabB = await state();
  log('tab-b', tabB);
  expect(tabB.stage, 'a newly opened tab starts on the default stage').toBe('pages');
  expect(tabB.editLayer, 'edit mode is off on the fresh tab').toBe(0);

  // Switch BACK to tab A: its own EDIT stage returns, and edit mode with it.
  await win.locator(`[data-tab-id="${tabA}"]`).click();
  await win.waitForTimeout(800);
  await armEditText();
  const afterSwitch = await state();
  log('after-switch', afterSwitch);
  expect(afterSwitch.stage, 'tab A still shows EDIT after switching away and back').toBe('edit');
  expect(afterSwitch.editLayer, 'edit mode returns when the tab in EDIT is re-activated').toBeGreaterThan(0);

  // Re-select the EDIT stage (already active): a no-op that must keep edit mode.
  await win.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(600);
  await armEditText();
  const afterReselect = await state();
  log('after-reselect', afterReselect);

  // Recover: a real stage change re-enables edit mode.
  await win.keyboard.press('Control+1');
  await win.waitForTimeout(400);
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(600);
  await armEditText();
  const afterCycle = await state();
  log('after-cycle', afterCycle);

  expect(afterReselect.stage, 're-selecting EDIT keeps the stage').toBe('edit');
  expect(afterReselect.editLayer, 're-selecting EDIT keeps edit mode').toBeGreaterThan(0);
  expect(afterCycle.editLayer, 'a real stage change keeps it').toBeGreaterThan(0);
});
