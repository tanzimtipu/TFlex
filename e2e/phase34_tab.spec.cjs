// Phase 34 — criterion 2: ONE composite tab for the Multi Mode workspace.
//
// While Multi Mode is on the tab strip shows EXACTLY ONE tab whose label names
// BOTH documents and whose modified indicator reflects EITHER document.
// Closing it runs the existing modified queue for EACH dirty document (Cancel
// aborts; both survive), then closes BOTH and leaves the mode. Switching the
// mode off restores the individual tabs with the focused pane's document
// active, and opening a document while the mode is on still lands in the
// focused pane.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, focusPaneByPage, paneCount, openFile, tmpCopy, REPORT, LONG } = require('./lib/p33_common.cjs');

const COMPOSITE = '.tab[data-tab-id="tf-multi-workspace"]';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-tab');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function compositeLabel() {
  const raw = await win.locator(`${COMPOSITE} .tab-title`).innerText();
  return raw.replace(/\s+/g, ' ').trim();
}
async function compositeDotVisible() {
  return win.evaluate(() => {
    const dot = document.querySelector('.tab[data-tab-id="tf-multi-workspace"] .tab-modified-dot');
    if (dot === null) return null;
    return !dot.classList.contains('tab-modified-dot-hidden');
  });
}
async function rotateFocused() {
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1100);
}

test('C1 ONE tab, label names both documents, modified dot reflects EITHER document', async () => {
  await twoPaneSetup(app, win);
  const tabs = win.locator('.tab[data-tab-id]');
  expect(await tabs.count(), 'Multi Mode shows exactly ONE tab').toBe(1);
  expect(await tabs.first().getAttribute('data-tab-id')).toBe('tf-multi-workspace');
  expect(await tabs.first().getAttribute('aria-selected')).toBe('true');

  const label = await compositeLabel();
  console.log(`[P34-tab] composite label="${label}"`);
  expect(label).toContain('p33-alpha');
  expect(label).toContain('p33-beta');

  // Both documents clean -> no modified dot.
  expect(await compositeDotVisible(), 'clean workspace shows no modified dot').toBe(false);

  // Modify A only -> the dot appears.
  await focusPaneByPage(win, 'A');
  await rotateFocused();
  console.log(`[P34-tab] after A-only rotate: dotVisible=${await compositeDotVisible()}`);
  expect(await compositeDotVisible(), 'dot set when pane A is modified').toBe(true);

  // Undo A -> clean again -> the dot clears.
  await focusPaneByPage(win, 'A');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1100);
  console.log(`[P34-tab] after undoing A: A.modified=${await win.evaluate(() => window.tflexDiagnostics().modified)} dotVisible=${await compositeDotVisible()}`);
  expect(await compositeDotVisible(), 'dot clears when the only modified document is reverted').toBe(false);

  // Modify B only -> the dot appears.
  await focusPaneByPage(win, 'B');
  await rotateFocused();
  console.log(`[P34-tab] after B-only rotate: dotVisible=${await compositeDotVisible()}`);
  expect(await compositeDotVisible(), 'dot set when pane B is modified').toBe(true);
});

