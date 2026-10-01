// Phase 60 — live tab drag (direct manipulation).
//
// Verifies the TFL-55 behaviour that replaced the static `.tab-drop-marker`:
//   - criterion 1: the dragged tab's box FOLLOWS the pointer live (its
//     boundingBox.left tracks each mid-drag pointer X; `data-tab-dragging`
//     is present and `data-tab-drag-x` mirrors the sampled travel);
//   - criterion 2: neighbouring tabs REFLOW (translateX gap) as the pointer
//     crosses a slot midpoint; there is NO `.tab-drop-marker`; the reflow
//     rides a computed transform transition (instant when Animations OFF);
//   - criterion 3: on release the committed DOM order equals the slot the gap
//     showed, the active tab id + displayed document are unchanged, and
//     dragging back restores the original order;
//   - criterion 6: with enough tabs to squeeze the strip, live follow and
//     animated reflow still work and the active tab is not clipped.
//
// Launches only through the canonical launchApp helper. The phase58 and
// phase59 specs are left untouched; this spec is additive.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
  if (app) await hardClose(app, 'p60-tabdrag');
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

async function docIdentity() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { activeTabId: d.activeTabId, activeDocBytes: d.activeDocBytes, pageCount: d.pageCount };
  });
}

// Mirrors the reducer's move semantics: splice the moved id out and in at the
// committed slot index (computeDrop returns the FINAL index).
function reorder(order, movedId, target) {
  const arr = order.slice();
  const from = arr.indexOf(movedId);
  const [el] = arr.splice(from, 1);
  arr.splice(target, 0, el);
  return arr;
}

async function chipBox(tabId) {
  return win.locator(`[data-tab-id="${tabId}"] .tab-title`).boundingBox();
}

async function sampleDragged(tabId) {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      top: +r.top.toFixed(2),
      dragX: el.getAttribute('data-tab-drag-x'),
      dragY: el.getAttribute('data-tab-drag-y'),
      dragging: el.getAttribute('data-tab-dragging'),
    };
  }, tabId);
}

async function reflowOf(tabId) {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return {
      attr: el.getAttribute('data-tab-reflow'),
      transform: el.style.transform,
      transitionProperty: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
    };
  }, tabId);
}

