// TFL-1216 (chunk C4b, qa) - Activity Shelf app wiring + OCR path, phase e2e.
//
// This is the only writer of e2e/ for the phase. It drives the REAL app through
// the canonical launcher (e2e/lib/launch.cjs -> launchApp) and the real OCR
// affordance (command palette -> recognize text -> dialog confirm). It proves:
//
//   AC1  the window-level shelf summary appears WHILE the OCR run is in
//        progress and truthfully reports the running operation (progress role
//        + "Recognize text" active line). The OCR dialog is modal, so its scrim
//        sits above the shelf while running - the in-progress occlusion is
//        recorded as evidence rather than assumed;
//   AC2  the operation is not represented as both running and completed in
//        two widgets - exactly one summary, and the removed OCR completion
//        toast ("Recognized text on ...") is gone;
//   AC3  after the run settles the shelf IS the completion surface and can be
//        opened: one operation row reaches a terminal state and offers a
//        reachable View details action;
//   AC4  (blast radius) the offline OCR path still reaches the suspects panel.
//
// The fixture is a disposable copy of test-fixtures/scanned.pdf (never edit a
// source PDF). Screenshot: screenshots/tfl1216-c4b-activity-shelf.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const SHOT = path.join(SHOTS, 'tfl1216-c4b-activity-shelf.png');
const INPROGRESS_SHOT = path.join(SHOTS, 'tfl1216-c4b-activity-shelf-inprogress.png');

const OCR_DONE_MS = 240000;
const TERMINAL_STATES = ['completed', 'partial-success', 'failed', 'cancelled'];

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1216');
  app = null;
  win = null;
});

/** A disposable copy of a source fixture; never mutate test-fixtures/. */
function disposableFixture() {
  const src = path.join(ROOT, 'test-fixtures', 'scanned.pdf');
  const dir = path.join(os.tmpdir(), 'tfl1216-fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `scanned-${Date.now()}.pdf`);
  fs.copyFileSync(src, dst);
  return dst;
}

/**
 * Open a document through the app's real shared open path: main pushes an
 * `app:openPathRequest` (the exact event a launch-argv / second-instance open
 * uses), which the renderer routes through `openFromRequest` -> the shared
 * `routeOpenPath`. This is deterministic (no native-dialog or intake-queue
 * timing) while still exercising the shared path a user's OS "Open with"
 * uses; it replaced the dialog-override + Open-button click, whose intake
 * queue timing made the spec flaky while the tree was being edited.
 */
async function requestOpenPath(filePath) {
  await app.evaluate(({ BrowserWindow }, fp) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target) target.webContents.send('app:openPathRequest', fp);
  }, filePath);
}

async function openDoc(filePath) {
  await requestOpenPath(filePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

/** Open the real OCR affordance and choose the current page, but do not fire. */
async function openOcrDialog() {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'recognize');
  await win.waitForTimeout(300);
  await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
  await win.click('[data-ocr-scope="currentPage"]');
  await win.waitForTimeout(150);
}

async function toastTexts() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.toast .toast-text')).map((e) => e.textContent || ''),
  );
}

const legacyOcrToasts = (texts) => texts.filter((t) => t.includes('Recognized text on'));

