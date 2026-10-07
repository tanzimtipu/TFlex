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
    // its own View Strip) mounted, so a bare querySelector would read the first
    // (inactive) document's controls.
    //
    // Phase 109 (chunk A) retired the floating `[data-zoom-pill]` and moved the
    // viewing controls into the unified View Strip footer `[data-view-strip]`;
    // the Fit page / Fit width toggles carry the SAME aria-labels there.
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') ?? document;
    const fitPage = pane.querySelector('[data-view-strip] button[aria-label="Fit page"]');
    const fitWidth = pane.querySelector('[data-view-strip] button[aria-label="Fit width"]');
    return {
      mode: d.mode,
      zoom: d.zoom,
      fitPagePressed: fitPage ? fitPage.getAttribute('aria-pressed') : null,
      fitWidthPressed: fitWidth ? fitWidth.getAttribute('aria-pressed') : null,
    };
  });
}

// Fit Page must not merely mark the mode: the canonical page has to FIT the
// usable canvas width AND sit centred in it. Measured from the live DOM
// geometry of the current pane (never inferred from a CSS/token value).
async function fitGeometry(pageNum) {
  return win.evaluate((n) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') ?? document;
    const scroller = pane.querySelector('.document-scroller');
    const slot = pane.querySelector(`.page-slot[data-page="${n}"]`);
    if (scroller === null || slot === null) return null;
    const sr = scroller.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    // clientWidth excludes the webkit scrollbar; clientLeft is the border.
    const left = Math.round(r.left - sr.left - scroller.clientLeft);
    return {
      leftGap: left,
      rightGap: Math.round(scroller.clientWidth - left - r.width),
      pageW: Math.round(r.width),
      viewW: scroller.clientWidth,
      fitsWidth: r.width <= scroller.clientWidth + 2,
    };
  }, pageNum);
}

test('a document opens at Fit page; a zoom change is honoured; the next document opens at Fit page again', async () => {
  // 1. First document opens at Fit page.
  await openSample('report.pdf');
  const first = await zoomState();
  console.log(`[P59-fitpage] first doc=${JSON.stringify(first)}`);
  expect(first.mode, 'first document opens at fit-page').toBe('fit-page');
  expect(first.fitPagePressed, 'the Fit page toggle is active').toBe('true');
  expect(first.fitWidthPressed, 'the Fit width toggle is not active').toBe('false');

  // 1b. Fit Page actually FITS and RECENTERS the canonical page (page 1), not
  //     merely flips the mode flag.
  const pageNow = await win
    .locator('.tab-pane[aria-hidden="false"] input.page-input[aria-label="Current page"]')
    .first()
    .inputValue();
  expect(pageNow, 'the canonical (current) page after open is page 1').toBe('1');
  const fit = await fitGeometry(1);
  console.log(`[P59-fitpage] fit geometry page1=${JSON.stringify(fit)}`);
  expect(fit, 'Fit Page page geometry is measurable').not.toBeNull();
  expect(fit.fitsWidth, 'Fit Page fits the canonical page to the canvas width').toBe(true);
  expect(
    Math.abs(fit.leftGap - fit.rightGap),
    'Fit Page recenters the canonical page in the canvas',
  ).toBeLessThanOrEqual(4);
  await win.screenshot({ path: path.join(SHOTS, 'p59-fitpage-first.png') });

  // 2. Change the zoom (Zoom in) -> manual; the change is honoured.
  await win.locator('.tab-pane[aria-hidden="false"] [data-view-strip] button[aria-label="Zoom in"]').click();
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
