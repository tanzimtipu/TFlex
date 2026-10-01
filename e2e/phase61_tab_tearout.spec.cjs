// Phase 61 — tab tear-out drag: the tab leaves the bar, un-clipped and
// translucent.
//
// Verifies the TFL-62 presentation layered on the Phase 60 live drag:
//   - criterion 1: while the pointer is past the tear-out threshold (below the
//     strip bottom) the dragged tab's box tracks the pointer on BOTH axes (its
//     boundingBox left AND top follow the sampled pointer X/Y) with a mid-drag
//     screenshot `screenshots/p61-tab-tearout.png`;
//   - criterion 2: the dragged tab's computed opacity is below 1 while outside
//     and below the non-dragged tabs' opacity (1), and returns to 1 after
//     release / when the drag comes back inside;
//   - criterion 3: while outside, the dragged box paints BELOW the strip
//     (top > strip bottom) and is NOT clipped — `document.elementFromPoint` at
//     a point below the strip resolves to the dragged tab.
//
// The detach / reorder commit semantics are Phase 58 / Phase 60 and unchanged;
// this spec releases back INSIDE the strip so the origin window keeps its tab
// and the opacity return can be measured.
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
  if (app) await hardClose(app, 'p61-tab-tearout');
  app = null;
  win = null;
});

async function openPathDialog(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function openThree() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openPathDialog(getSamplePath('long.pdf'));
  await openPathDialog(getSamplePath('form.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30000 });
  await win.waitForTimeout(500);
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

async function chipBox(tabId) {
  return win.locator(`[data-tab-id="${tabId}"] .tab-title`).boundingBox();
}

async function stripState() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    const area = document.querySelector('.tab-area');
    if (list === null) return null;
    const r = list.getBoundingClientRect();
    return {
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      listTearOut: list.getAttribute('data-tab-tearout'),
      areaTearOut: area === null ? null : area.getAttribute('data-tab-tearout'),
    };
  });
}

// The dragged tab's live geometry plus the two Phase 61 signals: the tear-out
// attribute owners and the computed opacity.
async function sampleDragged(tabId) {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    return {
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      dragX: el.getAttribute('data-tab-drag-x'),
      dragY: el.getAttribute('data-tab-drag-y'),
      dragging: el.getAttribute('data-tab-dragging'),
      opacity: +getComputedStyle(el).opacity,
      areaTearOut: area === null ? null : area.getAttribute('data-tab-tearout'),
      listTearOut: list === null ? null : list.getAttribute('data-tab-tearout'),
    };
  }, tabId);
}

async function nonDraggedOpacity(tabId) {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    return el === null ? null : +getComputedStyle(el).opacity;
  }, tabId);
}

async function hitAt(x, y) {
  return win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (el === null) return 'none';
    const tabEl = el.closest('[data-tab-id]');
    return tabEl === null ? `${el.tagName}.${el.className}` : tabEl.getAttribute('data-tab-id');
  }, [x, y]);
}

