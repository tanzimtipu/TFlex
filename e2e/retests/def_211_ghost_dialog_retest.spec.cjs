// DEF-211 retest (qa): "Ghost annotation remains interactive when a dialog
// opens — annotation tool not disarmed before dialog mount."
//
// DEF-211 (FIX-READY) — an armed annotation tool's ghost preview / pending
// editor + action bar stayed live and pointer-interactive underneath a
// dialog that opened over the workspace.
//
// The fix under test (working tree, verified against the rebuilt dev
// bundle — see git status: src/renderer/App.tsx + DocumentView.tsx):
//   * DocumentView is forwardRef + useImperativeHandle and exposes
//     `disarmAnnotationTool()` (annotation-tool reducer -> "select").
//   * App.tsx keeps one stable ref per tab and calls
//     `disarmActiveDocView()` BEFORE `setXxxOpen(true)` in every dialog
//     opener (Insert Pages, Merge, Split/Extract, Replace/Renumber/Crop
//     pages, Optimize, Save As, Delete Pages, About, Preferences, OCR,
//     Stamp, Sign, Flatten, exports, …).
//
// This spec drives the real dev build (e2e/lib/launch.cjs; NO
// executablePath) through three dialog scenarios, each with a PENDING
// (unconfirmed) ghost in place, per the defect's repro:
//
//   T1  Insert Pages  <- Text box ghost (click-placed, unconfirmed)
//   T2  Optimize      <- Note ghost (click-placed, unconfirmed)
//   T3  Save As       <- Text box ghost on a modified document
//
// Per scenario the retest asserts:
//   1. the ghost really exists before the dialog (validates the setup),
//   2. after the dialog mounts, tflexDiagnostics().activeTool is
//      'select' — the only path from an armed tool to 'select' is the
//      disarm, which is what this proves was called,
//   3. the ghost DOM (editor + action bar) is gone,
//   4. the dialog is mounted and its OWN controls respond to clicks,
//   5. after closing, the page is neutral: a click places no ghost, and
//      the tool still works when re-armed (disarm did not break it).
//
// Evidence: screenshots/def-211-*.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchDev, diag, hardClose, armAnnotationTool, openDockVerb, clickDockVerb } = require('../lib/helpers.cjs');
const { getSamplePath } = require('../lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (w, name) => w.screenshot({ path: path.join(SHOTS, name) });

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(() => {
  pageErrors = [];
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(300000);

async function launch() {
  const r = await launchDev();
  electronApp = r.electronApp;
  win = r.window;
  win.on('pageerror', (e) => {
    const m = e && e.message ? e.message : String(e);
    pageErrors.push(m);
    process.stdout.write(`[DEF211-PAGEERROR] ${m}\n`);
  });
}

async function openDoc() {
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2200);
}

async function clickPageAt(fx, fy) {
  const layout = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const slot = pane && pane.querySelector('.page-slot[data-page="1"]');
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    // Phase 36 (chunk 3) — the REVIEW Annotate flyout occupies the bottom band
    // of the canvas; a clamped click must stay ABOVE it or it lands on the
    // flyout's tool buttons instead of the page.
    const flyout = document.querySelector('[data-annotation-flyout]');
    const flyoutTop = flyout ? flyout.getBoundingClientRect().top : window.innerHeight;
    return { x: r.x, y: r.y, w: r.width, h: r.height, winW: window.innerWidth, winH: window.innerHeight, flyoutTop };
  });
  if (!layout) throw new Error('page slot 1 not mounted');
  // The page slot can be TALLER than the viewport (fit-width on a letter
  // page), so a slot-relative point can land BELOW the window. Clamp the
  // click into the visible viewport (and above the flyout) while staying
  // inside the page.
  let x = layout.x + layout.w * fx;
  let y = layout.y + layout.h * fy;
  const maxY = Math.min(layout.winH - 80, layout.flyoutTop - 40);
  if (y > maxY) y = maxY;
  if (y < layout.y + 30) y = layout.y + 40;
  await win.mouse.move(x - 6, y - 6);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.waitForTimeout(60);
  await win.mouse.up();
}

async function pageClick() {
  await clickPageAt(0.4, 0.45);
}

/** Let the overlay's post-paint disarm effect drop the pending ghost DOM. */
async function settleGhostGone(ms = 600) {
  await win.waitForTimeout(ms);
}

/** Ghost-DOM census: the pending editor + its action bar, per tool class. */
async function ghostDom() {
  return win.evaluate(() => ({
    textboxEditor: !!document.querySelector('[data-annotation-editor="textbox"]'),
    textboxBar: !!document.querySelector('[data-annotation-action-bar="textbox"]'),
    textboxConfirm: !!document.querySelector('[data-annotation-action="textbox-confirm"]'),
    noteEditor: !!document.querySelector('.ann-note-editor'),
    noteConfirm: !!document.querySelector('[data-annotation-action="note-confirm"]'),
    anyActionBar: !!document.querySelector('[data-annotation-action-bar]'),
  }));
}

