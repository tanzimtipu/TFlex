// TFL-984 (TFL-983 fix) - FIX-READY retest for the C5 File-menu defects
// accepted from the TFL-938 adversary diff-pass:
//   DEF-601 (ADV-228)  the File trigger must toggle its own menu closed on a
//                      REAL pointer click (3x), popover absent + aria-expanded false.
//   DEF-602 (ADV-229)  Escape must close when focus is off the row list (after a
//                      heading click / popover-padding click) and return focus to
//                      the trigger.
//   DEF-603 (ADV-230)  with the menu open the popover's top-left corner is square
//                      (0px) and flush with the trigger; the other corners keep the
//                      menu radius; the open trigger's bottom corners stay square.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForSelector('[data-menu-button]', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p105-def601-602-603');
  app = null;
  win = null;
});

async function popoverState() {
  return win.evaluate(() => {
    const pop = document.querySelector('[data-menu-popover]');
    const btn = document.querySelector('[data-menu-button]');
    return {
      present: pop !== null,
      expanded: btn === null ? null : btn.getAttribute('aria-expanded'),
    };
  });
}

async function clickTrigger() {
  const box = await win.locator('[data-menu-button]').boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openMenu() {
  await clickTrigger();
  await win.waitForSelector('[data-menu-popover]', { timeout: 8000 });
  await win.waitForTimeout(200);
}

async function waitClosed() {
  await win
    .waitForFunction(() => document.querySelector('[data-menu-popover]') === null, null, {
      timeout: 5000,
    })
    .catch(() => {});
  return popoverState();
}

// ---------------------------------------------------------------------------
// 1. DEF-601 - a real pointer click on the open trigger closes the menu. 3x.
// ---------------------------------------------------------------------------
test('DEF-601: real pointer click on the open trigger closes the File menu (3x)', async () => {
  for (let i = 1; i <= 3; i += 1) {
    await openMenu();
    const opened = await popoverState();
    expect(opened.present, `trial ${i}: menu open after first click`).toBe(true);
    expect(opened.expanded, `trial ${i}: aria-expanded=true while open`).toBe('true');

    await clickTrigger();
    const after = await waitClosed();
    console.log(`[DEF-601] trial ${i}: present=${after.present} expanded=${after.expanded}`);
    expect(after.present, `trial ${i}: popover absent after second real click`).toBe(false);
    expect(after.expanded, `trial ${i}: aria-expanded=false after second click`).toBe('false');
  }
});

// ---------------------------------------------------------------------------
// 2. DEF-602 - Escape off the row list (heading click, padding click).
// ---------------------------------------------------------------------------
test('DEF-602: Escape closes with focus off the row list and refocuses the trigger', async () => {
  // (a) click the non-focusable heading, then Escape.
  await openMenu();
  await win.locator('[data-menu-popover] .titlebar-menu-heading').first().click();
  const focusAfterHeading = await win.evaluate(() => ({
    tag: document.activeElement ? document.activeElement.tagName : null,
    inPopover:
      document.activeElement !== null &&
      document.querySelector('[data-menu-popover]') !== null &&
      document.querySelector('[data-menu-popover]').contains(document.activeElement),
  }));
  console.log(`[DEF-602] focus after heading click = ${JSON.stringify(focusAfterHeading)}`);
  expect(focusAfterHeading.inPopover, 'heading click moves focus off the row list').toBe(false);

  await win.keyboard.press('Escape');
  const afterHeading = await waitClosed();
  expect(afterHeading.present, 'Escape after heading click closes the menu').toBe(false);
  const refocusHeading = await win.evaluate(() =>
    document.activeElement === document.querySelector('[data-menu-button]'));
  expect(refocusHeading, 'Escape returns focus to the trigger (heading path)').toBe(true);

  // (b) click the popover padding (misses every row), then Escape.
  await openMenu();
  const pbox = await win.locator('[data-menu-popover]').boundingBox();
  await win.mouse.click(pbox.x + 3, pbox.y + 3);
  const focusAfterPad = await win.evaluate(() =>
    document.activeElement === document.body ||
    document.querySelector('[data-menu-popover]') === null ||
    !document.querySelector('[data-menu-popover]').contains(document.activeElement));
  console.log(`[DEF-602] focus off row list after padding click = ${focusAfterPad}`);
  expect(focusAfterPad, 'padding click moves focus off the row list').toBe(true);

  await win.keyboard.press('Escape');
  const afterPad = await waitClosed();
  expect(afterPad.present, 'Escape after padding click closes the menu').toBe(false);
  const refocusPad = await win.evaluate(() =>
    document.activeElement === document.querySelector('[data-menu-button]'));
  expect(refocusPad, 'Escape returns focus to the trigger (padding path)').toBe(true);
});

// ---------------------------------------------------------------------------
// 3. DEF-603 - joined corner: popover top-left square, others keep the radius;
//    open trigger bottom corners stay square.
// ---------------------------------------------------------------------------
test('DEF-603: File popover top-left corner is square and flush with the trigger', async () => {
  await openMenu();
  await win.waitForTimeout(250);

  const geom = await win.evaluate(() => {
    const pop = document.querySelector('[data-menu-popover]');
    const btn = document.querySelector('[data-menu-button]');
    if (pop === null || btn === null) return null;
    const pcs = getComputedStyle(pop);
    const bcs = getComputedStyle(btn);
    const pr = pop.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return {
      popover: {
        topLeft: pcs.borderTopLeftRadius,
        topRight: pcs.borderTopRightRadius,
        bottomRight: pcs.borderBottomRightRadius,
        bottomLeft: pcs.borderBottomLeftRadius,
      },
      trigger: {
        bottomLeft: bcs.borderBottomLeftRadius,
        bottomRight: bcs.borderBottomRightRadius,
      },
      // joined silhouette: popover top edge meets the trigger bottom edge and
      // the left edges align (within 2px, border widths).
      edgeGapY: Math.abs(br.bottom - pr.top),
      edgeGapX: Math.abs(br.left - pr.left),
    };
  });
  console.log(`[DEF-603] ${JSON.stringify(geom)}`);
  expect(geom, 'popover + trigger measurable').not.toBeNull();

  // Menu corner radius token: --radius-group = 12px.
  const MENU_RADIUS = '12px';
  expect(geom.popover.topLeft, 'popover top-left radius is square (0px)').toBe('0px');
  expect(geom.popover.topRight, 'popover top-right keeps the menu radius').toBe(MENU_RADIUS);
  expect(geom.popover.bottomRight, 'popover bottom-right keeps the menu radius').toBe(MENU_RADIUS);
  expect(geom.popover.bottomLeft, 'popover bottom-left keeps the menu radius').toBe(MENU_RADIUS);
  expect(geom.trigger.bottomLeft, 'open trigger bottom-left is square').toBe('0px');
  expect(geom.trigger.bottomRight, 'open trigger bottom-right is square').toBe('0px');
  expect(geom.edgeGapX, 'popover left edge is flush with the trigger left edge').toBeLessThanOrEqual(2);
  expect(geom.edgeGapY, 'popover top edge is flush with the trigger bottom edge').toBeLessThanOrEqual(2);

  await win.screenshot({ path: path.join(SHOTS, 'tfl984-def603-joined-corner.png') });
});
