// DEF-279 / ADV-068 reproduction (qa, phase 32).
//
// The same-file pane guard (`paneAssignPathError`, multiMode.ts) and the open
// dedupe (App.tsx) compare RAW path strings. On Windows a case-variant path
// names the SAME file, so both guards are bypassed: two tabs for one file,
// both accepted into the two panes, and a later save silently overwrites the
// other pane's saved edit.
//
// This spec asserts the CORRECT Phase 32 behaviour, so it is RED while the
// defect is present and GREEN once both comparisons normalise the path.
// Temp copies only - no test-fixtures file is mutated. Launches only through
// the canonical e2e/lib/launch.cjs launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { PDFDocument } = require(path.join(ROOT, 'node_modules', 'pdf-lib'));
const SRC = path.join(ROOT, 'test-fixtures', 'report.pdf'); // 34 pages
const TMP = path.join(os.tmpdir(), 'tflex-def279');

let app = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function onDiskPages(p) {
  const doc = await PDFDocument.load(fs.readFileSync(p), { updateMetadata: false });
  return doc.getPageCount();
}

async function openFile(p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function paneHeader(pane) {
  const raw = await win.locator(`[data-pane="${pane}"] [data-pane-header]`).innerText().catch(() => '');
  return raw.replace(/\s+/g, ' ').trim();
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def279');
  app = null;
  win = null;
});
test.setTimeout(240000);

test('DEF-279 case-variant path bypasses the same-file guard and a save overwrites the other pane edit', async () => {
  const exact = tmpCopy(SRC, 'p32-samefile.pdf');
  const variant = exact.replace('p32-samefile.pdf', 'P32-SAMEFILE.PDF');
  const initial = await onDiskPages(exact);
  const variantExists = fs.existsSync(variant);
  console.log(`[DEF279] exact=${exact}`);
  console.log(`[DEF279] variant=${variant} exists=${variantExists} initialPages=${initial}`);
  expect(variantExists).toBe(true); // Windows: same file, different case

  // 1. Open the file, then the SAME file with a case-variant path.
  await openFile(exact);
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await openFile(variant);
  await win.waitForTimeout(900);
  const tabsAfter = await win.locator('.tab[data-tab-id]').count();
  const toastsAfterOpen = await win.locator('.toast-text').allInnerTexts();
  console.log(`[DEF279] tabs after case-variant open = ${tabsAfter} (correct dedupe => 1) toasts=${JSON.stringify(toastsAfterOpen)}`);

  // 2. Activate the exact-case tab and enable Multi Mode (pane A = it). The
  //    case-variant open above already DEDUPED to the single tab, so pane B's
  //    pick list is empty and there is no second tab to assign. Exercise the
  //    guard through its REACHABLE path instead: pane B's own Open action on
  //    the SAME file must be refused with the message and create no tab.
  //    (Without the fix the case-variant open would have produced a second
  //    tab, so this flow is RED while the defect is present.)
  await win.locator('.tab[data-tab-id]').first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — single-mode Multi Mode toggle now lives in the palette.
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(600);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, variant);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').first().click();
  // Capture the refusal at the moment it is on screen (auto-waiting locator),
  // so a later read cannot miss it.
  let refusalText = '';
  try {
    const refusalToast = win
      .locator('.toast-text')
      .filter({ hasText: 'already shown in the other pane' })
      .first();
    await expect(refusalToast).toBeVisible({ timeout: 5000 });
    refusalText = await refusalToast.innerText();
  } catch {
    refusalText = '';
  }
  const paneBEmpty = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  const headerA = await paneHeader('A');
  const headerB = await paneHeader('B');
  const rail = await win.locator('[data-pane-strip]').evaluateAll((els) =>
    els.map((e) => ({ pane: e.getAttribute('data-pane-strip-pane'), doc: e.getAttribute('data-pane-strip-doc') })));
  const toastsAfterAssign = refusalText === '' ? [] : [refusalText];
  console.log(`[DEF279] headerA="${headerA}" headerB="${headerB}" paneBEmpty=${paneBEmpty} rail=${JSON.stringify(rail)} toasts=${JSON.stringify(toastsAfterAssign)}`);

  // 3. Data-loss half (only reachable while the bypass exists): delete page 1
  //    in pane A, Save A (33 pages on disk), then Save B (34 pages on disk).
  let afterSaveA = null;
  let afterSaveB = null;
  const bypassed = tabsAfter >= 2 && paneBEmpty === 0;
  if (bypassed) {
    await win.locator('.multi-pane-header[data-pane="A"]').click();
    await win.waitForTimeout(400);
    const thumb = win.locator('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]').first();
    await thumb.scrollIntoViewIfNeeded().catch(() => {});
    await thumb.click({ modifiers: ['Shift'] });
    await win.waitForTimeout(500);
    const del = win.locator('[data-pane-strip-pane="A"] [aria-label="Delete this page"]');
    console.log(`[DEF279] pane A delete control count=${await del.count()}`);
    await del.first().click();
    await win.waitForTimeout(1600);
    console.log(`[DEF279] after delete in A: headerA="${await paneHeader('A')}" headerB="${await paneHeader('B')}"`);

    await win.locator('.multi-pane-header[data-pane="A"]').click();
    await win.waitForTimeout(300);
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2500);
    afterSaveA = await onDiskPages(exact);

    await win.locator('.multi-pane-header[data-pane="B"]').click();
    await win.waitForTimeout(300);
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2500);
    afterSaveB = await onDiskPages(exact);
    console.log(`[DEF279] on-disk pages: initial=${initial} afterSaveA=${afterSaveA} afterSaveB=${afterSaveB}`);
  } else {
    console.log('[DEF279] guard held - data-loss half not reachable');
  }

  // Correct Phase 32 behaviour: the case-variant open dedupes to one tab, and
  // even without dedupe the pane guard refuses the same file with a message.
  expect.soft(tabsAfter, 'case-variant open created a second tab (dedupe bypassed)').toBe(1);
  expect.soft(toastsAfterAssign.some((t) => t.includes('already shown in the other pane')), 'no same-file refusal message').toBe(true);
  expect.soft(paneBEmpty, 'pane B accepted the same file').toBe(1);
  // Data loss: pane A saved 33 pages, pane B then wrote its own 34 over it.
  if (bypassed) {
    expect.soft(afterSaveA, 'pane A saved its deleted-page document').toBe(initial - 1);
    expect.soft(afterSaveB, 'pane B overwrote the file with its own page count').toBe(initial);
  }
});