/** The discriminating assertions shared by all three scenarios. */
async function assertDisarmedAndGhostGone(tag) {
  const d = await diag(win);
  console.log(`[DEF211 ${tag}] activeTool after dialog mount: ${d.activeTool}`);
  // tflexDiagnostics() normalises "no armed tool" (reducer value
  // 'select') to null — so a null here IS the disarmed state.
  expect(d.activeTool, `${tag}: tool disarmed before the dialog settled`).toBeNull();

  // The overlay's tool-change effect (which drops the pending editor +
  // action bar) runs right after the disarm render; allow a settle window
  // and then demand the ghost DOM is actually gone.
  await win.waitForTimeout(600);
  const g = await ghostDom();
  console.log(`[DEF211 ${tag}] ghost DOM after disarm: ${JSON.stringify(g)}`);
  expect(g.textboxBar, `${tag}: no textbox action bar left`).toBeFalsy();
  expect(g.textboxConfirm, `${tag}: no textbox ghost editor left`).toBeFalsy();
  expect(g.noteConfirm, `${tag}: no note ghost left`).toBeFalsy();
  expect(g.anyActionBar, `${tag}: no annotation action bar left at all`).toBeFalsy();
}

// ---- T1: Insert Pages dialog over a pending Text-box ghost ----

// RETIRED (Phase 26, and the Phase 36 surface move that followed). T1/T2/T3
// assert that an UNCONFIRMED in-canvas textbox/note GHOST editor stays mounted
// while its tool is armed, and that opening a dialog disarms it. Phase 26
// REMOVED the in-canvas editor: a textbox/note click now places the annotation
// immediately and hands editing to the panel Text field, so there is no pending
// ghost to disarm. The current no-in-canvas-editor contract is covered by
// e2e/phase26_panel_text_edit.spec.cjs C1; the armed-tool disarm-on-pending-bar
// contract by e2e/regression_b_port.spec.cjs B1-port (Sign Cancel) and
// e2e/sweep_annotations_sign.spec.cjs (Escape disarm).
test.skip('DEF-211 T1: Insert Pages dialog disarms the ghost (textbox tool)', async () => {
  await launch();
  await openDoc();

  // Arm the Text box tool and place an UNCONFIRMED ghost on page 1.
  await armAnnotationTool(win, 'textbox');
  let d = await diag(win);
  expect(d.activeTool, 'textbox tool armed').toBe('textbox');
  await pageClick();
  await win.waitForTimeout(500);
  d = await diag(win);
  expect(d.activeTool, 'tool still armed while the ghost is pending').toBe('textbox');
  const pre = await ghostDom();
  console.log(`[DEF211-T1] ghost pre-dialog: ${JSON.stringify(pre)}`);
  expect(pre.textboxConfirm, 'ghost action bar exists before the dialog').toBe(true);
  expect(pre.textboxEditor, 'ghost editor exists before the dialog').toBe(true);
  await shot(win, 'def-211-t1-ghost-armed.png');

  // Open the dialog through the real UI: Tools palette -> Insert pages.
  // Phase 36 migration: All-tools palette retired; Insert pages is a PAGES dock verb.
  await clickDockVerb(win, 1, 'insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await shot(win, 'def-211-t1-insert-pages-moment.png'); // the instant the dialog mounts
  await assertDisarmedAndGhostGone('T1');
  await shot(win, 'def-211-t1-insert-pages.png');
  await expect(win.locator('[data-insert-pages-dialog]')).toBeVisible();

  // The dialog's own controls respond (a ghost action bar underneath
  // would have intercepted these).
  await win.click('[data-insert-mode="fromPdf"]');
  await expect(win.locator('[data-insert-pick]'), 'from-PDF mode reveals its pick button').toBeVisible({ timeout: 5000 });
  await win.click('[data-insert-mode="blank"]');
  await win.locator('[data-insert-pages-dialog] .modal-close').click();
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'detached', timeout: 10000 });

  // The canvas is neutral now: a click places no ghost...
  await pageClick();
  await win.waitForTimeout(400);
  const neutral = await ghostDom();
  expect(
    { confirm: neutral.textboxConfirm, bar: neutral.anyActionBar },
    'click on the neutral canvas places no ghost',
  ).toEqual({ confirm: false, bar: false });
  expect((await diag(win)).activeTool, 'still disarmed after the dialog round-trip (null == no tool armed)').toBeNull();

  // ...and the tool is not broken by the disarm: re-arming still works.
  await armAnnotationTool(win, 'textbox');
  await pageClick();
  await win.waitForTimeout(500);
  const re = await ghostDom();
  expect(re.textboxConfirm, 're-armed tool still places ghosts after the dialog').toBe(true);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  expect(pageErrors, 'no renderer pageerrors in T1').toHaveLength(0);
});

// ---- T2: Optimize dialog over a pending Note ghost ----

