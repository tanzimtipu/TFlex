// Phase 59 (item 6) — every document opens at Fit page.
//
// The assigned behaviour: opening ANY PDF starts at "Fit page" zoom, regardless
// of the previous document's zoom; the user's later zoom change is honoured
// until the next open.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

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
  if (app) await hardClose(app, 'p59-fitpage');
  app = null;
  win = null;
});

async function openSample(name) {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function zoomState() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    // Scope to the ACTIVE pane: every open tab keeps its own DocumentView (and
    // its own zoom pill) mounted, so a bare querySelector would read the first
    // (inactive) document's pill.
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') ?? document;
    const fitPage = pane.querySelector('[data-zoom-pill] button[aria-label="Fit page"]');
    const fitWidth = pane.querySelector('[data-zoom-pill] button[aria-label="Fit width"]');
    return {
      mode: d.mode,
      zoom: d.zoom,
      fitPagePressed: fitPage ? fitPage.getAttribute('aria-pressed') : null,
      fitWidthPressed: fitWidth ? fitWidth.getAttribute('aria-pressed') : null,
    };
  });
}

test('a document opens at Fit page; a zoom change is honoured; the next document opens at Fit page again', async () => {
  // 1. First document opens at Fit page.
  await openSample('report.pdf');
  const first = await zoomState();
  console.log(`[P59-fitpage] first doc=${JSON.stringify(first)}`);
  expect(first.mode, 'first document opens at fit-page').toBe('fit-page');
  expect(first.fitPagePressed, 'the Fit page pill is active').toBe('true');
  expect(first.fitWidthPressed, 'the Fit width pill is not active').toBe('false');
  await win.screenshot({ path: path.join(SHOTS, 'p59-fitpage-first.png') });

  // 2. Change the zoom (Zoom in) -> manual; the change is honoured.
  await win.locator('.tab-pane[aria-hidden="false"] [data-zoom-pill] button[aria-label="Zoom in"]').click();
  await win.waitForTimeout(500);
  const changed = await zoomState();
  console.log(`[P59-fitpage] after zoom-in=${JSON.stringify(changed)}`);
  expect(changed.mode, 'a manual zoom change leaves fit-page').toBe('manual');
  expect(changed.fitPagePressed, 'the Fit page pill is no longer active').toBe('false');

  // 3. Open a SECOND document -> it opens at Fit page again, independent of the
  //    first document's manual zoom.
  await openSample('long.pdf');
  const second = await zoomState();
  console.log(`[P59-fitpage] second doc=${JSON.stringify(second)}`);
  expect(second.mode, 'the second document opens at fit-page').toBe('fit-page');
  expect(second.fitPagePressed, 'the Fit page pill is active for the second document').toBe('true');
  await win.screenshot({ path: path.join(SHOTS, 'p59-fitpage-second.png') });
});
