// Phase 116 (TFL-1228 chunk H, qa) - the Comments and Review Thread Stream.
//
// Drives the REAL app (canonical launchApp + openSamplePath native-picker helper)
// against a real bundled PDF and the real annotation tools. Covers the phase
// CONTROL-INDEX:
//   - list rows `[data-annotation-row]` (kind `[data-ann-kind]`, selection
//     `data-ann-selected` / aria-current);
//   - filter bar `[data-ann-filter]` (all + a real kind), filter/restore and
//     selection retention across a filter change;
//   - empty document `[data-annotation-empty]` + action `[data-ann-empty-action]`;
//     empty filtered result `[data-ann-filtered-empty]`;
//   - right inspector `[data-inspector-review-actions]`, `[data-ann-prop="color"]`,
//     `[data-ann-color-box]`, canvas selection -> `[data-annotation-row][aria-current]`;
//   - comment thread `[data-comment-entry]` after adding a comment via the box,
//     and list-level FDF actions `[data-ann-io="export"]` / `[data-ann-io="import"]`;
//   - delete affects ONLY the intended row;
//   - Bates / watermark / signature summaries render exactly once (`[data-review-category]`);
//   - selecting / filtering never recolors PDF pixels.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { getSamplePath } = require('./lib/launch.cjs');
const {
  launchDev,
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  armAnnotationTool,
  openAnnotationFlyout,
  openSamplePath,
  setTheme,
  slotBox,
} = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(240000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p116-thread-stream');
  app = null;
  win = null;
});

async function openReport() {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
}

async function dragOnPage(x1, y1, x2, y2) {
  const box = await slotBox(win, 1);
  expect(box, 'page slot 1 mounted').not.toBeNull();
  await win.mouse.move(box.x + box.w * x1, box.y + box.h * y1);
  await win.mouse.down();
  await win.mouse.move(box.x + box.w * x2, box.y + box.h * y2, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(800);
}

async function makeInk() {
  await openAnnotationFlyout(win);
  await armAnnotationTool(win, 'ink');
  await dragOnPage(0.35, 0.3, 0.55, 0.42);
  await win.keyboard.press('Escape');
}

async function makeRect() {
  await openAnnotationFlyout(win);
  await armAnnotationTool(win, 'rect');
  await dragOnPage(0.12, 0.12, 0.26, 0.2);
  await win.keyboard.press('Escape');
}

async function makeTextbox() {
  await openAnnotationFlyout(win);
  await armAnnotationTool(win, 'textbox');
  await dragOnPage(0.3, 0.5, 0.5, 0.58);
  await win.waitForTimeout(400);
}

async function reviewRows() {
  await gotoStage(win, 3);
  await ensurePanelExpanded(win);
  await win.waitForSelector('[data-annotation-panel]', { timeout: 10000 });
  await win.waitForSelector('[data-annotation-row]', { timeout: 10000 });
  return win.locator('[data-annotation-row]');
}

// Canvas selection of the ink shape drives `[data-annotation-row][aria-current]`.
async function selectInkOnPage() {
  const box = await slotBox(win, 1);
  await win.mouse.click(box.x + box.w * 0.45, box.y + box.h * 0.36);
  await win.waitForTimeout(600);
}

// Full canvas pixel snapshot (deterministic string), so a selection / filter
// that only changed DOM overlays leaves it byte-identical.
async function canvasData() {
  return win.evaluate(() => {
    const c = document.querySelector('.pdf-page[data-page="1"] canvas');
    return c ? c.toDataURL() : null;
  });
}

async function selectRectOnPage() {
  const box = await slotBox(win, 1);
  await win.mouse.click(box.x + box.w * 0.19, box.y + box.h * 0.16);
  await win.waitForTimeout(600);
}

test('P116-1: annotation rows render for 2+ annotations created via the tools', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeInk();
  await makeRect();

  const rows = await reviewRows();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toBeVisible();
  await expect(rows.nth(1)).toBeVisible();
  await expect(rows.filter({ has: win.locator('[data-ann-kind]') })).toHaveCount(2);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-rows.png') });
});

