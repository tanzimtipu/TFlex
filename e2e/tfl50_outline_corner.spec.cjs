// TFL-50 — the left Pages/Outline panel's bottom-right corner must render SQUARE.
//
// TFL-58 removed the declaration `border-radius: 0 0 var(--panel-radius) 0;`
// from the `.context-panel` rule in src/renderer/styles.css. This spec is the
// RENDERED oracle: it opens the report.pdf sample, expands the Outline section,
// then reads the panel's computed `border-bottom-right-radius` and asserts it
// resolves to `0px` (all four corners square). Mirrors the canonical launch
// pattern in e2e/phase59_outline_flush.spec.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

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
  if (app) await hardClose(app, 'tfl50-outline');
  app = null;
  win = null;
});

async function openReport() {
  const filePath = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function ensureOutlineExpanded() {
  // Phase 111 (chunk A) retired the collapsible Outline section: the Outline is
  // now a full-height navigator VIEW selected by the view tab. Selecting it is
  // the live disclosure action; the section is readable via its live view hook.
  const view = win.locator('[data-context-panel-view="outline"]');
  if ((await view.count()) === 0) {
    await win.locator('[data-context-panel-view-tab="outline"]').click();
    await win.waitForTimeout(600);
  }
  await expect(view).toHaveCount(1);
}

test('the Outline/PAGES panel bottom-right corner renders square (0px)', async () => {
  await openReport();
  await ensureOutlineExpanded();

  const radius = await win.evaluate(() => {
    const panel = document.querySelector('[data-context-panel]');
    return getComputedStyle(panel).borderBottomRightRadius;
  });
  console.log(`[TFL-50] computed borderBottomRightRadius=${radius}`);
  expect(radius, 'rendered panel bottom-right corner is square').toBe('0px');

  await win.screenshot({ path: path.join(SHOTS, 'tfl50-outline-corner.png') });
});
