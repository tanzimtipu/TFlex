// DEF-342 focused regression (QA, Phase 38 migration): opening/activating a tab
// while the EDIT stage is active used to reset edit mode while the Stage Rail
// kept showing EDIT, and re-selecting EDIT did not re-enable it (the stage
// effect only fired on a stage CHANGE). The fix re-runs the stage effect when a
// document arrives while the stage is already EDIT, so the edit toolbar returns.
// This spec now PINS the fixed behaviour (editToolbar === 1 after the reopen and
// after re-selecting EDIT).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

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
  // Pane = report.pdf.
  const report = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, report);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);

  // Enter EDIT: the stage is the switch, so edit mode turns on.
  await win.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(600);
  await armEditText();
  const inEdit = await state();
  log('in-edit', inEdit);
  expect(inEdit.stage, 'the EDIT stage is active').toBe('edit');
  expect(inEdit.editLayer, 'entering EDIT enables edit mode (the edit layer mounts)').toBeGreaterThan(0);

  // Close the only tab while in EDIT, then open a document again.
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  const afterClose = await state();
  log('after-close', afterClose);
  const long = getSamplePath('long.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, long);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(2000);
  await armEditText();
  const afterOpen = await state();
  log('after-open', afterOpen);

  // Re-select the EDIT stage (already active): a no-op.
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

  expect(afterOpen.stage, 'the rail still shows EDIT after the tab switch').toBe('edit');
  expect(afterOpen.editLayer, 'edit mode returns when a document arrives while the stage is EDIT').toBeGreaterThan(0);
  expect(afterReselect.editLayer, 're-selecting EDIT keeps edit mode').toBeGreaterThan(0);
  expect(afterCycle.editLayer, 'a real stage change keeps it').toBeGreaterThan(0);
});