test('P116-2: filter bar filters, restores, and the selected row survives', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeInk();
  await makeRect();

  await reviewRows();
  await expect(win.locator('[data-ann-filter="all"]')).toBeVisible();
  await expect(win.locator('[data-ann-filter="ink"]')).toBeVisible();
  await expect(win.locator('[data-ann-filter="rect"]')).toBeVisible();
  await expect(win.locator('[data-annotation-row]')).toHaveCount(2);

  // Canvas selection of the ink shape.
  await selectInkOnPage();
  const inkRow = win.locator('[data-annotation-row]').filter({ has: win.locator('[data-ann-kind]', { hasText: 'Pen stroke' }) }).first();
  await expect(inkRow).toHaveAttribute('aria-current', 'true');
  await expect(inkRow).toHaveAttribute('data-ann-selected', 'true');

  // Filter to Rectangle: the ink row is removed from the list.
  await win.locator('[data-ann-filter="rect"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-annotation-row]')).toHaveCount(1);
  await expect(win.locator('[data-annotation-row] [data-ann-kind]').first()).toHaveText('Rectangle');
  await win.screenshot({ path: path.join(SHOTS, 'phase116-filter-highlight.png') });

  // Restore All: the ink row returns STILL selected.
  await win.locator('[data-ann-filter="all"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-annotation-row]')).toHaveCount(2);
  await expect(inkRow).toHaveAttribute('aria-current', 'true');
  await win.screenshot({ path: path.join(SHOTS, 'phase116-filter-all.png') });
});

test('P116-3: empty document state and empty filtered result are distinct', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();

  // report.pdf ships with no annotations.
  await gotoStage(win, 3);
  await ensurePanelExpanded(win);
  await expect(win.locator('[data-annotation-empty]')).toBeVisible();
  // CONTROL-INDEX row: success criterion 3 requires the empty explanation to
  // carry a working action that opens the annotation tools. Soft so the rest of
  // the state checks still produce evidence when the action is missing.
  await expect.soft(win.locator('[data-ann-empty-action]'), 'empty-document action [data-ann-empty-action]').toBeVisible();
  await win.screenshot({ path: path.join(SHOTS, 'phase116-empty-doc.png') });

  // Populate, filter to Ink, then delete the Ink row -> empty filtered result.
  await makeInk();
  await makeRect();
  await reviewRows();
  await win.locator('[data-ann-filter="ink"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-annotation-row]')).toHaveCount(1);
  await win.locator('[data-annotation-row]').first().locator('[aria-label^="Delete"]').click();
  await win.waitForTimeout(600);
  await expect(win.locator('[data-ann-filtered-empty]')).toBeVisible();
  await win.screenshot({ path: path.join(SHOTS, 'phase116-empty-filtered.png') });
});

test('P116-4: selected-annotation colour control plus the inspector scope', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeTextbox();
  await reviewRows();

  // The selected text annotation exposes the colour control (canvas action bar).
  const box = win.locator('[data-ann-color-box]').first();
  await expect(box).toBeVisible();
  const before = await box.getAttribute('data-color-current');

  // Open the picker and apply the built-in red.
  await box.click();
  await win.waitForSelector('[data-color-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-palette-built-in="red"]').click();
  await win.waitForTimeout(600);

  const after = await win.locator('[data-ann-color-box]').first().getAttribute('data-color-current');
  expect(after, 'applying red updates the colour swatch').toBe('#ef4444');
  expect(after, 'the colour actually changed').not.toBe(before);

  // CONTROL-INDEX: the RIGHT inspector owns the selected annotation's editable
  // properties. Soft so the colour evidence above survives if this scope is
  // missing (recorded separately).
  await expect.soft(win.locator('[data-inspector-review-actions]'), 'inspector review actions').toBeVisible();
  await expect.soft(win.locator('[data-ann-prop="color"]'), 'inspector colour row').toBeVisible();
  await win.screenshot({ path: path.join(SHOTS, 'phase116-inspector-color.png') });
});

