// Phase 32 — Multi Mode e2e (spec 2 of 4): FOCUSED-PANE ROUTING.
//
// Covers success criterion 3: every document-scoped operation acts on the
// FOCUSED pane only, leaving the other pane's document untouched.
//   - page operations through the real toolbar controls
//     ([data-toolbar-delete-pages], [data-toolbar-rotate-cw]),
//   - undo / redo (menu accelerators, routed through the active tab),
//   - Save (the title-bar control reads the active tab),
//   - the two tab-strip rules.
// Both panes' page counts / engine state are asserted before and after.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const ALPHA_SRC = path.join(FIX, 'report.pdf'); // 34 pages
const BETA_SRC = path.join(FIX, 'long.pdf'); // 520 pages
const TMP = path.join(os.tmpdir(), 'tflex-p32');

let electronApp = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}
async function mockOpen(p) {
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}
async function openFile(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}
async function waitTabCount(n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}
function headerLoc(pane) {
  return win.locator(`.multi-pane-header[data-pane="${pane}"]`);
}
async function paneCount(pane) {
  const raw = await headerLoc(pane).innerText();
  const m = raw.match(/(\d+)\s+pages?/);
  return m ? Number(m[1]) : null;
}
// Focus a pane through its PAGE AREA (the pane's own pointerdown-capture
// focus). The pane HEADER is the other documented focus path, but the Phase 33
// shared toolbar currently overlays it (DEF-282); that path is asserted by
// phase33_multi_toolbar.spec.cjs, so this spec uses the page path and keeps
// its actual subject - focused-pane routing - testable.
async function focusPane(pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPane: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width / 2, vp.w - 30));
  const y = Math.max(70, Math.min(box.y + box.height / 2, vp.h - 30));
  await win.mouse.click(x, y);
  await win.waitForTimeout(350);
}
// Amended Phase 32 semantics (DEF-277): a title-bar Open while the mode is on
// assigns the document to the FOCUSED pane, so the second document must be
// opened in single mode first; alpha is then made active before the mode is
// turned on (pane A = alpha) and beta is picked into pane B.
async function twoPaneSetup() {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await openFile(tmpCopy(BETA_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(400);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}
// Confirm the Delete pages dialog's default "current page" choice.
// Phase 33 — Multi Mode has ONE shared toolbar; the page-op controls live
// there and act on the FOCUSED pane, so the caller sets focus first.
async function deleteCurrentPage() {
  await win.locator('[data-shared-toolbar] [data-toolbar-delete-pages]').first().click();
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 10000 });
  await win.locator('[data-delete-confirm]').click();
  await win.waitForTimeout(1200);
}
async function diag() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return {
      pageCount: d.pageCount,
      modified: d.modified,
      canUndo: d.canUndo,
      canRedo: d.canRedo,
      rotations: d.engineState ? (d.engineState.rotations || []).slice(0, 3) : null,
      activeTabId: d.activeTabId,
    };
  });
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(180000);