test('criterion 1+2: the dragged tab follows the pointer and a neighbour reflows to open the gap (no drop marker)', async () => {
  await openThree();
  const order = await tabOrder();
  const active0 = await activeTabId();
  const dragId = order[1];
  const neighbour = order[0];
  expect(dragId, 'drag target is a background (non-active) tab').not.toBe(active0);

  const resting = await sampleDragged(dragId);
  const chip = await chipBox(dragId);
  const startX = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  const neighbourRect = await win.locator(`[data-tab-id="${neighbour}"]`).boundingBox();
  const neighbourMid = neighbourRect.x + neighbourRect.width / 2;

  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 12, y, { steps: 4 }); // arm past the 6px threshold
  await win.waitForTimeout(80);

  // criterion 1 — sample the dragged box at 3+ mid-drag pointer X positions,
  // all BEFORE mouse.up. The box left must follow the pointer; the last sample
  // returns to the right so the reflow state below starts from the origin slot.
  const positions = [startX - 30, startX - 70, Math.min(neighbourMid - 12, startX - 110), startX + 40];
  const samples = [];
  for (const px of positions) {
    await win.mouse.move(px, y, { steps: 6 });
    await win.waitForTimeout(70);
    const s = await sampleDragged(dragId);
    samples.push({ pointerX: +px.toFixed(2), dx: +(px - startX).toFixed(2), ...s });
  }
  console.log(`[P60-follow] startX=${startX.toFixed(2)} restingLeft=${resting.left} samples=${JSON.stringify(samples)}`);

  expect(samples.length, 'three or more mid-drag samples').toBeGreaterThanOrEqual(3);
  for (const s of samples) {
    expect(s.dragging, 'the dragged tab carries data-tab-dragging="true"').toBe('true');
    expect(s.dragX, 'data-tab-drag-x tracks the sampled travel').not.toBeNull();
    expect(Math.abs(Number(s.dragX) - s.dx), `drag-x ${s.dragX} tracks travel ${s.dx}`).toBeLessThanOrEqual(2);
    expect(Math.abs(s.left - (resting.left + s.dx)), `box.left ${s.left} follows pointer delta ${s.dx}`).toBeLessThanOrEqual(2.5);
  }
  expect(new Set(samples.map((s) => s.left)).size, 'box.left CHANGES across the sampled X positions').toBeGreaterThan(1);

  const draggingCount = await win.locator('[data-tab-id][data-tab-dragging="true"]').count();
  const markers = await win.locator('.tab-drop-marker').count();
  const reorderAttr = await win.locator('.tab-list').getAttribute('data-reorder');
  console.log(`[P60-follow] draggingCount=${draggingCount} dropMarkers=${markers} data-reorder=${reorderAttr}`);
  expect(draggingCount, 'exactly one live dragged tab').toBe(1);
  expect(markers, 'the static .tab-drop-marker is gone').toBe(0);
  expect(reorderAttr, 'the strip is in reorder mode').toBe('true');

  // criterion 2 — sample the RIGHT neighbour (order[2]) as the pointer crosses
  // its midpoint. It reflows left only past that midpoint; moving back left of
  // the SHIFTED midpoint clears the gap. (The reflow moves the very midpoint
  // the slot test reads, so the crossing position is taken from the live box.)
  const sampleId = order[2];
  const originReflow = await reflowOf(sampleId);
  await win.mouse.move(startX + 300, y, { steps: 10 });
  await win.waitForTimeout(90);
  const openReflow = await reflowOf(sampleId);
  const rects = await win.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const r = document.querySelector(`[data-tab-id="${id}"]`).getBoundingClientRect();
      out[id] = { left: +r.left.toFixed(1), mid: +(r.left + r.width / 2).toFixed(1) };
    }
    out.drop = document.querySelector('.tab-list').getAttribute('data-tab-drop');
    return out;
  }, order);
  const rep = rects[order[0]];
  await win.mouse.move(rep.mid + 20, y, { steps: 8 });
  await win.waitForTimeout(120);
  const closedReflow = await reflowOf(sampleId);
  const dropClosed = await win.locator('.tab-list').getAttribute('data-tab-drop');
  const rootAnim = await win.evaluate(() => document.documentElement.getAttribute('data-animations'));
  console.log(`[P60-reflow] animRoot=${rootAnim} open=${JSON.stringify(openReflow)} rects=${JSON.stringify(rects)} closed=${JSON.stringify(closedReflow)} dropClosed=${dropClosed}`);
  expect(originReflow.attr, 'no gap at the origin slot').toBeNull();
  expect(openReflow.attr, 'the neighbour opens a gap past the midpoint').not.toBeNull();
  expect(Number(openReflow.attr), 'the gap is a negative (leftward) shift').toBeLessThan(0);
  expect(closedReflow.attr, 'the gap clears once the pointer is left of the shifted midpoint').toBeNull();
  expect(openReflow.transform, 'the gap rides a translateX transform').toContain('translateX');
  expect(openReflow.transitionProperty, 'the reflow carries a transform transition').toContain('transform');
  console.log(`[P60-reflow] reflow transition duration=${openReflow.transitionDuration} (animations root=${rootAnim}; must be instant when off)`);

  await win.mouse.up();
  await win.waitForTimeout(300);
});

