// Phase 58 (chunk 3) — Action Dock EDIT MODE.
//
// Verifies the ONE assigned behaviour:
//   pen -> edit mode (a continuous per-icon jiggle + a minus badge on every verb
//   + a plus at the row's right); a minus removes that tool WITHOUT running it;
//   the plus opens a
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

// Phase 59 (item 3) — the pen must be fully CONTAINED inside the dock's box at
// every responsive rung (it is the dock's own trailing row item now).
async function penContainment(win) {
  return win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const pen = document.querySelector('[data-dock-edit-toggle]');
    if (dock === null || pen === null) return null;
    const d = dock.getBoundingClientRect();
    const p = pen.getBoundingClientRect();
    return {
      dock: { left: d.left, top: d.top, right: d.right, bottom: d.bottom, width: d.width, height: d.height },
      pen: { left: p.left, top: p.top, right: p.right, bottom: p.bottom, width: p.width, height: p.height },
      contained:
        p.left >= d.left - 0.5 &&
        p.right <= d.right + 0.5 &&
        p.top >= d.top - 0.5 &&
        p.bottom <= d.bottom + 0.5,
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      arrows: dock.getAttribute('data-dock-arrows'),
      arrowsLane: dock.getAttribute('data-dock-arrows-lane'),
    };
  });
}

async function setWidth(app, win, w) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    if (bw.isMaximized()) bw.unmaximize();
    bw.setSize(s[0], s[1]);
  }, [w, 900]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 40, w, { timeout: 10000 }).catch(() => {});
  const inner = await win.evaluate(() => window.innerWidth);
  console.log(`[P59-dock] setWidth(${w}) -> innerWidth=${inner}`);
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

test('dock pen enters edit mode with a desynchronised jiggle; minus/plus curate and persist; resize animates then goes instant', async () => {
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

  // Phase 75 (item A) — EDIT mode is NOT a shake. The retired entry vibration
  // is gone from the dock root, and every curated glyph carries the continuous,
  // per-icon-desynchronised jiggle instead.
  const vib = await dockMetrics(win);
  console.log(`[P58-dock] edit-on className="${vib.className}" animationName="${vib.animationName}" animationDuration="${vib.animationDuration}"`);
  expect(vib.className).not.toContain('anim-vibrate');
  expect(vib.animationName).not.toContain('tf-anim-vibrate');
  const jiggle = await win.evaluate(() => {
    const icons = Array.from(document.querySelectorAll('[data-dock-verb] .action-dock-icon'));
    return {
      count: icons.length,
      names: icons.map((el) => getComputedStyle(el).animationName),
      delays: icons.map((el) => getComputedStyle(el).animationDelay),
    };
  });
  console.log(`[P58-dock] edit-on jiggle icons=${jiggle.count} names=${JSON.stringify(jiggle.names)} delays=${JSON.stringify(jiggle.delays)}`);
  expect(jiggle.count).toBeGreaterThan(1);
  for (const name of jiggle.names) expect(name).toContain('tf-anim-jiggle');
  for (const name of jiggle.names) expect(name).not.toContain('tf-anim-vibrate');
  expect(new Set(jiggle.delays).size).toBeGreaterThan(1);

  // Phase 59 (item 3) — the pen is INSIDE the dock's bounds at the default
  // (labelled) rung.
  const containDefault = await penContainment(win);
  console.log(`[P59-dock] pen containment (default) ${JSON.stringify(containDefault)}`);
  expect(containDefault, 'the pen and dock boxes are measurable').not.toBeNull();
  expect(containDefault.contained, `pen fully inside the dock (pen=${JSON.stringify(containDefault.pen)} dock=${JSON.stringify(containDefault.dock)})`).toBe(true);

  // A minus badge on EVERY dock verb, and exactly one plus at the row's right.
  const verbCount = await win.locator('[data-dock-verb]').count();
  expect(verbCount).toBeGreaterThan(0);
  const everyVerbHasMinus = await win.evaluate(() => {
    const verbs = Array.from(document.querySelectorAll('[data-dock-verb]'));
    // TFL-660 — the minus is now a SIBLING of the verb button inside the
    // `.action-dock-verb-slot` wrapper, not a descendant, so query it from the
    // verb's parent slot and bind it to THIS verb's id. The assertion stays
    // strict: every verb must still own exactly its own minus badge.
    return verbs.every(
      (v) =>
        v.parentElement.querySelector(
          `[data-dock-minus="${v.getAttribute('data-dock-verb')}"]`,
        ) !== null,
    );
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
  //    Phase 59 (item 3) — the removed verb is held on screen as an EXIT ghost
  //    (`.anim-verb-out` / `[data-dock-exiting]`) before it disappears.
  await win.locator('[data-dock-minus="merge"]').click();
  let exitObserved = false;
  let exitClass = null;
  try {
    await win.waitForSelector('[data-dock-exiting="merge"]', { timeout: 2000 });
    exitObserved = true;
    exitClass = await win.locator('[data-dock-exiting="merge"]').getAttribute('class');
  } catch {
    exitObserved = false;
  }
  console.log(`[P59-dock] exit ghost observed=${exitObserved} class="${exitClass}"`);
  expect(exitObserved, 'the removed verb renders an exit ghost before it disappears').toBe(true);
  expect(exitClass, 'the exit ghost carries .anim-verb-out').toContain('anim-verb-out');
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
  // Phase 59 (item 3) — the newly added verb BLOOMS in (`.anim-verb-in`).
  let enterObserved = false;
  try {
    await win.waitForSelector(`[data-dock-verb="${addedId}"].anim-verb-in`, { timeout: 2000 });
    enterObserved = true;
  } catch {
    enterObserved = false;
  }
  console.log(`[P59-dock] add bloom observed=${enterObserved}`);
  expect(enterObserved, 'the newly added verb blooms in with .anim-verb-in').toBe(true);
  await win.waitForTimeout(700);
  expect(await win.locator(`[data-dock-verb="${addedId}"]`).count()).toBeGreaterThanOrEqual(1);
  expect(await win.locator('[data-dock-verb]').count()).toBe(verbCount);
  expect(await win.locator('[data-dock-plus]').count()).toBe(1);
  const afterAdd = await dockMetrics(win);
  console.log(`[P58-dock] after plus/pick "${addedId}": verbs=${verbCount} width=${afterAdd.width} scrollWidth=${afterAdd.scrollWidth}`);
  // Phase 59 (item 3) — the dock's row width changes as the verb is added
  // (the outer box and/or the scroll content width).
  const addChangedWidth = Math.abs(afterAdd.width - afterRemove.width) > 0.5
    || Math.abs(afterAdd.scrollWidth - afterRemove.scrollWidth) > 0.5;
  console.log(`[P59-dock] width change on add: outer ${afterRemove.width}->${afterAdd.width} scroll ${afterRemove.scrollWidth}->${afterAdd.scrollWidth} changed=${addChangedWidth}`);
  expect(addChangedWidth, 'adding a verb changes the dock row width').toBe(true);

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

  // Phase 59 (item 3) — the pen stays fully inside the dock at the narrow
  // (icon-only + arrows) rung too.
  await setWidth(app, win, 700);
  const narrow = await penContainment(win);
  console.log(`[P59-dock] pen containment (narrow 700) ${JSON.stringify(narrow)}`);
  expect(narrow, 'the pen and dock boxes are measurable at 700').not.toBeNull();
  expect(narrow.contained, `pen fully inside the dock at 700 (pen=${JSON.stringify(narrow.pen)} dock=${JSON.stringify(narrow.dock)})`).toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'p59-dock-pen-narrow.png') });
  await setWidth(app, win, 1440);

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