test('R1 toolbar page operations act on the focused pane only', async () => {
  await twoPaneSetup();
  const a0 = await paneCount('A');
  const b0 = await paneCount('B');
  console.log(`[P32-routing] baseline A=${a0} B=${b0}`);
  expect(a0).toBe(34);
  expect(b0).toBe(520);

  // --- focus B, rotate via the SHARED toolbar (acts on the focused pane) ---
  await focusPane('B');
  let before = await diag();
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1200);
  let after = await diag();
  console.log(`[P32-routing] B rotate: B rot ${JSON.stringify(before.rotations)} -> ${JSON.stringify(after.rotations)}`);
  expect(after.rotations[0]).toBe(1);
  await focusPane('A');
  const aRot = (await diag()).rotations;
  console.log(`[P32-routing] A rotations after B rotate = ${JSON.stringify(aRot)}`);
  expect(aRot[0]).toBe(0);

  // --- focus A, rotate via the shared toolbar ---
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1200);
  const aRot2 = (await diag()).rotations;
  console.log(`[P32-routing] A rotations after A rotate = ${JSON.stringify(aRot2)}`);
  expect(aRot2[0]).toBe(1);
  await focusPane('B');
  const bRot2 = (await diag()).rotations;
  console.log(`[P32-routing] B rotations unchanged by A rotate = ${JSON.stringify(bRot2)}`);
  expect(bRot2[0]).toBe(1);

  // --- delete pages through the shared toolbar (focused pane B) ---
  await focusPane('B');
  let aBeforeDel = await paneCount('A');
  let bBeforeDel = await paneCount('B');
  await deleteCurrentPage();
  let aAfterDel = await paneCount('A');
  let bAfterDel = await paneCount('B');
  console.log(`[P32-routing] delete on focused B: A ${aBeforeDel}->${aAfterDel}, B ${bBeforeDel}->${bAfterDel}`);
  expect(aAfterDel).toBe(aBeforeDel);
  expect(bAfterDel).toBe(bBeforeDel - 1);

  await focusPane('A');
  await deleteCurrentPage();
  const aAfterDel2 = await paneCount('A');
  const bAfterDel2 = await paneCount('B');
  console.log(`[P32-routing] delete on focused A: A ${aAfterDel}->${aAfterDel2}, B ${bAfterDel}->${bAfterDel2}`);
  expect(aAfterDel2).toBe(aAfterDel - 1);
  expect(bAfterDel2).toBe(bAfterDel);

  // --- a GLOBAL entry point (All tools > Delete) routes to the focused
  //     pane: open the palette from the topmost (pane B) tools badge, then
  //     delete. ---
  await win.locator('[data-tools-badge]').last().click({ force: true });
  await win.waitForSelector('[data-tool-id="delete"]', { timeout: 10000 });
  await focusPane('B');
  const aBeforeGlobal = await paneCount('A');
  const bBeforeGlobal = await paneCount('B');
  await win.locator('[data-tool-id="delete"]').click();
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 10000 });
  await win.locator('[data-delete-confirm]').click();
  await win.waitForTimeout(1200);
  const aAfterGlobal = await paneCount('A');
  const bAfterGlobal = await paneCount('B');
  console.log(`[P32-routing] All tools Delete while B focused: A ${aBeforeGlobal}->${aAfterGlobal}, B ${bBeforeGlobal}->${bAfterGlobal}`);
  expect(aAfterGlobal).toBe(aBeforeGlobal);
  expect(bAfterGlobal).toBe(bBeforeGlobal - 1);
});

test('R2 undo/redo target the focused pane', async () => {
  await twoPaneSetup();
  // Rotate both documents so both have an undo entry.
  await focusPane('A');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
  await focusPane('B');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
  const aRot = await (async () => { await focusPane('A'); return (await diag()).rotations[0]; })();
  const bRot = await (async () => { await focusPane('B'); return (await diag()).rotations[0]; })();
  console.log(`[P32-routing] pre-undo A.rot=${aRot} B.rot=${bRot}`);
  expect(aRot).toBe(1);
  expect(bRot).toBe(1);

  // Undo with pane A focused: only A reverts.
  await focusPane('A');
  const canUndoA = (await diag()).canUndo;
  console.log(`[P32-routing] pane A focused canUndo=${canUndoA}`);
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1200);
  const aAfterUndo = (await diag()).rotations[0];
  const bAfterUndo = await (async () => { await focusPane('B'); return (await diag()).rotations[0]; })();
  console.log(`[P32-routing] after Ctrl+Z (A focused): A.rot=${aAfterUndo} B.rot=${bAfterUndo}`);
  expect(aAfterUndo).toBe(0);
  expect(bAfterUndo).toBe(1);

  // Redo with pane A focused: only A re-applies.
  await focusPane('A');
  const canRedoA = (await diag()).canRedo;
  console.log(`[P32-routing] pane A focused canRedo=${canRedoA}`);
  await win.keyboard.press('Control+Shift+z');
  await win.waitForTimeout(1200);
  const aAfterRedo = (await diag()).rotations[0];
  console.log(`[P32-routing] after Ctrl+Shift+Z (A focused): A.rot=${aAfterRedo}`);
  expect(aAfterRedo).toBe(1);

  // Undo with pane B focused: only B reverts.
  await focusPane('B');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1200);
  const bAfterUndo2 = (await diag()).rotations[0];
  const aAfterUndo2 = await (async () => { await focusPane('A'); return (await diag()).rotations[0]; })();
  console.log(`[P32-routing] after Ctrl+Z (B focused): B.rot=${bAfterUndo2} A.rot=${aAfterUndo2}`);
  expect(bAfterUndo2).toBe(0);
  expect(aAfterUndo2).toBe(1);
});

