// Phase 61 — tab tear-out on an OVERFLOWING strip (DEF-432 / ADV-129).
//
// The passing 3-tab spec (phase61_tab_tearout.spec.cjs) proves the tear-out
// presentation when the strip does not scroll. This spec widens the strip until
// `.tab-list` overflows, scrolls the scroller to its maximum, then arms a
// tear-out and moves the pointer straight DOWN past the threshold. It asserts
// the two observable criteria of the DEF-432 fix:
//   (a) releasing the strip's clip must NOT snap the scroller: every
//       non-dragged tab's box stays within ~2px of its resting position;
//   (b) the dragged tab's box still tracks the pointer on BOTH axes within
//       ~2.5px.
//
// On the pre-fix build `.tab-list` lost `overflow-x: auto` when tear-out armed,
// so `scrollLeft` snapped 30 -> 0 and the scrollbar collapsed; this spec fails.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const TOL_REST = 2; // px — non-dragged tabs must not move when tear-out arms
const TOL_FOLLOW = 2.5; // px — dragged tab must track the pointer on both axes

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
      scrollbar: list.offsetHeight - list.clientHeight,
      left: +r.left.toFixed(2),
      right: +r.right.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
    };
  });
}

// Open report.pdf, then click `+` until the strip genuinely overflows.
async function openOverflowingStrip() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  for (let i = 0; i < 45; i += 1) {
    const m = await listMetrics();
    if (m !== null && m.scrollWidth > m.clientWidth + 4) break;
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(60);
  }
  const m = await listMetrics();
  expect(m, '.tab-list exists').not.toBeNull();
  expect(m.scrollWidth, 'the strip overflows horizontally').toBeGreaterThan(m.clientWidth + 4);
  return m;
}

async function scrollToMax() {
  await win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    if (list !== null) list.scrollLeft = list.scrollWidth;
  });
  await win.waitForTimeout(120);
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

// The first non-active tab whose colour chip is fully visible in the scroller.
async function pickVisibleNonActiveChip() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    const activeId = active === null ? null : active.getAttribute('data-tab-id');
    const lr = list.getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    for (const t of tabs) {
      const id = t.getAttribute('data-tab-id');
      if (id === activeId) continue;
      const chip = t.querySelector('.tab-colour-chip');
      if (chip === null) continue;
      const cr = chip.getBoundingClientRect();
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      if (cx > lr.left + 6 && cx < lr.right - 6 && cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1) {
        return { id, x: cx, y: cy };
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

test('DEF-432: tear-out on an overflowing strip keeps the scroller and the non-dragged tabs still, and follows the pointer', async () => {
  const overflow = await openOverflowingStrip();
  console.log(`[P61-ovf] overflow metrics ${JSON.stringify(overflow)}`);
  await scrollToMax();
  const scrolled = await listMetrics();
  expect(scrolled.scrollLeft, 'the scroller is scrolled past 0').toBeGreaterThan(0);
  const stripBottom = scrolled.bottom;

  const pick = await pickVisibleNonActiveChip();
  expect(pick, 'a visible non-active tab chip exists to drag').not.toBeNull();
  const dragId = pick.id;
  const startX = pick.x;
  const startY = pick.y;

  const restingAll = await allTabBoxes();
  const restingDrag = restingAll[dragId];
  console.log(`[P61-ovf] dragId=${dragId} start=(${startX.toFixed(2)},${startY.toFixed(2)}) scrollLeft=${scrolled.scrollLeft} restingDrag=${JSON.stringify(restingDrag)}`);

  await win.mouse.move(startX, startY);
  await win.mouse.down();
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
  console.log(`[P61-ovf] tearOut=${tearing.tearOut} afterScrollLeft=${afterStrip.scrollLeft} afterScrollbar=${afterStrip.scrollbar} dragging=${tearing.dragging}`);
  console.log(`[P61-ovf] tearing=${JSON.stringify(tearing)}`);

  // Precondition: the tear-out state actually armed.
  expect(tearing, 'the dragged tab is still live').not.toBeNull();
  expect(tearing.dragging, 'the tab carries data-tab-dragging="true"').toBe('true');
  expect(tearing.tearOut, '.tab-list carries data-tab-tearout="true"').toBe('true');

  // The scroller itself must be untouched — this is the DEF-432 mechanism.
  expect(afterStrip.scrollLeft, 'scrollLeft does not snap when tear-out arms').toBe(scrolled.scrollLeft);
  expect(afterStrip.scrollbar, 'the horizontal scrollbar thickness is unchanged').toBe(scrolled.scrollbar);

  // (a) every non-dragged tab stays within ~2px of its resting position.
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
