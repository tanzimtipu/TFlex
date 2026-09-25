// DEF-345 focused verification (QA, Phase 38): with a text run selected in EDIT,
// switching to PAGES must not leave an ENABLED text panel whose selection line
// says "page". ADV-089 found the panel persisted with the field enabled and
// typing was silently discarded. The fix gates the panel on the resolved
// selection kind (inspectorTextPanelForSelection), so a page selection renders
// no text panel.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const log = (label, obj) => console.log(`[DEF345] ${label} ${JSON.stringify(obj)}`);
let app = null;
let win = null;
test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def345');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function gotoStage(n) {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(450);
}
async function armViaPalette(search, id) {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill(search);
  await win.waitForTimeout(450);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await expect(row).toHaveCount(1);
  await row.click();
  await win.waitForTimeout(700);
}
async function selectRun() {
  const pageLoc = win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
  const pg = await (await pageLoc.count() ? pageLoc.first() : win.locator('.pdf-page[data-page="1"]').first()).boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42], [0.55, 0.5], [0.4, 0.62]];
  for (const [fx, fy] of fracs) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(550);
    const active = await win.evaluate(() => {
      const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
      return root.querySelector('[data-textrun-selection]') !== null;
    });
    if (active) return true;
  }
  return false;
}
const snapshot = () => win.evaluate(() => {
  const panel = document.querySelector('[data-inspector-text-panel]');
  const field = panel ? panel.querySelector('[data-txt-text]') : null;
  const insp = document.querySelector('[data-inspector]');
  return {
    selection: insp ? insp.getAttribute('data-inspector-selection') : null,
    panels: document.querySelectorAll('[data-inspector-text-panel]').length,
    fieldPresent: field !== null,
    fieldDisabled: field ? field.disabled : null,
    fieldValue: field ? field.value : null,
    fieldTitle: field ? field.getAttribute('title') : null,
    panelText: panel ? panel.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
  };
});

test('DEF-345 leaving EDIT for PAGES removes the text panel (no enabled field for a page selection)', async () => {
  const long = getSamplePath('long.pdf');
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, long);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await gotoStage(2);
  await armViaPalette('Edit text', 'editText');
  const selected = await selectRun();
  expect(selected, 'a text run is selectable in EDIT').toBe(true);
  await win.waitForTimeout(500);
  const atEdit = await snapshot();
  log('at-edit', atEdit);
  expect(atEdit.selection, 'EDIT: the Inspector selection is the text run').toBe('text');
  expect(atEdit.panels, 'EDIT: the text panel is present').toBe(1);
  expect(atEdit.fieldDisabled, 'EDIT: the field is enabled').toBe(false);

  // Switch to PAGES.
  await gotoStage(1);
  await win.waitForTimeout(1200);
  const atPages = await snapshot();
  log('at-pages', atPages);
  expect(atPages.selection, 'PAGES: the Inspector selection is the page').toBe('page');
  // The panel must be absent, or present-but-disabled with a reason.
  const absent = atPages.panels === 0;
  const disabledWithReason = atPages.panels > 0 && atPages.fieldPresent && atPages.fieldDisabled === true;
  expect(absent || disabledWithReason, `PAGES: no ENABLED text panel for a page selection (panels=${atPages.panels}, disabled=${atPages.fieldDisabled})`).toBe(true);

  // Typing must never be silently discarded: if an enabled field exists, typing
  // must persist; otherwise there is no enabled field to discard into.
  if (atPages.fieldPresent && atPages.fieldDisabled === false) {
    const before = atPages.fieldValue;
    await win.locator('[data-inspector-text-panel] [data-txt-text]').focus();
    await win.keyboard.type('ZZZ');
    await win.waitForTimeout(400);
    const after = await snapshot();
    log('typed', after);
    expect(after.fieldValue, 'typing into an enabled field is not silently discarded').not.toBe(before);
  } else {
    log('typed', { skipped: true, reason: absent ? 'panel absent' : 'field disabled' });
  }
});
