// TFL-520 phase-close QA (DEF-531) — real-app verification of the dock
// curation rule and the removable greyed row. Launches only through the
// canonical e2e/lib/launch.cjs. This spec is QA-owned; it does not modify any
// product or phase spec.
//
// Assigned behaviour (DEF-531):
//   1. the dock's plus picker offers ONLY the curated set for the stage
//      (stage dock ids + DOCK_GLOBAL_IDS), so the never-runnable globals are
//      absent;
//   2. a dock-pinnable tool that renders DISABLED in the active stage can be
//      removed via BOTH the edit-mode minus and the right-click Unpin.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const DOCK = '[data-action-dock]';

// dockPickerIdsForStage(stage) = the stage dock set (DOCK_STAGE_IDS) then
// DOCK_GLOBAL_IDS, per toolsRegistry. The picker only offers what the stage
// dock does NOT already render, so every offered id must be in this union.
const GLOBALS = ['undo', 'redo', 'openReadingView', 'openComicView'];
const ALLOWED = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete', 'merge', 'cropPages', ...GLOBALS],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects', ...GLOBALS],
  review: ['annotate', 'sign', 'stamp', 'flatten', 'forms', 'watermark', 'bates', 'exportComments',
    'importComments', 'fillFromCsv', 'exportFormData', 'importFormData', 'validateDocument',
    'sanitize', 'engineeringLayers', 'documentInfo', ...GLOBALS],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx', 'exportXlsx', 'exportPptx',
    'createFromImages', 'encrypt', ...GLOBALS],
};
const STAGES = [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']];
const FORBIDDEN = [
  'openSample', 'windowMaximize', 'windowMinimize', 'windowClose', 'toggleTheme',
  'preferences', 'save', 'saveAs', 'open', 'zoomIn', 'print',
];

test.setTimeout(240000);

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function dockEditOn(win) {
  if ((await win.locator(DOCK).getAttribute('data-dock-edit')) !== 'true') {
    await win.locator('[data-dock-overflow]').click();
    await win.waitForSelector('[data-dock-menu-item="customize"]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-dock-menu-item="customize"]').click();
    await win.waitForTimeout(400);
  }
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
}

async function pickerIds(win) {
  await win.locator('[data-dock-plus]').click();
  await win.waitForSelector('[data-dock-picker-item]', { timeout: 8000 });
  return win.$$eval('[data-dock-picker-item]', (els) =>
    els.map((e) => e.getAttribute('data-dock-picker-item')));
}

test('DEF-531 curated picker + disabled-row removal via minus and Unpin', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openReport(win);
    await dockEditOn(win);

    // ---- 1. Every stage's picker offers the curated set only ------------
    for (const [n, stage] of STAGES) {
      await gotoStage(win, n);
      await dockEditOn(win);
      const picker = await pickerIds(win);
      console.log(`[QA-DEF531] ${stage} picker items=${JSON.stringify(picker)}`);
      expect(picker.length, `${stage} picker offers at least one tool`).toBeGreaterThanOrEqual(1);
      for (const id of FORBIDDEN) {
        expect(picker, `${stage}: never-runnable global "${id}" is absent from the picker`).not.toContain(id);
      }
      for (const id of picker) {
        expect(ALLOWED[stage], `${stage}: picker id "${id}" is in the curated set`).toContain(id);
      }
      expect(picker, `${stage}: the curated globals are offered`)
        .toEqual(expect.arrayContaining(GLOBALS));
      if (stage === 'pages') {
        await win.screenshot({ path: path.join(SHOTS, 'p98-def531-pages-picker.png') });
      }
      // Close the picker (Escape exits edit mode and the picker).
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    }
    await dockEditOn(win);

    // ---- 2. A disabled pinnable row, removable via BOTH paths ------------
    await gotoStage(win, 3); // REVIEW
    await dockEditOn(win);
    const rows = await win.$$eval(`${DOCK} [data-dock-verb]`, (els) =>
      els.map((e) => ({ id: e.getAttribute('data-dock-verb'), disabled: e.disabled, title: e.getAttribute('title') })));
    console.log(`[QA-DEF531] review rows=${JSON.stringify(rows)}`);
    const greyed = rows.find((r) => r.id === 'forms' && r.disabled) || rows.find((r) => r.disabled);
    expect(greyed, 'the REVIEW stage renders a disabled (greyed) dock row').toBeTruthy();
    const id = greyed.id;
    console.log(`[QA-DEF531] greyed row id=${id} title="${greyed.title}"`);

    const minus = win.locator(`[data-dock-minus="${id}"]`);
    await expect(minus, 'the greyed row carries its own edit-mode minus badge').toHaveCount(1);
    await win.screenshot({ path: path.join(SHOTS, 'p98-def531-greyed-row.png') });

    // (a) remove via the edit-mode minus.
    await minus.click();
    await win.waitForTimeout(900);
    expect(await win.locator(`[data-dock-verb="${id}"]`).count(), 'minus removed the greyed row').toBe(0);
    console.log(`[QA-DEF531] removed "${id}" via edit-mode minus`);

    // re-add it through the picker -> it returns greyed.
    const readd = await pickerIds(win);
    expect(readd, `the removed "${id}" is offered again by the picker`).toContain(id);
    await win.locator(`[data-dock-picker-item="${id}"]`).click();
    await win.waitForTimeout(900);
    await expect(win.locator(`[data-dock-verb="${id}"]`)).toHaveCount(1);
    const reAdded = await win.locator(`[data-dock-verb="${id}"]`).evaluate((e) => ({ disabled: e.disabled, title: e.getAttribute('title') }));
    console.log(`[QA-DEF531] re-added "${id}" disabled=${reAdded.disabled} title="${reAdded.title}"`);
    expect(reAdded.disabled, 'the re-added row is greyed again in the active stage').toBe(true);

    // (b) remove via the right-click Unpin. Playwright's click refuses a
    // disabled control, so dispatch the contextmenu event itself (the DOM
    // event a real right-click delivers; React listens for it) at the verb's
    // centre so the portaled menu lands in the viewport.
    const greyBox = await win.locator(`[data-dock-verb="${id}"]`).boundingBox();
    await win.locator(`[data-dock-verb="${id}"]`).dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: greyBox.x + greyBox.width / 2,
      clientY: greyBox.y + greyBox.height / 2,
    });
    await win.waitForSelector('[data-dock-menu-item="unpin"]', { timeout: 8000 });
    // The portaled menu can sit off the Playwright-viewport even though it is
    // on screen; dispatch the click the menu item's own handler consumes.
    await win.locator('[data-dock-menu-item="unpin"]').dispatchEvent('click', { bubbles: true, cancelable: true });
    await win.waitForTimeout(900);
    expect(await win.locator(`[data-dock-verb="${id}"]`).count(), 'right-click Unpin removed the greyed row').toBe(0);
    console.log(`[QA-DEF531] removed "${id}" via right-click Unpin`);
  } finally {
    if (app) await hardClose(app, 'p98-def531');
  }
});