test('criteria 1-3: past the threshold the dragged tab leaves the bar on both axes, un-clipped and translucent', async () => {
  await openThree();
  const order = await tabOrder();
  const active0 = await activeTabId();
  const dragId = order.find((id) => id !== active0);
  expect(dragId, 'a background (non-active) tab exists to drag').toBeTruthy();

  const strip = await stripState();
  const sb = strip.bottom;
  const chip = await chipBox(dragId);
  const startX = chip.x + chip.width / 2;
  const startY = chip.y + chip.height / 2;
  const nonDragged = order.find((id) => id !== dragId);

  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.waitForTimeout(150); // let the DEF-034 activation reflow settle
  const resting = await sampleDragged(dragId); // post-activation baseline, no drag yet
  console.log(`[P61] dragId=${dragId} active=${active0} stripBottom=${sb} resting=${JSON.stringify(resting)}`);

  await win.mouse.move(startX, startY + 10, { steps: 4 }); // arm past the 6px total-movement threshold
  await win.waitForTimeout(80);

  // Three or more positions BELOW the strip bottom (sb + 24 is the threshold),
  // varying BOTH axes so the follow is proven on each independently.
  const positions = [
    { x: startX - 45, y: sb + 40 },
    { x: startX - 5, y: sb + 70 },
    { x: startX + 40, y: sb + 100 },
    { x: startX + 75, y: sb + 130 },
  ];
  const samples = [];
  for (const p of positions) {
    await win.mouse.move(p.x, p.y, { steps: 6 });
    await win.waitForTimeout(80);
    const s = await sampleDragged(dragId);
    samples.push({ pointerX: +p.x.toFixed(2), pointerY: +p.y.toFixed(2), dx: +(p.x - startX).toFixed(2), dy: +(p.y - startY).toFixed(2), ...s });
  }
  console.log(`[P61-follow] startX=${startX.toFixed(2)} startY=${startY.toFixed(2)} samples=${JSON.stringify(samples)}`);

  // criterion 1 — both axes follow the pointer, and the tear-out hooks are on.
  expect(samples.length, 'three or more mid-drag samples below the strip').toBeGreaterThanOrEqual(3);
  for (const s of samples) {
    expect(s.dragging, 'the dragged tab carries data-tab-dragging="true"').toBe('true');
    expect(s.areaTearOut, '.tab-area carries data-tab-tearout="true"').toBe('true');
    expect(s.listTearOut, '.tab-list carries data-tab-tearout="true"').toBe('true');
    expect(Math.abs(Number(s.dragX) - s.dx), `drag-x ${s.dragX} tracks travel ${s.dx}`).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(s.dragY) - s.dy), `drag-y ${s.dragY} tracks travel ${s.dy}`).toBeLessThanOrEqual(2);
    expect(Math.abs(s.left - (resting.left + s.dx)), `box.left ${s.left} follows pointer dx ${s.dx}`).toBeLessThanOrEqual(2.5);
    expect(Math.abs(s.top - (resting.top + s.dy)), `box.top ${s.top} follows pointer dy ${s.dy}`).toBeLessThanOrEqual(2.5);
  }
  expect(new Set(samples.map((s) => s.left)).size, 'box.left CHANGES across the sampled positions').toBeGreaterThan(1);
  expect(new Set(samples.map((s) => s.top)).size, 'box.top CHANGES across the sampled positions').toBeGreaterThan(1);

  const last = samples[samples.length - 1];
  await win.waitForTimeout(150); // let the opacity transition settle before sampling
  const outside = await sampleDragged(dragId);
  await win.screenshot({ path: path.join(SHOTS, 'p61-tab-tearout.png') });

  // criterion 2 — translucent while outside, strictly below the other tabs.
  const otherOpacity = await nonDraggedOpacity(nonDragged);
  console.log(`[P61-opacity] outside=${outside.opacity} other=${otherOpacity}`);
  expect(outside.opacity, 'the dragged tab is translucent while outside').toBeLessThan(1);
  expect(outside.opacity, 'the dragged tab is below the non-dragged opacity').toBeLessThan(otherOpacity);
  expect(otherOpacity, 'the other tabs keep full opacity').toBe(1);

  // criterion 3 — paints below the bar and is not clipped.
  expect(outside.top, 'the dragged box paints BELOW the strip bottom').toBeGreaterThan(sb);
  const hit = await hitAt(last.pointerX, last.pointerY);
  console.log(`[P61-unclip] lastPointer=(${last.pointerX},${last.pointerY}) boxTop=${outside.top} stripBottom=${sb} elementFromPoint=${hit}`);
  expect(hit, 'elementFromPoint below the strip resolves to the dragged tab (not clipped)').toBe(dragId);
  await win.screenshot({ path: path.join(SHOTS, 'p61-tab-tearout-unclipped.png') });

  // criterion 2 (return path) — dragging back inside restores opacity 1 and
  // clears the tear-out attribute while the tab is still live.
  await win.mouse.move(startX, startY, { steps: 10 });
  await win.waitForTimeout(400);
  const backInside = await sampleDragged(dragId);
  console.log(`[P61-return] inside=${JSON.stringify(backInside)}`);
  expect(backInside.areaTearOut, 'the tear-out attribute clears back inside').toBeNull();
  expect(backInside.listTearOut, 'the list tear-out attribute clears back inside').toBeNull();
  expect(backInside.dragging, 'the tab is still the live drag').toBe('true');
  expect(backInside.opacity, 'opacity returns to 1 back inside').toBe(1);

  // criterion 2 (release path) — after mouse.up the tab is back to opacity 1
  // and no longer flagged as dragging. Releasing inside does not detach.
  await win.mouse.up();
  await win.waitForTimeout(400);
  const released = await sampleDragged(dragId);
  console.log(`[P61-release] released=${JSON.stringify(released)}`);
  expect(released, 'the tab is still in the origin window').not.toBeNull();
  expect(released.dragging, 'the dragging attribute clears on release').toBeNull();
  expect(released.areaTearOut, 'the tear-out attribute is clear after release').toBeNull();
  expect(released.opacity, 'opacity is back to 1 after release').toBe(1);
});
