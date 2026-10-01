// Phase 61 — tab tear-out (DEF-432 / ADV-129), repointed to the Phase 72 contract.
//
// Phase 72 (ruling 9, item 8) SUPERSEDES the DEF-432 premise: `.tab-list` stops
// being a scroll container (`overflow-x: hidden`, no `::-webkit-scrollbar`
// rule) and every tab shrinks UNIFORMLY to fit, so the strip never overflows and
// `scrollLeft` is permanently 0 — there is nothing to "snap". The passing 3-tab
// spec (phase61_tab_tearout.spec.cjs) proves the tear-out presentation; this spec
// opens a full strip, arms a tear-out and moves the pointer straight DOWN past
// the threshold. It asserts:
//   (a) the tear-out still arms (`data-tab-dragging` + `data-tab-tearout`);
//   (b) the dragged tab's box tracks the pointer on BOTH axes within ~2.5px;
//   (c) every non-dragged tab's box stays within ~2px of its resting position;
//   (d) `.tab-list` is non-scrolling: computed `overflow-x` is `hidden`,
//       `scrollWidth <= clientWidth` and `scrollLeft === 0` (the retired
//       scrollLeft-snap assertions are dropped — Phase 72 ruling 9 makes them
//       trivially 0).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const TOL_REST = 2; // px — non-dragged tabs must not move when tear-out arms
const TOL_FOLLOW = 2.5; // px — dragged tab must track the pointer on both axes
const TARGET_TABS = 8; // a full strip (Phase 72: it fits, uniformly)

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
  if (app) await hardClose(app, 'p61-tearout-overflow');
  app = null;
  win = null;
});

async function listMetrics() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    if (list === null) return null;
    const r = list.getBoundingClientRect();
    return {
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      scrollLeft: list.scrollLeft,
      overflowX: getComputedStyle(list).overflowX,
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
    };
  });
}

// Open report.pdf, then click `+` until the strip holds TARGET_TABS tabs.
async function openFullStrip() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  for (let i = 1; i < TARGET_TABS; i += 1) {
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(60);
  }
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length >= n, TARGET_TABS, { timeout: 30000 });
  await win.waitForTimeout(400);
  const m = await listMetrics();
  expect(m, '.tab-list exists').not.toBeNull();
  return m;
}

async function allTabBoxes() {
  return win.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => {
        const r = el.getBoundingClientRect();
        return [
          el.getAttribute('data-tab-id'),
          { left: +r.left.toFixed(2), top: +r.top.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) },
        ];
      }),
    ),
  );
}

// The first non-active tab whose `.tab-title` is fully visible in the strip; the
// retired `.tab-colour-chip` handle is repointed to `.tab-title` (mirrors
// TFL-204: grab `x + min(6, w/2)`, `y + h/2`).
async function pickVisibleNonActiveTab() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    const activeId = active === null ? null : active.getAttribute('data-tab-id');
    const lr = list.getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    for (const t of tabs) {
      const id = t.getAttribute('data-tab-id');
      if (id === activeId) continue;
      const title = t.querySelector('.tab-title');
      if (title === null) continue;
      const tr = title.getBoundingClientRect();
      if (tr.width <= 0) continue;
      const startX = tr.left + Math.min(6, tr.width / 2);
      const startY = tr.top + tr.height / 2;
      if (startX > lr.left + 1 && startX < lr.right - 1 && startY >= lr.top - 1 && startY <= lr.bottom + 1) {
        return { id, startX, startY };
      }
    }
    return null;
  });
}

async function sampleDragged(tabId) {
  return win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const list = document.querySelector('.tab-list');
    return {
      left: +r.left.toFixed(2),
      top: +r.top.toFixed(2),
      dragX: el.getAttribute('data-tab-drag-x'),
      dragY: el.getAttribute('data-tab-drag-y'),
      dragging: el.getAttribute('data-tab-dragging'),
      tearOut: list === null ? null : list.getAttribute('data-tab-tearout'),
    };
  }, tabId);
}