test('criterion 3: release commits the slot the gap showed, the active document is preserved, and dragging back restores the order', async () => {
  await openThree();
  const initialOrder = await tabOrder();
  const initialActive = await activeTabId();
  const initialDoc = await docIdentity();
  const dragId = initialOrder[0];
  expect(dragId, 'drag target is a background (non-active) tab').not.toBe(initialActive);

  // First drag: move the first tab to the far right, past every midpoint, so
  // the committed slot is the last index.
  const chip = await chipBox(dragId);
  const startX = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  const lastBox = await win.locator(`[data-tab-id="${initialOrder[2]}"]`).boundingBox();
  const farRight = lastBox.x + lastBox.width + 20;

  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX + 14, y, { steps: 4 });
  await win.waitForTimeout(60);
  await win.mouse.move(farRight, y, { steps: 14 });
  await win.waitForTimeout(120);

  const gapSlot = await win.locator('.tab-list').getAttribute('data-tab-drop');
  const gapLeft = await sampleDragged(dragId);
  await win.screenshot({ path: path.join(SHOTS, 'p60-tab-drag.png') });
  await win.mouse.up();
  await win.waitForTimeout(400);

  const order1 = await tabOrder();
  const expected1 = reorder(initialOrder, dragId, Number(gapSlot));
  console.log(`[P60-commit] midDrag=${JSON.stringify(gapLeft)} gapSlot=${gapSlot} expected=${JSON.stringify(expected1)} actual=${JSON.stringify(order1)}`);
  expect(Number(gapSlot), 'the gap showed the last slot').toBe(initialOrder.length - 1);
  expect(order1, 'committed DOM order equals the slot the gap showed').toEqual(expected1);
  expect(await activeTabId(), 'active tab id unchanged by the reorder').toBe(initialActive);
  expect(await docIdentity(), 'displayed document unchanged by the reorder').toEqual(initialDoc);
  await win.screenshot({ path: path.join(SHOTS, 'p60-tab-drag-released.png') });

  // Drag back: move the same tab to the front again.
  const orderNow = await tabOrder();
  const chip2 = await chipBox(dragId);
  const startX2 = chip2.x + chip2.width / 2;
  const y2 = chip2.y + chip2.height / 2;
  const firstBox = await win.locator(`[data-tab-id="${orderNow[0]}"]`).boundingBox();
  await win.mouse.move(startX2, y2);
  await win.mouse.down();
  await win.mouse.move(startX2 - 14, y2, { steps: 4 });
  await win.waitForTimeout(60);
  await win.mouse.move(firstBox.x + 2, y2, { steps: 14 });
  await win.waitForTimeout(120);
  await win.mouse.up();
  await win.waitForTimeout(400);

  const order2 = await tabOrder();
  console.log(`[P60-commit] drag-back order=${JSON.stringify(order2)} initial=${JSON.stringify(initialOrder)}`);
  expect(order2, 'dragging back restores the original order').toEqual(initialOrder);
  expect(await activeTabId(), 'active tab still unchanged after the drag back').toBe(initialActive);
  expect(await docIdentity(), 'displayed document still unchanged after the drag back').toEqual(initialDoc);
});

