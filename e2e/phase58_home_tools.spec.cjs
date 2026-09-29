// Phase 58 (chunk 4) — the HOME (Welcome) page's editable tool row.
//
// Verifies the ONE assigned behaviour:
//   pen -> edit mode (vibration + a minus on every non-fixed tile + a plus at
//   the row's right); the plus opens a picker that offers ONLY tools usable with
//   no document open (annotate / rotate / exportPages are absent); picking
//   appends a tile; a minus removes one WITHOUT running it; the FIXED Open tile
//   can never be removed; the changes persist across a relaunch; the row
//   visibly resizes as tiles are added/removed.
//
// Launches only through the canonical launchApp helper. The persistence check
// relaunches with the SAME --user-data-dir so settings.json survives.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p58-hometools-${Date.now()}`);
const ROW = '[data-home-tools]';

test.setTimeout(300000);

// The row's content width: the pen (last child) right edge relative to the
// row's left edge. Adding/removing a tile pushes the pen right/left, so this
// is the visible "row resizes" signal (the flex container itself is full-width).
async function rowContentWidth(win) {
  return win.evaluate(() => {
    const row = document.querySelector('[data-home-tools]');
    if (row === null) return null;
    const pen = row.querySelector('[data-home-edit-toggle]');
    if (pen === null) return null;
    return pen.getBoundingClientRect().right - row.getBoundingClientRect().left;
  });
}

async function openWelcome(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForSelector(ROW, { timeout: 30000 });
  await win.waitForTimeout(400);
}

