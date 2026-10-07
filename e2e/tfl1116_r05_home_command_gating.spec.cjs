// TFL-1116 C4 - R05 Home command capability gating.
// frontend-dev. Launches ONLY via the canonical e2e/lib/launch.cjs `launchApp`.
// Asserts document-only commands (Save / Save As / Close Tab / Undo / Redo /
// OCR / Find / Print) are ABSENT - not merely disabled - on Home, and present
// again once a document is active.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  // Fresh user-data dir => zero documents => Home.
  await win.waitForSelector('.welcome', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r05');
  app = null;
  win = null;
});

test.setTimeout(300000);

const count = (sel) => win.locator(sel).count();

const openSample = async () => {
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
};

test('R05 Case A - Home with zero documents hides document-only commands', async () => {
  // 1. File menu: Open + Merge remain; Save / Save As / Close Tab gone.
  await win.locator('[data-menu-button]').first().click();
  await win.waitForSelector('[data-menu-action="open"]', { timeout: 8000 });
  expect(await count('[data-menu-action="open"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="merge"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="save"]')).toBe(0);
  expect(await count('[data-menu-action="saveAs"]')).toBe(0);
  expect(await count('[data-menu-action="closeTab"]')).toBe(0);
  await win.screenshot({ path: shot('tfl1116_r05_home_menu.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // 2. Application menu: Preferences / Toggle Theme / About / Check for Update
  //    remain; Undo / Redo / Recognize Text gone.
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { timeout: 8000 });
  expect(await count('[data-menu-action="preferences"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="toggleTheme"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="about"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="checkForUpdate"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="undo"]')).toBe(0);
  expect(await count('[data-menu-action="redo"]')).toBe(0);
  expect(await count('[data-menu-action="recognizeText"]')).toBe(0);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // 3. Toolbar: Save / Save As / Print gone; Open stays.
  expect(await count('[data-toolbar-save]')).toBe(0);
  expect(await count('[data-toolbar-save-as]')).toBe(0);
  expect(await count('[data-print]')).toBe(0);
  expect(await count('[data-toolbar-open]')).toBe(1);
  await win.screenshot({ path: shot('tfl1116_r05_home_toolbar.png') });

  // 4. Keyboard routes are no-ops.
  await win.keyboard.press('Control+Shift+S');
  await win.waitForTimeout(500);
  expect(await count('[data-save-as-dialog]')).toBe(0);
  await win.keyboard.press('Control+Shift+R');
  await win.waitForTimeout(500);
  expect(await count('[data-ocr-confirm]')).toBe(0);
});

test('R05 Case B - an active document restores document-only commands', async () => {
  await openSample();

  // Toolbar inverse.
  expect(await count('[data-toolbar-save-as]')).toBe(1);
  expect(await count('[data-print]')).toBe(1);
  await win.screenshot({ path: shot('tfl1116_r05_document_toolbar.png') });

  // Application menu inverse.
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { timeout: 8000 });
  expect(await count('[data-menu-action="undo"]')).toBeGreaterThan(0);
  expect(await count('[data-menu-action="recognizeText"]')).toBeGreaterThan(0);
  await win.screenshot({ path: shot('tfl1116_r05_document_menu.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // Keyboard route works again.
  await win.keyboard.press('Control+Shift+S');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 8000 });
  expect(await count('[data-save-as-dialog]')).toBeGreaterThan(0);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
});

test('R05 Case C - background document behind an active Home tab still shows Home gating', async () => {
  await openSample();

  // Create a new empty tab; it becomes active while the document tab remains.
  await win.locator('[data-new-tab]').first().click();
  await win.waitForSelector('.welcome', { timeout: 8000 });

  expect(await count('[data-toolbar-save-as]')).toBe(0);
  expect(await count('[data-print]')).toBe(0);

  await win.keyboard.press('Control+Shift+S');
  await win.waitForTimeout(500);
  expect(await count('[data-save-as-dialog]')).toBe(0);
});

test('R05 Case D - Home behind an active empty tab hides document-only palette rows', async () => {
  await openSample();

  // The "document open BEHIND an active Home tab" state: `tabs.activeId` is
  // non-null (the empty tab) but there is no document on it.
  await win.locator('[data-new-tab]').first().click();
  await win.waitForSelector('.welcome', { timeout: 8000 });

  // Open the Command Palette (Ctrl+Shift+P).
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-palette-row]', { timeout: 8000 });

  // Document-only palette rows are ABSENT on Home (R05), not listed-disabled.
  expect(await win.locator('[data-palette-tool-id="save"]').count()).toBe(0);
  expect(await win.locator('[data-palette-tool-id="saveAs"]').count()).toBe(0);
  expect(await win.locator('[data-palette-tool-id="tabClose"]').count()).toBe(0);
  // Control: a Home-safe row survives, so the palette genuinely rendered.
  expect(await win.locator('[data-palette-tool-id="tabNew"]').count()).toBeGreaterThan(0);
  await win.screenshot({ path: shot('tfl1116_r05_home_palette.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // Inverse: with the document tab active the rows come back.
  await win.locator('[data-tab-id]').first().click();
  await win.waitForSelector('.workspace', { timeout: 8000 });
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-palette-row]', { timeout: 8000 });
  expect(await win.locator('[data-palette-tool-id="save"]').count()).toBeGreaterThan(0);
  expect(await win.locator('[data-palette-tool-id="saveAs"]').count()).toBeGreaterThan(0);
  expect(await win.locator('[data-palette-tool-id="tabClose"]').count()).toBeGreaterThan(0);
  await win.screenshot({ path: shot('tfl1116_r05_document_palette.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
});