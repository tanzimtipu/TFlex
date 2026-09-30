// Phase 59 (item 7) — Ctrl+K palette gating + pruning.
//
// The assigned behaviour (Phase 59 item 7 / success criterion 7):
//   - with the Pages panel showing, "Page thumbnails" and "Bookmarks" are
//     ENABLED (not greyed) and their actions run;
//   - activating "Bookmarks" switches to the Pages stage and EXPANDS the
//     outline; activating "Page thumbnails" switches to the Pages stage and
//     collapses the outline back to the thumbnail stack;
//   - the 13 command-less registry rows are REMOVED from the palette corpus
//     (no dead row).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

// The 13 registry ids whose action has no command anywhere — the dead rows the
// operator asked us to remove from Ctrl+K (mirrors PALETTE_UNRUNNABLE_ACTIONS
// in src/renderer/state/commandPalette.ts).
const REMOVED_IDS = [
  'annotationsPanel',
  'pageContextMenu',
  'dragPage',
  'editDefaultFont',
  'annColor',
  'annPenWidth',
  'pageJump',
  'openRecent',
  'removeRecent',
  'openSample',
  'appMenu',
  'panePick',
  'paneResize',
];

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-palette');
  app = null;
  win = null;
});

async function openReport() {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function openPalette(query) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  if (query !== undefined) {
    await win.locator('[data-command-palette-input]').fill(query);
    await win.waitForTimeout(350);
  }
}

async function activeStage() {
  return win.evaluate(() => {
    const rail = document.querySelector('[data-stage-rail]');
    return rail ? rail.getAttribute('data-active-stage') : null;
  });
}

async function outlineOpen() {
  return win.evaluate(() => {
    const section = document.querySelector('[data-context-panel-outline]');
    return section ? section.getAttribute('data-outline-open') : null;
  });
}

test('Pages palette: Page thumbnails + Bookmarks are enabled and act; the 13 dead rows are gone', async () => {
  await openReport();

  // 1. The 13 removed rows are ABSENT from the palette corpus (empty query
  //    lists every row).
  await openPalette('');
  const present = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-palette-tool-id]')).map((el) =>
      el.getAttribute('data-palette-tool-id'),
    ),
  );
  console.log(`[P59-palette] listed tool rows=${present.length}`);
  const stillThere = REMOVED_IDS.filter((id) => present.includes(id));
  console.log(`[P59-palette] removed rows still present=${JSON.stringify(stillThere)}`);
  expect(stillThere, `dead rows still listed: ${stillThere.join(',')}`).toEqual([]);
  // The two wired rail rows ARE listed.
  expect(present).toContain('pageThumbnails');
  expect(present).toContain('outlinePanel');
  // Screenshot the palette with BOTH wired rows visible and enabled: scroll the
  // adjacent pair into view in the unfiltered list.
  await win.locator('[data-palette-tool-id="outlinePanel"]').first().scrollIntoViewIfNeeded();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'p59-palette-rows.png') });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-command-palette-input]', { state: 'detached', timeout: 8000 });

  // 2. "Bookmarks" is ENABLED and, from a non-Pages stage, switches to Pages
  //    and EXPANDS the outline.
  await gotoStage(win, 2); // EDIT
  expect(await activeStage(), 'start on the Edit stage').toBe('edit');
  await openPalette('Bookmarks');
  const bookmarks = win.locator('[data-palette-tool-id="outlinePanel"]').first();
  await bookmarks.waitFor({ state: 'visible', timeout: 8000 });
  expect(await bookmarks.getAttribute('data-palette-disabled'), 'Bookmarks enabled').toBe('false');
  await bookmarks.click();
  await win.waitForSelector('[data-command-palette-input]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(600);
  console.log(`[P59-palette] after Bookmarks: stage=${await activeStage()} outlineOpen=${await outlineOpen()}`);
  expect(await activeStage(), 'Bookmarks switches to the Pages stage').toBe('pages');
  expect(await outlineOpen(), 'Bookmarks expands the outline').toBe('true');

  // 3. "Page thumbnails" is ENABLED and, from a non-Pages stage, switches to
  //    Pages and collapses the outline back to the thumbnail stack.
  await gotoStage(win, 2); // EDIT
  expect(await activeStage(), 'start on the Edit stage again').toBe('edit');
  await openPalette('Page thumbnails');
  const thumbs = win.locator('[data-palette-tool-id="pageThumbnails"]').first();
  await thumbs.waitFor({ state: 'visible', timeout: 8000 });
  expect(await thumbs.getAttribute('data-palette-disabled'), 'Page thumbnails enabled').toBe('false');
  await thumbs.click();
  await win.waitForSelector('[data-command-palette-input]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(600);
  console.log(`[P59-palette] after Page thumbnails: stage=${await activeStage()} outlineOpen=${await outlineOpen()}`);
  expect(await activeStage(), 'Page thumbnails switches to the Pages stage').toBe('pages');
  expect(await outlineOpen(), 'Page thumbnails collapses the outline').toBe('false');
});
