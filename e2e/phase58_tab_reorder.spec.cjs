// Phase 58 (chunk 5) — tab reorder + whole-tab drag (Phase 59 item 1).
//
// The assigned behaviour (Phase 59 item 1 SUPERSEDES the Phase-58
// selectable-title feature):
//   - a tab can be dragged left/right and the tab ORDER changes while the
//     ACTIVE document stays unchanged (drag must not re-activate or swap docs);
//   - the tab TITLE is NOT selectable: a drag-select across it produces NO
//     text selection (the old copyable-title behaviour is withdrawn);
//   - a drag starting on the TITLE (not the colour chip) still reorders, and a
//     downward drag from the title still tears the tab out to a new window.
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

// Phase 59 (item 1) — drag a tab by its TITLE text (the whole tab is the drag
// surface now; the title is user-select: none so no selection fights the drag).
async function dragTabByTitle(tabId, targetX) {
  const title = win.locator(`[data-tab-id="${tabId}"] .tab-title`);
  const box = await title.boundingBox();
  const startX = box.x + Math.min(6, box.width / 2);
  const y = box.y + box.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 10, y, { steps: 3 }); // cross the 6px threshold
  await win.mouse.move(targetX, y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

test('tab reorder changes order without changing the active document; the title is not selectable and drags from the title', async () => {
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

  // 4. Phase 59 (item 1) — the title is NOT selectable. A drag-select across a
  //    background tab's title produces NO text selection (the Phase-58
  //    copyable-title behaviour is withdrawn). The same gesture now arms the
  //    tab drag, so the strip may reorder; that is expected and is not asserted
  //    here (the title-origin reorder is step 5).
  const selTab = order3[2];
  expect(selTab, 'step-4 selection target is a background (non-active) tab').not.toBe(initialActive);
  const titleUserSelect = await win.locator(`[data-tab-id="${selTab}"] .tab-title`).evaluate(
    (el) => getComputedStyle(el).userSelect,
  );
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
  console.log(`[P58-reorder] title user-select=${titleUserSelect} selection=${JSON.stringify(selection)} (expected empty)`);
  expect(titleUserSelect, 'the tab title is user-select: none').toBe('none');
  expect(selection, 'drag-select across the title selects NO text').toBe('');
  await win.screenshot({ path: path.join(SHOTS, 'p59-tab-title-not-selectable.png') });

  // 5. Phase 59 (item 1) — a drag starting on the TITLE (not the colour chip)
  //    still reorders. Drag the LAST tab's title to the far left.
  const orderBeforeTitleDrag = await tabOrder();
  const titleDragId = orderBeforeTitleDrag[orderBeforeTitleDrag.length - 1];
  const firstBox2 = await win.locator(`[data-tab-id="${orderBeforeTitleDrag[0]}"]`).boundingBox();
  await dragTabByTitle(titleDragId, firstBox2.x + 2);
  const orderAfterTitleDrag = await tabOrder();
  console.log(`[P58-reorder] title-origin drag ${titleDragId}: before=${JSON.stringify(orderBeforeTitleDrag)} after=${JSON.stringify(orderAfterTitleDrag)}`);
  expect(orderAfterTitleDrag[0], 'a title-origin drag moved the last tab to the front').toBe(titleDragId);
  await win.screenshot({ path: path.join(SHOTS, 'p59-tab-title-drag-reorder.png') });

  // 6. A PLAIN click on a background tab still activates it (DEF-034 must
  //    survive), and the close button still closes.
  const order5 = await tabOrder();
  const activeNow = await activeTabId();
  const clickTarget = order5.find((id) => id !== activeNow);
  expect(clickTarget, 'step-6 click target is a background (non-active) tab').toBeTruthy();
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

// Phase 59 (item 1) — a downward drag starting on the tab TITLE (not the chip)
// still tears the tab out to a new #detached window.
test('a downward drag from the tab TITLE tears the tab out to a new window', async () => {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await win.waitForTimeout(700);

  const titleBox = await win.locator('[data-tab-id] .tab-title').first().boundingBox();
  const strip = await win.locator('.tab-list').boundingBox();
  const startX = titleBox.x + Math.min(6, titleBox.width / 2);
  const startY = titleBox.y + titleBox.height / 2;
  const targetY = strip.y + strip.height + 60;
  console.log(`[P59-title-tearout] titleCenter=(${startX.toFixed(1)},${startY.toFixed(1)}) stripBottom=${(strip.y + strip.height).toFixed(1)} targetY=${targetY.toFixed(1)}`);

  const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.mouse.move(startX, startY + 10, { steps: 4 }); // cross the 6px arm threshold, straight down
  await win.mouse.move(startX, targetY, { steps: 12 }); // straight down, below the strip
  await win.mouse.up();
  await win.waitForTimeout(500);

  const second = await secondP;
  expect(second, 'a title-origin downward drag did not open a new window').not.toBeNull();
  await second.waitForLoadState('domcontentloaded');
  console.log(`[P59-title-tearout] new window url=${second.url()}`);
  expect(second.url(), 'new window URL carries the #detached hash').toContain('#detached');
  await second.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await second.screenshot({ path: path.join(SHOTS, 'p59-tab-title-tearout.png') });
});