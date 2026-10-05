// TFL-776.2 (DEF-561) — focused retest: after the Edit Text action bar's Delete
// removes a text run, the vacated page position must be INERT. The engine MASKS
// the run's rect but never removes its text operators, so pdf.js still returns
// the phantom text item at the old spot after the proxy refresh. Pre-fix (the
// Delete handler never registered the vacated rect) that phantom still matched
// the hover and click hit-tests, so an empty dashed ghost box reappeared on
// hover and a click re-selected / restored the deleted run.
//
// Fix under test (TFL-776.1): `onDelete` dispatches `push-text-run-commit` with
// `maskedRect` == the vacated rect, which `isMaskedRunRect` uses to filter the
// phantom from both `textItemsForInteraction()` (hover) and `runAtPoint()`
// (click).
//
// This spec is written to FAIL on the pre-fix build (the hover assertion
// catches the ghost) and PASS once the vacated rect is masked.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs `launchApp`.
// Run: npm.cmd run test:e2e -- tfl776_deleted_run_ghost
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
let reportSample = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  reportSample = getSamplePath('report.pdf');
  app = await launchApp([reportSample]);
  win = await app.firstWindow();
  try {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  } catch (_) {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportSample);
    const openBtn = win.locator('[data-toolbar-open]').first();
    if ((await openBtn.count()) > 0) await openBtn.click();
    else await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl776');
  app = null;
  win = null;
});

async function armTextTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="text"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

// The first page-1 textLayer span with visible glyphs — an independent oracle
// for the run's glyph box.
async function findRunSpan() {
  return win.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'),
    );
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        return {
          text: t,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
        };
      }
    }
    return null;
  });
}

// The viewport centre of the page-1 textLayer span whose text matches (the
// engine masks the run but leaves its text operators, so pdf.js still returns
// this phantom after the proxy refresh). Re-read AFTER the refresh: the delete
// re-render can move the page, so the run's pre-delete viewport coords are
// stale.
async function spanCentreByText(text) {
  return win.evaluate((want) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      if ((s.textContent || '').trim() === want) {
        const r = s.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, text);
}

// Page-1 text-layer item texts (post-refresh snapshot for a re-insertion check).
async function textLayerItems() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span')).map(
      (s) => (s.textContent || '').trim(),
    ),
  );
}

// The element the browser would hit at a viewport point.
async function elementAt(x, y) {
  return win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (el === null) return null;
    const cls = typeof el.className === 'string' ? el.className : '';
    return { tag: el.tagName, cls };
  }, [x, y]);
}

async function hoverCount() {
  return win.locator('.page-slot[data-page="1"] .edit-text-hover').count();
}

async function runBarCount() {
  return win.locator('[data-content-action-bar="textrun"]').count();
}