test('home tool row: pen/edit/vibrate, minus/plus curate, picker excludes doc tools, persists, resizes', async () => {
  // ---- Launch 1 ---------------------------------------------------------
  let app = await launchApp([], USER_DATA);
  let win = await app.firstWindow();
  await openWelcome(win);

  // 1. The row renders out of edit mode with the fixed Open tile.
  expect(await win.locator(ROW).count()).toBe(1);
  expect(await win.locator('[data-home-edit-toggle]').count()).toBe(1);
  expect(await win.locator(ROW).getAttribute('data-home-edit')).toBe('false');
  expect(await win.locator('[data-home-tool="open"]').count()).toBe(1);

  // 2. The pen arms EDIT mode with the vibrate entry animation.
  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(ROW).getAttribute('data-home-edit')).toBe('true');
  const vib = await win.evaluate(() => {
    const row = document.querySelector('[data-home-tools]');
    const cs = getComputedStyle(row);
    return { className: String(row.className), animationName: cs.animationName, animationDuration: cs.animationDuration };
  });
  console.log(`[P58-home] edit-on className="${vib.className}" animationName="${vib.animationName}" animationDuration="${vib.animationDuration}"`);
  expect(vib.className).toContain('anim-vibrate');
  expect(vib.animationName).toContain('tf-anim-vibrate');

  // Every non-fixed tile grows a minus; the fixed Open tile never does.
  const minusAudit = await win.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[data-home-tool]'));
    const nonFixed = tiles.filter((t) => t.getAttribute('data-home-tool') !== 'open');
    return {
      tileIds: tiles.map((t) => t.getAttribute('data-home-tool')),
      nonFixedAllHaveMinus: nonFixed.every((t) => t.querySelector('[data-home-minus]') !== null),
      openHasMinus: document.querySelector('[data-home-minus="open"]') !== null,
    };
  });
  console.log(`[P58-home] edit-on tiles=${JSON.stringify(minusAudit.tileIds)} nonFixedAllHaveMinus=${minusAudit.nonFixedAllHaveMinus} openHasMinus=${minusAudit.openHasMinus}`);
  expect(minusAudit.nonFixedAllHaveMinus).toBe(true);
  expect(minusAudit.openHasMinus).toBe(false);
  expect(await win.locator('[data-home-plus]').count()).toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'p58-home-edit-mode.png') });

  // 3. The plus opens the picker; document tools are excluded; picking appends.
  const widthBeforeAdd = await rowContentWidth(win);
  await win.locator('[data-home-plus]').click();
  await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
  // The picker enters with `anim-menu-pop` (opacity 0 -> 1 over 200ms); let it
  // finish so the screenshot shows the menu, then assert it is really painted.
  await win.waitForTimeout(400);
  const pickerBox = await win.locator('[data-home-picker]').boundingBox();
  console.log(`[P58-home] picker box=${JSON.stringify(pickerBox)}`);
  const pickerDiag = await win.evaluate(() => {
    const p = document.querySelector('[data-home-picker]');
    const cs = getComputedStyle(p);
    const add = document.querySelector('.home-tools-add');
    return {
      viewport: [window.innerWidth, window.innerHeight],
      position: cs.position,
      top: cs.top,
      bottom: cs.bottom,
      right: cs.right,
      left: cs.left,
      height: cs.height,
      offsetParent: p.offsetParent ? String(p.offsetParent.className) : null,
      addRect: add ? [add.getBoundingClientRect().x, add.getBoundingClientRect().y, add.getBoundingClientRect().width, add.getBoundingClientRect().height] : null,
    };
  });
  console.log(`[P58-home] picker diag=${JSON.stringify(pickerDiag)}`);
  expect(pickerBox).not.toBeNull();
  // DEF-410 regression guard — the plus must open a REAL, fully visible menu,
  // not the previous ~10px sliver. 5 candidates at ~30px each means a box
  // clearly taller than 100px and wider than the 148px min-width floor.
  const pickerItems = win.locator('[data-home-picker-item]');
  const pickerIds = await pickerItems.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-home-picker-item')));
  console.log(`[P58-home] picker box=${JSON.stringify(pickerBox)} items (${pickerIds.length})=${JSON.stringify(pickerIds)}`);
  expect(pickerIds.length, 'the picker must list all 5 no-document candidates').toBe(5);
  expect(pickerBox.width, `picker width ${pickerBox.width}px (sliver if < ~120)`).toBeGreaterThan(120);
  expect(pickerBox.height, `picker height ${pickerBox.height}px (sliver if < ~100; must show all 5 rows)`).toBeGreaterThan(100);
  expect(pickerIds).not.toContain('annotate');
  expect(pickerIds).not.toContain('rotate');
  expect(pickerIds).not.toContain('exportPages');
  expect(pickerIds).toContain('preferences');

  // Every item must be painted with a real, clickable row box.
  const itemBoxes = await pickerItems.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return {
        id: e.getAttribute('data-home-picker-item'),
        w: r.width,
        h: r.height,
        visibility: cs.visibility,
        display: cs.display,
      };
    }));
  console.log(`[P58-home] picker item boxes=${JSON.stringify(itemBoxes)}`);
  for (const b of itemBoxes) {
    expect(b.h, `item ${b.id} row height`).toBeGreaterThan(20);
    expect(b.w, `item ${b.id} row width`).toBeGreaterThan(100);
    expect(b.visibility, `item ${b.id} visibility`).toBe('visible');
    expect(b.display, `item ${b.id} display`).not.toBe('none');
  }

  // Anchored to the plus: menu right edge near the plus right edge and opening
  // just below it (placeHomePicker uses a 6px gap).
  const plusBox = await win.locator('[data-home-plus]').boundingBox();
  const dx = pickerBox.x + pickerBox.width - (plusBox.x + plusBox.width);
  const dy = pickerBox.y - (plusBox.y + plusBox.height);
  console.log(`[P58-home] plus box=${JSON.stringify(plusBox)} anchor delta dx=${dx} dy=${dy}`);
  expect(Math.abs(dx), 'picker right edge aligns to the plus').toBeLessThan(12);
  expect(dy, 'picker opens below the plus').toBeGreaterThanOrEqual(-2);

  await win.screenshot({ path: path.join(SHOTS, 'p58-home-picker-fixed.png') });

  await win.locator('[data-home-picker-item="preferences"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-home-tool="preferences"]').count()).toBe(1);
  expect(await win.locator('[data-home-plus]').count()).toBe(1);
  const widthAfterAdd = await rowContentWidth(win);
  console.log(`[P58-home] row content width before-add=${widthBeforeAdd} after-add=${widthAfterAdd}`);
  expect(widthAfterAdd).toBeGreaterThan(widthBeforeAdd);

  // 4. A minus removes exactly one tile and does NOT run the tool. `merge`
  //    opens a dialog when run, so a leak would surface as a dialog.
  const widthBeforeRemove = await rowContentWidth(win);
  await win.locator('[data-home-minus="merge"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-home-tool="merge"]').count()).toBe(0);
  expect(await win.locator('[role="dialog"]').count()).toBe(0);
  expect(await win.locator('.sheet-backdrop').count()).toBe(0);
  const widthAfterRemove = await rowContentWidth(win);
  console.log(`[P58-home] row content width before-remove=${widthBeforeRemove} after-remove=${widthAfterRemove}`);
  expect(widthAfterRemove).toBeLessThan(widthBeforeRemove);

  // 5. Escape exits EDIT mode.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  expect(await win.locator(ROW).getAttribute('data-home-edit')).toBe('false');

  // Let the async settings write flush before the relaunch.
  await win.waitForTimeout(1000);
  await hardClose(app, 'p58-home-1');
  app = null;
  win = null;

  // ---- Launch 2 (same user-data-dir) ------------------------------------
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await openWelcome(win);

  // 6. Persistence: the removal and the addition both survive.
  const mergeAfter = await win.locator('[data-home-tool="merge"]').count();
  const prefsAfter = await win.locator('[data-home-tool="preferences"]').count();
  console.log(`[P58-home] after relaunch: merge=${mergeAfter} preferences=${prefsAfter}`);
  expect(mergeAfter, 'removed tool stays removed across a relaunch').toBe(0);
  expect(prefsAfter, 'added tool persists across a relaunch').toBe(1);

  // 7. The fixed Open tile remains and still has no minus in EDIT mode.
  expect(await win.locator('[data-home-tool="open"]').count()).toBe(1);
  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(ROW).getAttribute('data-home-edit')).toBe('true');
  expect(await win.locator('[data-home-minus="open"]').count()).toBe(0);

  // Retained DEF-410 guard: the launch-1 picker box captured above must have
  // been a real visible menu, never the collapsed sliver.
  expect(pickerBox.height, `picker must be a visible menu, got ${pickerBox.height}px tall`).toBeGreaterThan(100);

  await hardClose(app, 'p58-home-2');
});