test('P116-5: comment thread entry plus list-level FDF actions', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeInk();
  await reviewRows();

  // The list-level FDF actions live in the panel header.
  await expect(win.locator('[data-ann-io="export"]')).toBeVisible();
  await expect(win.locator('[data-ann-io="import"]')).toBeVisible();

  // Select the ink so its comment box is available, then add a comment.
  await selectInkOnPage();
  await win.waitForSelector('[data-comment-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-comment-input]').fill('Phase 116 QA comment.');
  await win.locator('[data-comment-submit]').click();
  await win.waitForTimeout(700);

  await expect(win.locator('[data-comment-entry]')).toHaveCount(1);
  await expect(win.locator('[data-comment-entry]').first()).toContainText('Phase 116 QA comment.');
  await win.screenshot({ path: path.join(SHOTS, 'phase116-comment-thread.png') });
});

test('P116-6: delete affects only the intended row', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeInk();
  await makeRect();
  await reviewRows();
  await expect(win.locator('[data-annotation-row]')).toHaveCount(2);

  const inkRow = win.locator('[data-annotation-row]').filter({ has: win.locator('[data-ann-kind]', { hasText: 'Pen stroke' }) }).first();
  await inkRow.locator('[aria-label^="Delete"]').click();
  await win.waitForTimeout(700);

  await expect(win.locator('[data-annotation-row]')).toHaveCount(1);
  await expect(win.locator('[data-annotation-row] [data-ann-kind]').first()).toHaveText('Rectangle');
  await win.screenshot({ path: path.join(SHOTS, 'phase116-delete-row.png') });
});

test('P116-7: document summaries render exactly once in the left navigator', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await gotoStage(win, 3);
  await ensurePanelExpanded(win);

  // The document-scope review navigator owns the ONLY bates / watermarks /
  // signatures categories; the Inspector's selection scope never repeats them.
  await expect(win.locator('[data-review-category="bates"]')).toHaveCount(1);
  await expect(win.locator('[data-review-category="watermarks"]')).toHaveCount(1);
  await expect(win.locator('[data-review-category="signatures"]')).toHaveCount(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-review-categories.png') });
});

test('P116-8: selecting and filtering never recolor PDF pixels', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeRect();
  await reviewRows();
  await win.waitForTimeout(500);

  const base = await canvasData();
  expect(base, 'page 1 canvas is present').toBeTruthy();

  await selectRectOnPage();
  await win.waitForTimeout(500);
  const afterSelect = await canvasData();
  expect(afterSelect, 'selecting an annotation must not recolor the page').toBe(base);

  await win.locator('[data-ann-filter="rect"]').click();
  await win.waitForTimeout(500);
  const afterFilter = await canvasData();
  expect(afterFilter, 'filtering must not recolor the page').toBe(base);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-no-recolor.png') });
});

test('P116-screenshots: full light/dark, compact, high contrast and 200%', async () => {
  ({ electronApp: app, window: win } = await launchDev());
  await openReport();
  await makeInk();
  await reviewRows();
  await win.waitForTimeout(400);

  const setSize = async (w, h) => app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size.w, size.h);
  }, { w, h });

  // Light, full width.
  await setTheme(win, 'light');
  await setSize(1440, 900);
  await win.waitForTimeout(900);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-full-light.png') });

  // Dark, full width.
  await setTheme(win, 'dark');
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-full-dark.png') });

  // Light, compact width.
  await setTheme(win, 'light');
  await setSize(900, 640);
  await win.waitForTimeout(900);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-compact-light.png') });

  // High contrast (forced-colors) at full width.
  await setSize(1440, 900);
  await win.emulateMedia({ forcedColors: 'active' });
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-highcontrast.png') });
  await win.emulateMedia({ forcedColors: 'none' });

  // 200% zoom.
  await win.evaluate(() => { document.documentElement.style.zoom = '200%'; });
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'phase116-zoom200.png') });
  await win.evaluate(() => { document.documentElement.style.zoom = '100%'; });
  await win.waitForTimeout(300);
});