test('TFL-1216 C4b: the Activity Shelf reports the OCR run; the removed toast is gone', async () => {
  await openDoc(disposableFixture());
  await openOcrDialog();

  // --- Fire the real OCR run -----------------------------------------------
  await win.click('[data-ocr-confirm]');

  // AC1: the shelf summary appears while the run is in progress. It only ever
  // renders from App's window-level activityShelfVisible (running op or an
  // unacknowledged/unexpired notice).
  await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 60000 });
  expect(
    await win.locator('[data-activity-shelf-summary]').count(),
    'AC1: exactly one window-level shelf summary is mounted',
  ).toBe(1);

  // The OCR dialog is modal (blockBackdropClose while running), so its scrim
  // (`.modal-backdrop`, z-index 800) sits above the shelf host (z-index 45).
  // The summary must still be present and truthfully report the running
  // operation; record the interaction surface so the occlusion is evidence,
  // not an assumption.
  const summaryRole = await win
    .locator('[data-activity-shelf-role]')
    .first()
    .getAttribute('data-activity-shelf-role');
  const summaryActive =
    (await win.locator('[data-activity-shelf-active]').first().textContent()) || '';
  console.log(
    `[TFL-1216 C4b] in-progress summary role=${summaryRole} active=${JSON.stringify(summaryActive)}`,
  );
  expect(summaryRole, 'AC1: the in-progress summary carries the running/progress role').toBe('progress');
  expect(summaryActive, 'AC1: the in-progress summary names the running OCR task').toContain('Recognize text');

  const occluded = await win.evaluate(() => {
    const el = document.querySelector('[data-activity-shelf-summary]');
    if (el === null) return { found: false };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      found: true,
      topTag: top ? top.tagName : null,
      topClass: top ? String(top.className) : null,
      selfOrChild: top !== null && (top === el || el.contains(top)),
    };
  });
  console.log(`[TFL-1216 C4b] in-progress occlusion probe=${JSON.stringify(occluded)}`);

  await win.screenshot({ path: INPROGRESS_SHOT });

  // AC2: not two widgets. Exactly one summary; and the legacy OCR completion
  // toast is not also present while the run is in progress.
  expect(await win.locator('[data-activity-shelf-summary]').count(), 'AC2: exactly one summary').toBe(1);
  expect(
    legacyOcrToasts(await toastTexts()),
    'AC2: the removed OCR completion toast ("Recognized text on ...") is not shown during the run',
  ).toEqual([]);

  // AC3: after the run settles the shelf is the completion surface.
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: OCR_DONE_MS });
  await win.waitForTimeout(400);

  // Hover the shelf so the success-notice auto-dismiss clock is frozen, then
  // make sure the panel is open (the modal OCR dialog has closed on settle, so
  // the backdrop no longer intercepts the shelf).
  await win.locator('.activity-shelf-host').hover();
  if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
    await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
    await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
  }
  const settledState = await win.locator('[data-activity-row]').first().getAttribute('data-activity-state');
  expect(
    TERMINAL_STATES,
    `AC3: the settled operation reached a terminal state (got ${settledState})`,
  ).toContain(settledState);
  expect(
    await win.locator('[data-activity-row]').count(),
    'AC3: still exactly one row after settle (no second widget)',
  ).toBe(1);
  expect(
    await win.locator('[data-activity-action="view-details"]').count(),
    'AC3: the completion notice offers a reachable View details action',
  ).toBeGreaterThan(0);
  expect(
    legacyOcrToasts(await toastTexts()),
    'AC3: the OCR completion toast is still gone after settle',
  ).toEqual([]);

  await win.screenshot({ path: SHOT });
  console.log(
    `[TFL-1216 C4b] in-progress role=${summaryRole} settled=${settledState} occluded=${JSON.stringify(occluded)} shot=${SHOT}`,
  );
});

// ---------------------------------------------------------------------------
// TFL-1216 (chunk C5, qa) - CONVERSION on the shelf. The non-modal conversion
// no longer has a standalone <ConversionProgress> widget; the Activity Shelf is
// the ONE running surface. Because the import is non-modal, the window-level
// summary must be reachable WHILE the conversion runs (no modal scrim above it),
// truthfully name the "Import" operation, and then settle to a terminal notice
// that offers only the declared actions (no show-in-folder, no undo).
// ---------------------------------------------------------------------------
const CONVERT_SHOT = path.join(SHOTS, 'tfl1216-c5-convert-shelf.png');
const CONVERT_INPROGRESS_SHOT = path.join(SHOTS, 'tfl1216-c5-convert-shelf-inprogress.png');

/** A disposable, deliberately large plain-text source (never a tracked fixture)
 *  so the .txt adapter takes long enough for the running summary to be sampled. */