test('deleting a text run leaves the vacated position inert (no ghost box)', async () => {
  await armTextTool();
  const run = await findRunSpan();
  expect(run, 'a page-1 text run is present').not.toBeNull();
  console.log(`[TFL-776.2] target run=${JSON.stringify(run)}`);

  // 1. single-click the run -> selection bar [data-content-action-bar="textrun"]
  await win.mouse.click(run.cx, run.cy);
  const bar = win.locator('[data-content-action-bar="textrun"]').first();
  await bar.waitFor({ state: 'visible', timeout: 10000 });
  const selectionBefore = await win.locator('[data-textrun-selection]').count();
  console.log(`[TFL-776.2] pre-delete: bar visible selectionSurfaces=${selectionBefore}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-before-delete.png') });
  expect(selectionBefore, 'run is selected before Delete').toBeGreaterThan(0);

  const itemsBefore = await textLayerItems();
  console.log(`[TFL-776.2] page-1 text-layer items before delete=${itemsBefore.length}`);

  // 2. press the bar's Delete via the exact selector
  await win.locator('[data-content-action="textrun-delete"]').first().click();
  await win.waitForFunction(
    () => document.querySelector('[data-content-action-bar="textrun"]') === null,
    undefined,
    { timeout: 15000 },
  );
  // let the engine mask + pdf.js proxy refresh land
  await win.waitForTimeout(2200);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-after-delete.png') });
  const itemsAfterDelete = await textLayerItems();
  console.log(
    `[TFL-776.2] after-delete: bar=${await runBarCount()} items=${itemsAfterDelete.length}`,
  );
  // The vacated centre is the phantom span's centre AFTER the refresh: the
  // delete re-render can move the page, so the run's pre-delete viewport
  // coords are stale. The engine MASKS the run but does not remove its text
  // operators, so pdf.js still returns this phantom item.
  const vacated = await spanCentreByText(run.text);
  console.log(
    `[TFL-776.2] vacated centre=${JSON.stringify(vacated)} (pre-delete ${run.cx.toFixed(1)},${run.cy.toFixed(1)})`,
  );
  expect(
    vacated,
    'phantom span for the deleted run is still in the text layer (engine masks, never removes)',
  ).not.toBeNull();

  // Positive control: a surviving run still hovers, proving the text hover
  // listener is live (guards against a false pass when the tool turned off).
  const control = await win.evaluate((skip) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t !== skip && t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, run.text);
  if (control !== null) {
    await win.mouse.move(5, 5);
    await win.waitForTimeout(150);
    await win.mouse.move(control.cx, control.cy);
    await win.waitForTimeout(400);
    console.log(
      `[TFL-776.2] control-hover text=${JSON.stringify(control.text)} boxes=${await hoverCount()}`,
    );
    await win.mouse.move(5, 5);
    await win.waitForTimeout(200);
  }

  // 3. hover the vacated centre -> no ghost box, no bar, hit-test not the ghost
  await win.mouse.move(5, 5);
  await win.waitForTimeout(200);
  await win.mouse.move(vacated.cx, vacated.cy);
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-hover-vacated.png') });

  const hoverVerdict = await hoverCount();
  const barOnHover = await runBarCount();
  const hit = await elementAt(vacated.cx, vacated.cy);
  console.log(
    `[TFL-776.2] hover-vacated: hoverBoxes=${hoverVerdict} bar=${barOnHover} elementFromPoint=${JSON.stringify(hit)}`,
  );
  expect(hoverVerdict, 'no .edit-text-hover appears over the vacated position').toBe(0);
  expect(barOnHover, 'no textrun selection bar reappears on hover').toBe(0);
  expect(
    hit !== null && hit.cls.includes('edit-text-hover'),
    `elementFromPoint over the vacated centre is not the ghost (got ${JSON.stringify(hit)})`,
  ).toBe(false);

  // 4. click the vacated centre -> no re-selection and no text re-inserted
  await win.mouse.click(vacated.cx, vacated.cy);
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'tfl776-after-click.png') });

  const barAfterClick = await runBarCount();
  const selectionAfterClick = await win.locator('[data-textrun-selection]').count();
  const itemsAfterClick = await textLayerItems();
  console.log(
    `[TFL-776.2] after-click: bar=${barAfterClick} selectionSurfaces=${selectionAfterClick} items=${itemsAfterClick.length}`,
  );
  await win.mouse.move(5, 5);
  await win.waitForTimeout(300);
  const hoverAfterClick = await hoverCount();

  expect(barAfterClick, 'no selection bar reappears after clicking the vacated position').toBe(0);
  expect(selectionAfterClick, 'click does not re-select the deleted run').toBe(0);
  expect(hoverAfterClick, 'no hover ghost after the vacated click + pointer away').toBe(0);
  expect(
    itemsAfterClick.length,
    `click did not re-insert deleted content into the text layer (${itemsAfterDelete.length} -> ${itemsAfterClick.length})`,
  ).toBe(itemsAfterDelete.length);
  expect(
    itemsAfterClick.join(' '),
    'page-1 text-layer content unchanged by the vacated click',
  ).toBe(itemsAfterDelete.join(' '));

  fs.writeFileSync(
    path.join(SHOTS, 'tfl776-verdict.json'),
    JSON.stringify(
      {
        run,
        vacated,
        control,
        itemsBefore,
        itemsAfterDelete,
        itemsAfterClick,
        hoverVerdict,
        barOnHover,
        hit,
        barAfterClick,
        selectionAfterClick,
        hoverAfterClick,
      },
      null,
      2,
    ),
  );
});