test('C2 closing the composite tab prompts for EACH modified document; Cancel aborts', async () => {
  await twoPaneSetup(app, win);
  // Both documents dirty.
  await focusPaneByPage(win, 'A');
  await rotateFocused();
  await focusPaneByPage(win, 'B');
  await rotateFocused();
  expect(await compositeDotVisible()).toBe(true);

  // Close -> first prompt (pane A's document).
  await win.locator(`${COMPOSITE} .tab-close`).click();
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  const body1 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  console.log(`[P34-tab] prompt 1: "${body1}"`);
  expect(body1).toContain('p33-alpha');

  // Cancel -> both documents survive, still one composite tab, still two panes.
  await win.locator('[data-close-prompt-action="cancel"]').click();
  await win.waitForTimeout(800);
  expect(await win.locator('[data-close-tab-prompt]').count()).toBe(0);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(1);
  const aAfterCancel = await paneCount(win, 'A');
  const bAfterCancel = await paneCount(win, 'B');
  console.log(`[P34-tab] after Cancel: paneA=${aAfterCancel} paneB=${bAfterCancel}`);
  expect(aAfterCancel).toBe(34);
  expect(bAfterCancel).toBe(520);

  // Close for real: discard both prompts in turn; then BOTH close and the
  // app leaves Multi Mode.
  await win.locator(`${COMPOSITE} .tab-close`).click();
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  const again1 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  expect(again1).toContain('p33-alpha');
  await win.locator('[data-close-prompt-action="discard"]').click();
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  await win.waitForTimeout(400);
  const body2 = (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
  console.log(`[P34-tab] prompt 2: "${body2}"`);
  expect(body2).toContain('p33-beta');
  await win.locator('[data-close-prompt-action="discard"]').click();
  await win.waitForTimeout(1600);

  console.log(`[P34-tab] after closing both: tabs=${await win.locator('.tab[data-tab-id]').count()} panes=${await win.locator('[data-pane]').count()} multi=${await win.locator('.tab-stage').getAttribute('data-multi-mode')}`);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(0);
  expect(await win.locator('[data-pane]').count()).toBe(0);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');
  await expect(win.locator('.sample-card').first()).toBeVisible({ timeout: 15000 });
});

test('C3 mode OFF restores the individual tabs with the focused pane document active', async () => {
  await twoPaneSetup(app, win);
  // Focus pane A; its document must be the active single-mode tab on exit.
  await focusPaneByPage(win, 'A');
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');

  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(700);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-mode')).toBe('false');

  const tabs = win.locator('.tab[data-tab-id]');
  expect(await tabs.count(), 'individual tabs return').toBe(2);
  const active = await win.locator('.tab[data-tab-id][aria-selected="true"] .tab-title').innerText();
  console.log(`[P34-tab] mode OFF focused A: individual tabs=${await tabs.count()} active="${active}"`);
  expect(active).toContain('p33-alpha');

  // Focus pane B path: turn the mode back on, fill pane B, focus B, exit ->
  // beta active.
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p33-beta' }).first().click();
  await win.waitForTimeout(1200);
  await focusPaneByPage(win, 'B');
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(700);
  const activeB = await win.locator('.tab[data-tab-id][aria-selected="true"] .tab-title').innerText();
  console.log(`[P34-tab] mode OFF focused B: active="${activeB}"`);
  expect(activeB).toContain('p33-beta');
});

test('C4 opening a document while the mode is ON lands in the focused pane', async () => {
  await twoPaneSetup(app, win);
  // Focus A, open a third document: pane A replaces, pane B untouched.
  await focusPaneByPage(win, 'A');
  await openFile(app, win, tmpCopy(REPORT, 'p34-gamma.pdf'));
  await expect(win.locator('.tab-pane[data-pane="A"] [data-pane-header]')).toContainText('p34-gamma', { timeout: 30000 });
  await win.waitForTimeout(700);
  const a1 = await paneCount(win, 'A');
  const b1 = await paneCount(win, 'B');
  console.log(`[P34-tab] open into focused A: paneA=${a1} paneB=${b1} tabs=${await win.locator('.tab[data-tab-id]').count()}`);
  expect(a1).toBe(34);
  expect(b1).toBe(520);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(1);
  expect(await win.locator('.tab-pane[data-pane]').count()).toBe(2);

  // Focus B, open a fourth document: pane B replaces.
  await focusPaneByPage(win, 'B');
  await openFile(app, win, tmpCopy(LONG, 'p34-delta.pdf'));
  await expect(win.locator('.tab-pane[data-pane="B"] [data-pane-header]')).toContainText('p34-delta', { timeout: 30000 });
  await win.waitForTimeout(700);
  const a2 = await paneCount(win, 'A');
  const b2 = await paneCount(win, 'B');
  console.log(`[P34-tab] open into focused B: paneA=${a2} paneB=${b2} tabs=${await win.locator('.tab[data-tab-id]').count()}`);
  expect(a2).toBe(34);
  expect(b2).toBe(520);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(1);
  expect(await win.locator('.tab-pane[data-pane]').count()).toBe(2);
  // No hidden-tab-with-no-effect: the new document is visibly in pane B.
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible();
});