test('criterion 6: with the strip squeezed, live follow and animated reflow still work and the active tab is not clipped', async () => {
  const N = 14;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p60-squeeze-'));
  const src = getSamplePath('report.pdf');
  for (let i = 0; i < N; i += 1) fs.copyFileSync(src, path.join(tmp, `squeeze-${i + 1}.pdf`));
  for (let i = 0; i < N; i += 1) await openPathDialog(path.join(tmp, `squeeze-${i + 1}.pdf`));
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length >= n, N, { timeout: 60000 });
  await win.waitForTimeout(800);

  const order = await tabOrder();
  const activeId = await activeTabId();
  const listBox = await win.locator('.tab-list').boundingBox();
  const restWidths = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => +t.getBoundingClientRect().width.toFixed(2)));
  const activeRest = await win.locator(`[data-tab-id="${activeId}"]`).boundingBox();
  console.log(`[P60-squeeze] count=${order.length} active=${activeId} maxW=${Math.max(...restWidths)} list=[${listBox.x.toFixed(1)},${(listBox.x + listBox.width).toFixed(1)}] active=[${activeRest.x.toFixed(1)},${(activeRest.x + activeRest.width).toFixed(1)}]`);
  expect(order.length, 'the strip holds every opened tab').toBe(N);
  expect(Math.max(...restWidths), 'tabs are squeezed below the natural width').toBeLessThan(200);
  expect(activeRest.x, 'active tab not clipped at rest (left)').toBeGreaterThanOrEqual(listBox.x - 1);
  expect(activeRest.x + activeRest.width, 'active tab not clipped at rest (right)').toBeLessThanOrEqual(listBox.x + listBox.width + 1);

  // Pick a background tab whose colour chip is inside the strip's VISIBLE
  // viewport (the strip can be horizontally scrolled, so the first tab may be
  // clipped at the left edge and not hittable by an absolute pointer move).
  let dragId = null;
  for (const id of order) {
    if (id === activeId) continue;
    const cb = await chipBox(id).catch(() => null);
    if (cb === null) continue;
    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    if (cx > listBox.x + 2 && cx < listBox.x + listBox.width - 2 && cy > 0 && cy < listBox.y + listBox.height + 40) {
      dragId = id;
      break;
    }
  }
  expect(dragId, 'a hittable background tab exists').not.toBeNull();

  // Drag the background tab rightwards and verify live follow + reflow.
  const chip = await chipBox(dragId);
  const startX = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  const hit = await win.evaluate(([x, yy]) => {
    const el = document.elementFromPoint(x, yy);
    if (el === null) return 'none';
    const tabEl = el.closest('[data-tab-id]');
    return tabEl === null ? `${el.tagName}.${el.className}` : tabEl.getAttribute('data-tab-id');
  }, [startX, y]);
  console.log(`[P60-squeeze] dragId=${dragId} chipCenter=(${startX.toFixed(1)},${y.toFixed(1)}) hitTab=${hit}`);
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX + 10, y, { steps: 4 });
  await win.waitForTimeout(60);
  const s1 = await sampleDragged(dragId);
  const targetX = listBox.x + listBox.width - 60;
  await win.mouse.move(targetX, y, { steps: 12 });
  await win.waitForTimeout(90);
  const s2 = await sampleDragged(dragId);
  const reflowNow = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-reflow]')).map((el) => ({
      id: el.getAttribute('data-tab-id'),
      r: el.getAttribute('data-tab-reflow'),
    })));
  console.log(`[P60-squeeze] follow s1=${JSON.stringify(s1)} s2=${JSON.stringify(s2)} reflow=${JSON.stringify(reflowNow)}`);
  expect(s1.left !== s2.left || s1.dragX !== s2.dragX, 'the dragged tab follows the pointer under overflow').toBeTruthy();
  expect(reflowNow.length, 'at least one neighbour reflows under overflow').toBeGreaterThan(0);
  expect(reflowNow[0].r, 'the reflow gap is non-zero').not.toBe('0');

  const trans = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    const cs = getComputedStyle(el);
    return { p: cs.transitionProperty, d: cs.transitionDuration, anim: document.documentElement.getAttribute('data-animations') };
  }, reflowNow[0].id);
  const rootAnim = await win.evaluate(() => document.documentElement.getAttribute('data-animations'));
  console.log(`[P60-squeeze] reflow transition=${JSON.stringify(trans)} animRoot=${rootAnim}`);
  expect(trans.p, 'the reflow under overflow carries a transform transition').toContain('transform');
  await win.screenshot({ path: path.join(SHOTS, 'p60-tab-drag-overflow.png') });
  await win.mouse.up();
  await win.waitForTimeout(400);

  // The restored active tab is still fully inside the strip after the drag.
  const listBox2 = await win.locator('.tab-list').boundingBox();
  const activeAfter = await win.locator(`[data-tab-id="${await activeTabId()}"]`).boundingBox();
  console.log(`[P60-squeeze] post active=[${activeAfter.x.toFixed(1)},${(activeAfter.x + activeAfter.width).toFixed(1)}] listRight=${(listBox2.x + listBox2.width).toFixed(1)}`);
  expect(activeAfter.x, 'restored active tab not clipped (left)').toBeGreaterThanOrEqual(listBox2.x - 1);
  expect(activeAfter.x + activeAfter.width, 'restored active tab not clipped (right)').toBeLessThanOrEqual(listBox2.x + listBox2.width + 1);
});

