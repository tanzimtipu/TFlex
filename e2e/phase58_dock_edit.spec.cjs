// Phase 58 (chunk 3) — Action Dock EDIT MODE.
//
// Verifies the ONE assigned behaviour:
//   pen -> edit mode (vibration + a minus badge on every verb + a plus at the
//   row's right); a minus removes that tool WITHOUT running it; the plus opens a
//   picker of stage-relevant + global tools and adding one appends it (the plus
//   returns); the removal and the addition both persist across a relaunch; the
//   dock's box transition is non-zero normally and collapses to the app's
//   canonical no-motion duration with Animations OFF.
//
// Launches only through the canonical launchApp helper. The persistence check
// relaunches with the SAME --user-data-dir so settings.json survives.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p58-dockedit-${Date.now()}`);
const DOCK = '[data-action-dock]';

test.setTimeout(300000);

// A CSS time ("0.14s" / "0.01ms" / "1e-05s") -> seconds. The Animations-OFF
// catch-all uses the canonical no-motion value (0.01ms), so the instant path is
// "effectively zero", not necessarily the literal string "0s".
function oneSecond(value) {
  const t = String(value).trim();
  if (t.endsWith('ms')) return parseFloat(t) / 1000;
  return parseFloat(t);
}
function maxSeconds(list) {
  return Math.max(...String(list).split(',').map(oneSecond));
}

async function dockMetrics(win) {
  return win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (dock === null) return null;
    const cs = getComputedStyle(dock);
    const scroll = dock.querySelector('[data-dock-scroll]');
    return {
      width: dock.getBoundingClientRect().width,
      scrollWidth: scroll === null ? null : scroll.scrollWidth,
      transitionDuration: cs.transitionDuration,
      transitionProperty: cs.transitionProperty,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      edit: dock.getAttribute('data-dock-edit'),
      className: String(dock.className),
    };
  });
}

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function closePrefs(win) {
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
  await win.waitForTimeout(300);
}

test('dock pen enters edit mode; minus/plus curate and persist; resize animates then goes instant', async () => {
  // ---- Launch 1 ---------------------------------------------------------
  let app = await launchApp([], USER_DATA);
  let win = await app.firstWindow();
  await openReport(win);

  // 1. The pen exists and the dock starts OUT of edit mode.
  expect(await win.locator('[data-dock-edit-toggle]').count()).toBe(1);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('false');

  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');

  // Vibration: the entry class is present and the animation is live/non-zero.
  const vib = await dockMetrics(win);
  console.log(`[P58-dock] edit-on className="${vib.className}" animationName="${vib.animationName}" animationDuration="${vib.animationDuration}"`);
  expect(vib.className).toContain('anim-vibrate');
  expect(vib.animationName).toContain('tf-anim-vibrate');
  expect(oneSecond(vib.animationDuration)).toBeGreaterThan(0);

  // A minus badge on EVERY dock verb, and exactly one plus at the row's right.
  const verbCount = await win.locator('[data-dock-verb]').count();
  expect(verbCount).toBeGreaterThan(0);
  const everyVerbHasMinus = await win.evaluate(() => {
    const verbs = Array.from(document.querySelectorAll('[data-dock-verb]'));
    return verbs.every((v) => v.querySelector('[data-dock-minus]') !== null);
  });
  console.log(`[P58-dock] edit-on verbs=${verbCount} everyVerbHasMinus=${everyVerbHasMinus}`);
  expect(everyVerbHasMinus).toBe(true);
  expect(await win.locator('[data-dock-plus]').count()).toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'p58-dock-edit-mode.png') });

  // 2. Record the box width + transitionDuration (non-zero while Animations ON).
  const before = await dockMetrics(win);
  console.log(`[P58-dock] width(before)=${before.width} scrollWidth(before)=${before.scrollWidth} transitionDuration="${before.transitionDuration}" transitionProperty="${before.transitionProperty}"`);
  expect(before.transitionProperty).toContain('max-width');
  expect(maxSeconds(before.transitionDuration)).toBeGreaterThan(0);

  const origIds = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
  console.log(`[P58-dock] initial verb ids=${JSON.stringify(origIds)}`);
  expect(origIds).toContain('merge');

  // 3. A minus removes exactly one verb and does NOT run the tool. `merge`
  //    opens a dialog when run, so a leak would surface as a dialog.
  await win.locator('[data-dock-minus="merge"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-dock-verb="merge"]').count()).toBe(0);
  expect(await win.locator('[data-dock-verb]').count()).toBe(verbCount - 1);
  expect(await win.locator('[role="dialog"]').count()).toBe(0);
  expect(await win.locator('.sheet-backdrop').count()).toBe(0);
  const afterRemove = await dockMetrics(win);
  console.log(`[P58-dock] after minus: verbs=${verbCount - 1} width=${afterRemove.width} scrollWidth=${afterRemove.scrollWidth}`);

  // 4. The plus opens the picker (stage-relevant + global tools); picking one
  //    appends it, the verb count returns, and the plus stays at the right.
  await win.locator('[data-dock-plus]').click();
  await win.waitForSelector('[data-dock-picker-item]', { timeout: 8000 });
  const pickerIds = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-picker-item]')).map((e) => e.getAttribute('data-dock-picker-item')));
  console.log(`[P58-dock] picker items (${pickerIds.length})=${JSON.stringify(pickerIds)}`);
  expect(pickerIds.length).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(SHOTS, 'p58-dock-picker.png') });

  const origSet = new Set(origIds);
  const addedId = pickerIds.find((id) => !origSet.has(id));
  expect(addedId, 'picker offers a tool not already in the dock').toBeTruthy();
  await win.locator(`[data-dock-picker-item="${addedId}"]`).click();
  await win.waitForTimeout(700);
  expect(await win.locator(`[data-dock-verb="${addedId}"]`).count()).toBeGreaterThanOrEqual(1);
  expect(await win.locator('[data-dock-verb]').count()).toBe(verbCount);
  expect(await win.locator('[data-dock-plus]').count()).toBe(1);
  const afterAdd = await dockMetrics(win);
  console.log(`[P58-dock] after plus/pick "${addedId}": verbs=${verbCount} width=${afterAdd.width} scrollWidth=${afterAdd.scrollWidth}`);

  // 5. Persistence: relaunch with the SAME user-data-dir; the removal and the
  //    addition both survive.
  await hardClose(app, 'p58-dock-1');
  app = null;
  win = null;

  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await openReport(win);
  const mergeAfter = await win.locator('[data-dock-verb="merge"]').count();
  const addedAfter = await win.locator(`[data-dock-verb="${addedId}"]`).count();
  console.log(`[P58-dock] after relaunch: merge=${mergeAfter} ${addedId}=${addedAfter}`);
  expect(mergeAfter, 'removed tool stays removed across a relaunch').toBe(0);
  expect(addedAfter, 'added tool persists across a relaunch').toBeGreaterThanOrEqual(1);

  // 6. Animations OFF -> the dock's box transition is the instant path.
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForSelector('[data-prefs-animations]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-prefs-animations]').uncheck();
  await win.waitForTimeout(400);
  expect(await win.evaluate(() => document.documentElement.getAttribute('data-animations'))).toBe('off');
  await closePrefs(win);

  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
  const off = await dockMetrics(win);
  console.log(`[P58-dock] animations OFF: transitionDuration="${off.transitionDuration}" width=${off.width} scrollWidth=${off.scrollWidth}`);
  expect(maxSeconds(off.transitionDuration), `instant path (got "${off.transitionDuration}")`).toBeLessThanOrEqual(0.001);

  await hardClose(app, 'p58-dock-2');
});