test('DEF-432 (Phase 72): tear-out on a full strip arms, follows the pointer, and keeps the strip non-scrolling', async () => {
  const strip = await openFullStrip();
  console.log(`[P61-ovf] strip metrics ${JSON.stringify(strip)}`);
  const stripBottom = strip.bottom;

  // Phase 72 (ruling 9) — the strip is a clip, not a scroller.
  expect(strip.overflowX, '.tab-list computed overflow-x is hidden').toBe('hidden');
  expect(strip.scrollWidth, '.tab-list never overflows (scrollWidth <= clientWidth)').toBeLessThanOrEqual(strip.clientWidth);
  expect(strip.scrollLeft, '.tab-list scrollLeft is 0 (no scroller)').toBe(0);

  const pick = await pickVisibleNonActiveTab();
  expect(pick, 'a visible non-active tab title exists to drag').not.toBeNull();
  const dragId = pick.id;
  const startX = pick.startX;
  const startY = pick.startY;

  await win.mouse.move(startX, startY);
  await win.mouse.down();
  // DEF-453 — the mousedown runs the DEF-034 activation: the grabbed tab
  // becomes active (drops to the strip's foot at 30px) and the ex-active tab
  // re-centres at 26px. Let that SELECTION reflow settle before baselining, so
  // the non-dragged tolerance below measures the TEAR-OUT reflow and not the
  // activation. No pointer move has happened yet, so no drag transform is
  // applied: `restingDrag` is the dragged tab's post-activation box and the
  // follow math (restingDrag + pointer travel) stays exact.
  await win.waitForTimeout(150);

  const restingAll = await allTabBoxes();
  const restingDrag = restingAll[dragId];
  console.log(`[P61-ovf] dragId=${dragId} start=(${startX.toFixed(2)},${startY.toFixed(2)}) restingDrag=${JSON.stringify(restingDrag)}`);

  await win.mouse.move(startX, startY + 10, { steps: 4 }); // arm past the 6px total-movement threshold
  await win.waitForTimeout(80);

  const pointerX = startX;
  const pointerY = stripBottom + 40; // straight down, past bottom + 24
  await win.mouse.move(pointerX, pointerY, { steps: 8 });
  await win.waitForTimeout(120);

  const afterStrip = await listMetrics();
  const tearing = await sampleDragged(dragId);
  const afterAll = await allTabBoxes();
  await win.screenshot({ path: path.join(SHOTS, 'p61-tearout-overflow.png') });
  console.log(`[P61-ovf] tearOut=${tearing.tearOut} afterOverflowX=${afterStrip.overflowX} dragging=${tearing.dragging}`);
  console.log(`[P61-ovf] tearing=${JSON.stringify(tearing)}`);

  // (a) Precondition: the tear-out state actually armed.
  expect(tearing, 'the dragged tab is still live').not.toBeNull();
  expect(tearing.dragging, 'the tab carries data-tab-dragging="true"').toBe('true');
  expect(tearing.tearOut, '.tab-list carries data-tab-tearout="true"').toBe('true');

  // (d) The strip is still a non-scrolling clip while the tear-out is armed.
  expect(afterStrip.overflowX, 'the tear-out does not turn .tab-list into a scroller').toBe('hidden');
  expect(afterStrip.scrollWidth, 'the tear-out keeps .tab-list clipped (scrollWidth <= clientWidth)').toBeLessThanOrEqual(afterStrip.clientWidth);
  expect(afterStrip.scrollLeft, 'scrollLeft is 0 (Phase 72 ruling 9: no scroller)').toBe(0);

  // (c) every non-dragged tab stays within ~2px of its resting position.
  for (const [id, box] of Object.entries(afterAll)) {
    if (id === dragId) continue;
    const rest = restingAll[id];
    const dLeft = Math.abs(box.left - rest.left);
    const dTop = Math.abs(box.top - rest.top);
    console.log(`[P61-ovf-rest] ${id} dLeft=${dLeft.toFixed(2)} dTop=${dTop.toFixed(2)}`);
    expect(dLeft, `non-dragged tab ${id} does not jump horizontally`).toBeLessThanOrEqual(TOL_REST);
    expect(dTop, `non-dragged tab ${id} does not jump vertically`).toBeLessThanOrEqual(TOL_REST);
  }

  // (b) the dragged tab tracks the pointer on both axes.
  const dx = pointerX - startX;
  const dy = pointerY - startY;
  console.log(`[P61-ovf-follow] dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} dragX=${tearing.dragX} dragY=${tearing.dragY} left=${tearing.left} top=${tearing.top} expectedLeft=${(restingDrag.left + dx).toFixed(2)} expectedTop=${(restingDrag.top + dy).toFixed(2)}`);
  expect(Math.abs(Number(tearing.dragX) - dx), 'drag-x tracks the pointer travel').toBeLessThanOrEqual(TOL_FOLLOW);
  expect(Math.abs(Number(tearing.dragY) - dy), 'drag-y tracks the pointer travel').toBeLessThanOrEqual(TOL_FOLLOW);
  expect(Math.abs(tearing.left - (restingDrag.left + dx)), 'box.left follows the pointer X').toBeLessThanOrEqual(TOL_FOLLOW);
  expect(Math.abs(tearing.top - (restingDrag.top + dy)), 'box.top follows the pointer Y').toBeLessThanOrEqual(TOL_FOLLOW);

  await win.mouse.up();
  await win.waitForTimeout(300);
});