// RETIRED — see the T1 note above.
test.skip('DEF-211 T2: Optimize dialog disarms the ghost (note tool)', async () => {
  await launch();
  await openDoc();

  // A different pending-editor class: the Note tool.
  await armAnnotationTool(win, 'note');
  let d = await diag(win);
  expect(d.activeTool, 'note tool armed').toBe('note');
  await pageClick();
  await win.waitForTimeout(500);
  d = await diag(win);
  expect(d.activeTool, 'note tool still armed with the pending ghost').toBe('note');
  const pre = await ghostDom();
  console.log(`[DEF211-T2] ghost pre-dialog: ${JSON.stringify(pre)}`);
  expect(pre.noteConfirm, 'note ghost action bar exists before the dialog').toBe(true);
  await shot(win, 'def-211-t2-ghost-armed.png');

  // Phase 36 (chunk 3) — Optimize is the DELIVER dock's `optimize` verb.
  await openDockVerb(win, 4, 'optimize');
  await win.waitForSelector('.optimize-dialog', { timeout: 10000 });
  await settleGhostGone();
  const d2 = await diag(win);
  console.log(`[DEF211-T2] activeTool after dialog mount: ${d2.activeTool}`);
  expect(d2.activeTool, 'note tool disarmed before the dialog settled').toBeNull();
  const g2 = await ghostDom();
  expect(g2.noteConfirm, 'no note ghost left').toBe(false);
  expect(g2.noteEditor, 'no note editor left').toBe(false);
  expect(g2.anyActionBar, 'no annotation action bar left').toBe(false);
  await expect(win.locator('.optimize-dialog')).toBeVisible();
  await shot(win, 'def-211-t2-optimize.png');

  // The dialog's Cancel button responds (an interception by a lingering
  // ghost bar would swallow this click).
  await win.locator('.optimize-dialog .btn-secondary').click();
  await win.waitForSelector('.optimize-dialog', { state: 'detached', timeout: 10000 });

  await pageClick();
  await win.waitForTimeout(400);
  const after = await ghostDom();
  expect(
    { note: after.noteConfirm, bar: after.anyActionBar },
    'the page is neutral after the dialog',
  ).toEqual({ note: false, bar: false });
  expect(pageErrors, 'no renderer pageerrors in T2').toHaveLength(0);
});

// ---- T3: Save As sheet over a pending ghost on a modified document ----

// RETIRED — see the T1 note above.
test.skip('DEF-211 T3: Save As sheet disarms the ghost (textbox, modified doc)', async () => {
  await launch();
  await openDoc();

  // Commit one real text box first: the document becomes modified, which
  // enables the Save-As button in the command bar.
  await armAnnotationTool(win, 'textbox');
  await pageClick();
  await win.waitForSelector('[data-annotation-action="textbox-confirm"]', { timeout: 10000 });
  await win.locator('.ann-textbox-editor').first().fill('def211');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(1200);
  let d = await diag(win);
  console.log(`[DEF211-T3] after commit: modified=${d.modified} tool=${d.activeTool}`);
  expect(d.modified, 'document is modified after the committed text box').toBe(true);

  // Arm the tool again and place a fresh UNCONFIRMED ghost.
  await armAnnotationTool(win, 'textbox');
  await pageClick();
  await win.waitForTimeout(500);
  d = await diag(win);
  expect(d.activeTool, 'ghost placed, tool armed').toBe('textbox');
  const pre = await ghostDom();
  expect(pre.textboxConfirm, 'ghost present before Save As').toBe(true);
  await shot(win, 'def-211-t3-ghost-armed.png');

  const saveAsBtn = win.locator('[data-toolbar-save-as]');
  await expect(saveAsBtn, 'Save As enabled on a modified doc').toBeEnabled();
  await saveAsBtn.click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await settleGhostGone();

  const d3 = await diag(win);
  console.log(`[DEF211-T3] activeTool after the Save As sheet: ${d3.activeTool}`);
  expect(d3.activeTool, 'ghost tool disarmed before the sheet settled').toBeNull();
  const g3 = await ghostDom();
  expect(g3, 'no ghost DOM under the Save As sheet').toEqual({
    textboxEditor: false,
    textboxBar: false,
    textboxConfirm: false,
    noteEditor: false,
    noteConfirm: false,
    anyActionBar: false,
  });
  await expect(win.locator('[data-save-as-dialog]')).toBeVisible();
  await shot(win, 'def-211-t3-saveas.png');

  // Dialog control interactivity: the linearize checkbox toggles.
  const lin = win.locator('[data-save-as-dialog] [data-save-as-linearize]');
  expect(await lin.isChecked(), 'linearize starts off').toBe(false);
  await lin.click();
  await expect(win.locator('[data-save-as-dialog] [data-save-as-linearize]'), 'checkbox responds to clicks').toBeChecked();

  await win.locator('[data-save-as-dialog] .btn-secondary').click(); // Cancel
  await win.waitForSelector('[data-save-as-dialog]', { state: 'detached', timeout: 10000 });
  await pageClick();
  await win.waitForTimeout(400);
  const after = await ghostDom();
  expect(
    { confirm: after.textboxConfirm, bar: after.anyActionBar },
    'canvas is neutral after the Save As cancel',
  ).toEqual({ confirm: false, bar: false });
  expect(pageErrors, 'no renderer pageerrors in T3').toHaveLength(0);
});