// DEF-433 (from ADV-130) — reordering the ACTIVE tab in the squeezed strip used
// to leave it clipped: neither `activeId` nor `tabs.length` changes, so the
// shared scroll effect never re-ran. Drag the active tab across to the far
// edge and assert the commit keeps it inside `.tab-list`.
//
// Phase 72 (rulings 8/9) SUPERSEDES the DEF-433 scroll remedy: `.tab-list` is no
// longer a scroll container (`overflow-x: hidden`) and every tab shrinks
// UNIFORMLY to fit, so `scrollLeft` is permanently 0. The real criterion-6
// guarantee is the no-clip assertion (kept); the scroll assertion is repointed
// to the Phase 72 no-scroll contract.
async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target === undefined || target === null) return;
    if (target.isMaximized()) target.unmaximize();
    target.setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

test('DEF-433 (Phase 72): at 640px, reordering the active tab keeps it inside the uniform-fit strip', async () => {
  await openThree();
  // Resize AFTER the tabs exist: the strip shrinks the tabs uniformly and the
  // active tab must stay inside `.tab-list` across a reorder.
  await setWindowSize(640, 620);
  await win.waitForTimeout(500);

  // Drag the ACTIVE tab to the far (right) edge so the reorder is real and the
  // tab is pushed past the strip edge; the strip keeps its old offset and would
  // leave it clipped unless the commit re-asserts its visibility.
  const activeId = await activeTabId();
  const listBox = await win.locator('.tab-list').boundingBox();
  const scrollBefore = await win.evaluate(() => document.querySelector('.tab-list').scrollLeft);
  const activeBefore = await win.locator(`[data-tab-id="${activeId}"]`).boundingBox();
  const chip = await chipBox(activeId);
  const startX = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  const farRight = listBox.x + listBox.width - 6;
  console.log(`[P60-active] active=${activeId} order=${JSON.stringify(await tabOrder())} list=[${listBox.x.toFixed(1)},${(listBox.x + listBox.width).toFixed(1)}] activeBefore=[${activeBefore.x.toFixed(1)},${(activeBefore.x + activeBefore.width).toFixed(1)}] scrollBefore=${scrollBefore.toFixed(1)} startX=${startX.toFixed(1)} farRight=${farRight.toFixed(1)}`);

  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX + 12, y, { steps: 4 });
  await win.waitForTimeout(60);
  await win.mouse.move(farRight, y, { steps: 14 });
  await win.waitForTimeout(140);
  await win.screenshot({ path: path.join(SHOTS, 'p60-tab-drag-active-640.png') });
  await win.mouse.up();
  await win.waitForTimeout(500);

  const listBox2 = await win.locator('.tab-list').boundingBox();
  const activeAfter = await win.locator(`[data-tab-id="${await activeTabId()}"]`).boundingBox();
  const scrollAfter = await win.evaluate(() => document.querySelector('.tab-list').scrollLeft);
  console.log(`[P60-active] post order=${JSON.stringify(await tabOrder())} active=[${activeAfter.x.toFixed(1)},${(activeAfter.x + activeAfter.width).toFixed(1)}] list=[${listBox2.x.toFixed(1)},${(listBox2.x + listBox2.width).toFixed(1)}] scrollAfter=${scrollAfter.toFixed(1)}`);
  expect(await activeTabId(), 'the dragged tab is still active after the reorder').toBe(activeId);
  expect(activeAfter.x, 'reordered active tab not clipped (left)').toBeGreaterThanOrEqual(listBox2.x - 1);
  expect(activeAfter.x + activeAfter.width, 'reordered active tab not clipped (right)').toBeLessThanOrEqual(listBox2.x + listBox2.width + 1);
  // Phase 72 (rulings 8/9) — the strip is not a scroll container, so the
  // DEF-433 scroll remedy is retired; the no-clip assertion above is the
  // criterion-6 guarantee and `scrollLeft` is permanently 0.
  expect(scrollAfter, 'the strip is not a scroll container (Phase 72 ruling 9), so scrollLeft stays 0').toBe(0);
});