function disposableTextFixture() {
  const dir = path.join(os.tmpdir(), 'tfl1216-fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `convert-${Date.now()}.txt`);
  const lines = [];
  for (let i = 0; i < 60000; i += 1) {
    lines.push(`Line ${i} of the disposable conversion fixture for the Activity Shelf.`);
  }
  fs.writeFileSync(dst, lines.join('\n'), 'utf8');
  return dst;
}

test('TFL-1216 C5: conversion runs on the shelf (non-modal summary reachable) and settles', async () => {
  const filePath = disposableTextFixture();

  await requestOpenPath(filePath);

  // Sample the running summary as early as possible.
  await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
  const earlyRole = await win
    .locator('[data-activity-shelf-role]')
    .first()
    .getAttribute('data-activity-shelf-role');
  const earlyActive =
    (await win.locator('[data-activity-shelf-active]').first().textContent()) || '';
  console.log(`[TFL-1216 C5] early summary role=${earlyRole} active=${JSON.stringify(earlyActive)}`);

  // AC: the summary names the conversion operation.
  expect(earlyActive, 'C5: the summary names the conversion operation').toContain('Import');

  if (earlyRole === 'progress') {
    // The conversion is non-modal: the summary is not occluded by any scrim.
    const reachable = await win.evaluate(() => {
      const el = document.querySelector('[data-activity-shelf-summary]');
      if (el === null) return { found: false };
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, selfOrChild: top !== null && (top === el || el.contains(top)) };
    });
    console.log(`[TFL-1216 C5] in-progress reachable=${JSON.stringify(reachable)}`);
    expect(reachable.selfOrChild, 'C5: the running summary is reachable (non-modal)').toBe(true);
    await win.screenshot({ path: CONVERT_INPROGRESS_SHOT });
  }

  // Settle: wait for the summary to leave the running role.
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-activity-shelf-role]');
    return el !== null && el.getAttribute('data-activity-shelf-role') !== 'progress';
  }, undefined, { timeout: 240000 });
  const settledRole = await win
    .locator('[data-activity-shelf-role]')
    .first()
    .getAttribute('data-activity-shelf-role');

  // Open the panel and inspect the terminal row + its offered actions.
  await win.locator('.activity-shelf-host').hover();
  if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
    await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
    await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
  }
  const rowState = await win.locator('[data-activity-row]').first().getAttribute('data-activity-state');
  const rowText = (await win.locator('[data-activity-row-text]').first().textContent()) || '';
  const actions = await win
    .locator('[data-activity-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-activity-action')));
  console.log(
    `[TFL-1216 C5] settled role=${settledRole} rowState=${rowState} text=${JSON.stringify(rowText)} actions=${JSON.stringify(actions)}`,
  );

  expect(rowState, 'C5: the conversion reached a terminal state').toBe('completed');
  expect(actions, 'C5: the terminal notice offers no show-in-folder').not.toContain('show-in-folder');
  expect(actions, 'C5: the terminal notice offers no undo').not.toContain('undo');
  expect(
    actions.some((a) => a === 'open-result' || a === 'view-details'),
    'C5: the terminal notice offers a declared action',
  ).toBe(true);

  await win.screenshot({ path: CONVERT_SHOT });
  console.log(`[TFL-1216 C5] shot=${CONVERT_SHOT}`);
});

// ---------------------------------------------------------------------------
// TFL-1216 (chunk C5b, qa) - SEARCH-INDEX on the shelf. The background
// page-index build (triggered by a real Find query on a text PDF) is the third
// producer. It reports a REAL page total, so progress is determinate `pages`;
// it has NO cancellation channel and declares `completionActions: []`. This
// test drives the real Find affordance (Ctrl+F -> "Search query"), proves the
// running row appears with determinate pages text, and opens the Activity panel
// to inspect the controls the row actually offers.
//
// A settlement only arrives when the query clears (`null` snapshot): the walk
// finishing at `built === total` is deliberately NOT a settle signal, so the row
// stays running while the query is present. Screenshots:
//   screenshots/tfl1216-c5b-search-index-shelf.png
//   screenshots/tfl1216-c5b-search-index-panel.png
// ---------------------------------------------------------------------------
const SEARCH_SHOT = path.join(SHOTS, 'tfl1216-c5b-search-index-shelf.png');
const SEARCH_PANEL_SHOT = path.join(SHOTS, 'tfl1216-c5b-search-index-panel.png');

/** A disposable copy of a TEXT (non-scanned) fixture; a Find query indexes it. */
function disposableReportFixture() {
  const src = path.join(ROOT, 'test-fixtures', 'report.pdf');
  const dir = path.join(os.tmpdir(), 'tfl1216-fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `report-${Date.now()}.pdf`);
  fs.copyFileSync(src, dst);
  return dst;
}

test('TFL-1216 C5b: the search-index build appears on the shelf with determinate pages and no cancel/completion controls', async () => {
  await openDoc(disposableReportFixture());

  // Open the real Find bar and run a query, which triggers the background index.
  await win.keyboard.press('Control+f');
  await win.waitForSelector('[aria-label="Search query"]', { timeout: 8000 });
  await win.locator('[aria-label="Search query"]').fill('the');

  // The index op is created from the first `{built:0,total}` snapshot, so the
  // summary is observable while the query is present.
  await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
  const summaryRole = await win
    .locator('[data-activity-shelf-role]')
    .first()
    .getAttribute('data-activity-shelf-role');
  const summaryActive =
    (await win.locator('[data-activity-shelf-active]').first().textContent()) || '';
  console.log(
    `[TFL-1216 C5b] summary role=${summaryRole} active=${JSON.stringify(summaryActive)}`,
  );

  expect(summaryActive, 'C5b: the summary names the search-index operation').toContain('Index for search');
  expect(summaryRole, 'C5b: the running index summary carries the progress role').toBe('progress');
  await win.screenshot({ path: SEARCH_SHOT });

  // Open the panel and inspect the running row + the controls it offers.
  await win.locator('.activity-shelf-host').hover();
  if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
    await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
    await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
  }
  const rowState = await win.locator('[data-activity-row]').first().getAttribute('data-activity-state');
  const rowText = (await win.locator('[data-activity-row-text]').first().textContent()) || '';
  const actions = await win
    .locator('[data-activity-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-activity-action')));
  const cancelCount = await win.locator('[data-activity-cancel]').count();
  console.log(
    `[TFL-1216 C5b] rowState=${rowState} rowText=${JSON.stringify(rowText)} actions=${JSON.stringify(actions)} cancelCount=${cancelCount}`,
  );

  expect(rowState, 'C5b: the running index row is running').toBe('running');
  expect(rowText, 'C5b: progress is truthful determinate pages').toMatch(/\d+ of \d+ pages/);
  expect(actions, 'C5b: the running index row declares no completion actions').toEqual([]);

  await win.screenshot({ path: SEARCH_PANEL_SHOT });

  // Honesty contract: the build has NO cancellation channel, so the shelf must
  // not offer a Cancel that cannot stop it.
  expect(cancelCount, 'C5b: no inert Cancel is offered for a build with no cancellation channel').toBe(0);
  console.log(`[TFL-1216 C5b] shots=${SEARCH_SHOT} ${SEARCH_PANEL_SHOT}`);
});

