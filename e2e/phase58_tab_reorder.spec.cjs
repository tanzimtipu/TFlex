// Phase 58 (chunk 5) — tab reorder + selectable title.
//
// The one assigned behaviour:
//   - a tab can be dragged left/right and the tab ORDER changes while the
//     ACTIVE document stays unchanged (drag must not re-activate or swap docs);
//   - dragging across a tab's title text produces a normal text selection
//     equal to the title (copyable), and does NOT reorder the strip.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p58-reorder');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openBundledSample(sampleName) {
  const p = getSamplePath(sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

async function tabOrder() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => el.getAttribute('data-tab-id')));
}

async function activeTabId() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
}

async function docIdentity() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { activeTabId: d.activeTabId, activeDocBytes: d.activeDocBytes, pageCount: d.pageCount };
  });
}

// Drag a tab by its leading colour chip (outside .tab-title, so the native
// text-selection guard is not engaged) to an absolute viewport X.
async function dragTabByChip(tabId, targetX) {
  const chip = win.locator(`[data-tab-id="${tabId}"] .tab-colour-chip`);
  const box = await chip.boundingBox();
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 10, y, { steps: 3 }); // cross the 6px threshold
  await win.mouse.move(targetX, y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

test('tab reorder changes order without changing the active document; title text is selectable', async () => {
  // 1. Three bundled sample documents -> three tabs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample('long.pdf');
  await openBundledSample('form.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30000 });
  await win.waitForTimeout(500);

  const initialOrder = await tabOrder();
  const initialActive = await activeTabId();
  const initialDoc = await docIdentity();
  console.log(`[P58-reorder] initial order=${JSON.stringify(initialOrder)} active=${initialActive} doc=${JSON.stringify(initialDoc)}`);
  expect(initialOrder.length, 'three tabs open').toBe(3);
  expect(initialActive, 'last opened document is active').toBe(initialOrder[2]);

  // 2. Drag the THIRD tab leftward past the FIRST tab.
  const third = initialOrder[2];
  const first = initialOrder[0];
  const firstBox = await win.locator(`[data-tab-id="${first}"]`).boundingBox();
  await dragTabByChip(third, firstBox.x + 2);
  const order2 = await tabOrder();
  const active2 = await activeTabId();
  const doc2 = await docIdentity();
  console.log(`[P58-reorder] after drag third->left order=${JSON.stringify(order2)} active=${active2} doc=${JSON.stringify(doc2)}`);
  expect(order2, 'third tab moved to the front').toEqual([third, first, initialOrder[1]]);
  // DEF-411 fix verified: a committed reorder must leave the pre-drag active
  // tab (and its displayed document) unchanged. Hard assertions now that the
  // fix is in (previous soft assertions masked the failure across steps).
  expect(active2, 'active tab id unchanged by the reorder').toBe(initialActive);
  expect(doc2, 'displayed document unchanged by the reorder').toEqual(initialDoc);

  // 3. Drag a BACKGROUND (non-active) tab to the far right. This is the
  //    exact reproduction from DEF-411: arming the drag on a non-active tab
  //    must not swap the active document when the reorder commits.
  const nonFirst = order2[1];
  expect(nonFirst, 'step-3 drag target is a background (non-active) tab').not.toBe(initialActive);
  const lastBox = await win.locator(`[data-tab-id="${order2[2]}"]`).boundingBox();
  await dragTabByChip(nonFirst, lastBox.x + lastBox.width + 20);
  const order3 = await tabOrder();
  const active3 = await activeTabId();
  const doc3 = await docIdentity();
  console.log(`[P58-reorder] after drag non-first->right order=${JSON.stringify(order3)} active=${active3} doc=${JSON.stringify(doc3)}`);
  expect(order3, 'non-first tab moved to the end').toEqual([order2[0], order2[2], nonFirst]);
  // Hard: the background-tab drag (DEF-411 reproduction) must leave the
  // pre-drag active tab id and displayed document untouched.
  expect(active3, 'active tab id still unchanged after the background-tab drag').toBe(initialActive);
  expect(doc3, 'displayed document still unchanged after the background-tab drag').toEqual(initialDoc);

  // Screenshot after the reorder (order visibly different from the initial).
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-reorder.png') });

  // 4. Drag-select across a BACKGROUND (non-active) tab's title text: the
  //    selection equals the title, and the active tab id, the displayed
  //    document AND the strip order all stay unchanged (DEF-413). After
  //    step 3 the active tab is form.pdf (initialActive); order3[2] is
  //    report.pdf, a NON-active tab, so a correct implementation must not
  //    activate it when the title is drag-selected.
  const selTab = order3[2];
  expect(selTab, 'step-4 selection target is a background (non-active) tab').not.toBe(initialActive);
  const activeBeforeSel = await activeTabId();
  const docBeforeSel = await docIdentity();
  const orderBeforeSel = await tabOrder();
  const textRect = await win.locator(`[data-tab-id="${selTab}"] .tab-title`).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (node === null) return null;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, height: rect.height, text: node.textContent };
  });
  expect(textRect, 'title has a text node').not.toBeNull();
  const y = textRect.top + textRect.height / 2;
  const startX = textRect.left + 1;
  const endX = textRect.right + 10;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  for (let x = startX + 3; x <= endX; x += 3) {
    await win.mouse.move(x, y);
  }
  await win.mouse.up();
  await win.waitForTimeout(300);
  const selection = await win.evaluate(() => window.getSelection().toString());
  const order4 = await tabOrder();
  const activeAfterSel = await activeTabId();
  const docAfterSel = await docIdentity();
  console.log(`[P58-reorder] selection=${JSON.stringify(selection)} expected=${JSON.stringify(textRect.text)} activeBefore=${activeBeforeSel} activeAfter=${activeAfterSel} docBefore=${JSON.stringify(docBeforeSel)} docAfter=${JSON.stringify(docAfterSel)} order=${JSON.stringify(order4)}`);
  expect(selection, 'drag-select across the title selects exactly the title text').toBe(textRect.text);
  // DEF-413 — the title selection is copyable but must NOT be an activation:
  // the active tab id and the displayed document stay exactly as before.
  expect(activeAfterSel, 'drag-selecting a background tab title must not activate it').toBe(activeBeforeSel);
  expect(docAfterSel, 'displayed document unchanged by the title selection').toEqual(docBeforeSel);
  expect(order4, 'text selection did not reorder the strip').toEqual(orderBeforeSel);
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-text-selected.png') });

  // 5. A PLAIN click on a background tab still activates it (DEF-034 must
  //    survive the DEF-413 title-activation deferral), and the close button
  //    still closes.
  const clickTarget = order4[1];
  expect(clickTarget, 'step-5 click target is a background (non-active) tab').not.toBe(activeAfterSel);
  await win.locator(`[data-tab-id="${clickTarget}"]`).click();
  await win.waitForTimeout(400);
  const activeAfterClick = await activeTabId();
  console.log(`[P58-reorder] click-activation target=${clickTarget} active=${activeAfterClick}`);
  expect(activeAfterClick, 'single click activates the clicked tab').toBe(clickTarget);

  const beforeClose = await tabOrder();
  const closeTarget = beforeClose[2];
  await win.locator(`[data-tab-id="${closeTarget}"] .tab-close`).click();
  await win.waitForTimeout(700);
  const afterClose = await tabOrder();
  console.log(`[P58-reorder] close target=${closeTarget} before=${JSON.stringify(beforeClose)} after=${JSON.stringify(afterClose)}`);
  expect(afterClose.length, 'close button removed one tab').toBe(2);
  expect(afterClose, 'closed tab is gone').not.toContain(closeTarget);
});