test('R3 Save targets the focused pane', async () => {
  await twoPaneSetup();
  await focusPane('A');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
  await focusPane('B');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);

  const aMod = await (async () => { await focusPane('A'); return (await diag()).modified; })();
  const bMod = await (async () => { await focusPane('B'); return (await diag()).modified; })();
  console.log(`[P32-routing] pre-save modified A=${aMod} B=${bMod}`);
  expect(aMod).toBe(true);
  expect(bMod).toBe(true);

  // Save with pane B focused.
  await focusPane('B');
  const saveEnabled = await win.locator('[data-toolbar-save]').isEnabled();
  console.log(`[P32-routing] Save enabled while pane B (modified) focused = ${saveEnabled}`);
  expect(saveEnabled).toBe(true);
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(2000);
  const bAfter = await diag();
  const aAfter = await (async () => { await focusPane('A'); return (await diag()).modified; })();
  console.log(`[P32-routing] after Save (B focused): B.modified=${bAfter.modified} A.modified=${aAfter}`);
  expect(bAfter.modified).toBe(false);
  expect(aAfter).toBe(true);

  // Save with pane A focused clears A.
  await focusPane('A');
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(2000);
  const aAfterSave = await diag();
  console.log(`[P32-routing] after Save (A focused): A.modified=${aAfterSave.modified}`);
  expect(aAfterSave.modified).toBe(false);
});

test('R4 tab-strip rules: in-a-pane tab focuses its pane; no-pane tab assigns to the focused pane', async () => {
  await twoPaneSetup(); // A=alpha, B=beta; B focused after assignment
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');

  // Rule 1: clicking the tab whose document lives in pane A focuses pane A.
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(400);
  console.log(`[P32-routing] rule1 after alpha-tab click: A.focused=${await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')} B.focused=${await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')}`);
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('false');

  // Rule 2: a tab that is in NO pane is assigned to the focused pane.
  await openFile(tmpCopy(ALPHA_SRC, 'p32-gamma.pdf'));
  await waitTabCount(3);
  // Deterministic focus: clicking the in-pane alpha tab focuses pane A
  // (rule 1, already proven) and makes alpha the active tab, so the gamma
  // tab is inactive and its click reaches the routing seam.
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(400);
  const preActive = await win.evaluate(() => window.tflexDiagnostics().activeTabId);
  const preFocused = await win.locator('.tab-pane[data-pane-focused="true"]').getAttribute('data-pane');
  const aHeaderBefore = (await headerLoc('A').innerText()).replace(/\s+/g, ' ');
  console.log(`[P32-routing] rule2 pre-click activeTab=${preActive} focused=${preFocused} A.header="${aHeaderBefore}"`);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-gamma' }).first().click();
  await win.waitForTimeout(1200);
  const aHeaderAfter = (await headerLoc('A').innerText()).replace(/\s+/g, ' ');
  const bHeader = (await headerLoc('B').innerText()).replace(/\s+/g, ' ');
  const postActive = await win.evaluate(() => window.tflexDiagnostics().activeTabId);
  console.log(`[P32-routing] rule2 pane A header "${aHeaderBefore}" -> "${aHeaderAfter}"; pane B "${bHeader}"; activeTab=${postActive}`);
  expect(aHeaderAfter).toContain('p32-gamma');
  expect(bHeader).toContain('p32-beta');
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');
});