// ---------------------------------------------------------------------------
// TFL-1216 (TFL-1322, qa) - PHASE-CLOSE integrated screenshots. The settled
// conversion notice is the phase's completion surface, and after the DEF-652
// fix its two declared actions are real (activate the converted tab / reveal
// the fidelity card). This test drives the real conversion, waits for the
// terminal row, opens the Activity panel, and captures the ACTUAL revised app
// at a full window and at a compact supported width so the panel geometry,
// controls and labels can be inspected at both sizes. Screenshots:
//   screenshots/tfl1216-phase-close-full.png
//   screenshots/tfl1216-phase-close-compact.png
// ---------------------------------------------------------------------------
const PHASE_FULL_SHOT = path.join(SHOTS, 'tfl1216-phase-close-full.png');
const PHASE_COMPACT_SHOT = path.join(SHOTS, 'tfl1216-phase-close-compact.png');

test('TFL-1216 phase-close: integrated shelf at full and compact sizes (settled conversion offers Open / View details)', async () => {
  const filePath = disposableTextFixture();

  await requestOpenPath(filePath);

  await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 60000 });
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-activity-shelf-role]');
    return el !== null && el.getAttribute('data-activity-shelf-role') !== 'progress';
  }, undefined, { timeout: 240000 });

  const setSize = async (w, h) => {
    await app.evaluate(async ({ BrowserWindow }, size) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (target) {
        target.unmaximize();
        target.setContentSize(size.w, size.h);
      }
    }, { w, h });
    await win.waitForTimeout(600);
  };

  const openPanel = async () => {
    await win.locator('.activity-shelf-host').hover();
    if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
      await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
      await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
    }
  };

  const readRow = async () =>
    win.evaluate(() => {
      const row = document.querySelector('[data-activity-row]');
      const panel = document.querySelector('[data-activity-shelf-panel]');
      const actions = Array.from(document.querySelectorAll('[data-activity-action]')).map((e) =>
        e.getAttribute('data-activity-action'),
      );
      const rect = panel ? panel.getBoundingClientRect() : null;
      return {
        state: row ? row.getAttribute('data-activity-state') : null,
        actions,
        withinViewport:
          rect === null
            ? null
            : rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= window.innerWidth + 1 &&
              rect.bottom <= window.innerHeight + 1,
      };
    });

  await openPanel();

  await setSize(1440, 900);
  await openPanel();
  const full = await readRow();
  await win.screenshot({ path: PHASE_FULL_SHOT });
  console.log(`[TFL-1216 phase-close] full=${JSON.stringify(full)} shot=${PHASE_FULL_SHOT}`);

  await setSize(1000, 680);
  await openPanel();
  const compact = await readRow();
  await win.screenshot({ path: PHASE_COMPACT_SHOT });
  console.log(`[TFL-1216 phase-close] compact=${JSON.stringify(compact)} shot=${PHASE_COMPACT_SHOT}`);

  expect(full.state, 'phase-close: the conversion reached a terminal state').toBe('completed');
  expect(full.actions, 'phase-close: the fixed open-result action is offered').toContain('open-result');
  expect(full.actions, 'phase-close: the fixed view-details action is offered').toContain('view-details');
  expect(compact.actions, 'phase-close: the same actions are offered at the compact width').toEqual(
    full.actions,
  );
  expect(compact.withinViewport, 'phase-close: the panel stays within the viewport at the compact width').toBe(
    true,
  );
});
