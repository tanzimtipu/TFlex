// Focused verification (qa) - two candidate product findings from the Phase 36
// migration. NOT a migration: this spec only measures. Two fresh-profile
// launches (launchApp -> unique temp userData dir), one per finding.
//
// 1. Does [data-context-panel-thumbs] + painted .thumb-item canvases return
//    after a stage switch away and back (Ctrl+2 -> Ctrl+1)? Does helpers.gotoStage
//    actually change the active stage?
// 2. After a Ctrl+click thumbnail selection, does the selection action bar
//    [data-rail-action-bar] render, and does its rotate-ccw button change the
//    page's engine rotation?
//
// Raw numbers are logged for everything measured. No screenshots are captured
// unless an assertion fails (then one is written for the defect record).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-verify');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function openScanned() {
  await win.locator('.sample-card').filter({ hasText: 'scanned.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function check(cond, msg) {
  if (cond) return;
  const shot = path.join(SHOTS, 'p36_verify_fail.png');
  await win.screenshot({ path: shot }).catch(() => {});
  throw new Error(`${msg} (screenshot: ${shot})`);
}

// Everything item 1 needs in one round trip.
async function stagesnap(label) {
  const s = await win.evaluate((lbl) => {
    const rail = document.querySelector('[data-stage-rail]');
    const panel = document.querySelector('[data-context-panel]');
    const thumbs = document.querySelector('[data-context-panel-thumbs]');
    const panelRuler = document.querySelector('[data-context-panel-ruler]');
    const items = thumbs ? [...thumbs.querySelectorAll('.thumb-item')] : [];
    let painted = 0;
    for (const el of items) {
      const c = el.querySelector('canvas.thumb-canvas');
      if (c && c.width > 0 && c.height > 0 && !el.querySelector('.thumb-placeholder')) painted += 1;
    }
    const tr = thumbs ? thumbs.getBoundingClientRect() : null;
    return {
      label: lbl,
      activeStage: rail ? rail.getAttribute('data-active-stage') : null,
      panelStage: panel ? panel.getAttribute('data-context-panel-stage') : null,
      collapsed: panel ? panel.getAttribute('data-context-panel-collapsed') : null,
      thumbsFound: !!thumbs,
      thumbsVisible: !!(tr && tr.width > 0 && tr.height > 0),
      thumbItems: items.length,
      painted,
      rulerShown: !!panelRuler,
    };
  }, label);
  console.log(`[P36V] ${label}: ${JSON.stringify(s)}`);
  return s;
}

test('1. panel thumbs survive a stage switch away and back; gotoStage changes stage', async () => {
  await openScanned();

  const initial = await stagesnap('open');
  await check(initial.thumbsFound, 'initial: [data-context-panel-thumbs] missing on fresh PAGES');
  await check(initial.painted > 0, 'initial: no painted thumbnail canvases');
  await check(initial.activeStage === 'pages', `initial: active stage is ${initial.activeStage}, not pages`);

  // --- switch away: Ctrl+2 (EDIT) via the helper.
  const stageBefore = (await stagesnap('before-ctrl2')).activeStage;
  await gotoStage(win, 2);
  const after2 = await stagesnap('after-ctrl2');
  await check(after2.activeStage === 'edit', `gotoStage(2) left active stage at ${after2.activeStage} (was ${stageBefore}) - helper/step`);
  await check(after2.panelStage === 'edit', `panel stage after Ctrl+2 is ${after2.panelStage}`);

  // --- switch back: Ctrl+1 (PAGES).
  const stageBeforeBack = after2.activeStage;
  await gotoStage(win, 1);
  const after1 = await stagesnap('after-ctrl1');
  await check(after1.activeStage === 'pages', `gotoStage(1) left active stage at ${after1.activeStage} (was ${stageBeforeBack}) - helper/step`);
  await check(after1.panelStage === 'pages', `panel stage after Ctrl+1 is ${after1.panelStage}`);
  await check(after1.thumbsFound, 'after Ctrl+1: [data-context-panel-thumbs] missing');
  await check(after1.thumbsVisible, 'after Ctrl+1: thumbs container has zero box');

  // --- painted canvases: poll, since canvas repaint is async after remount.
  let paintedSeen = 0;
  for (let i = 0; i < 20; i += 1) {
    const s = await stagesnap(`after-ctrl1-poll-${i}`);
    paintedSeen = s.painted;
    if (s.painted > 0) break;
    await win.waitForTimeout(500);
  }
  await check(paintedSeen > 0, 'after Ctrl+1: no painted thumbnail canvas ever appeared within 10s');

  console.log(`[P36V] SUMMARY item1 activeStages=${stageBefore}->${after2.activeStage}->${after1.activeStage}`
    + ` thumbs=${initial.thumbsFound}/${after2.thumbsFound}/${after1.thumbsFound}`
    + ` painted=${initial.painted}/${after2.painted}/${paintedSeen}`);
});

// Item 2 needs the engine rotations + the thumb's rotation class.
async function rotState(label) {
  const s = await win.evaluate((lbl) => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    const bar = document.querySelector('[data-rail-action-bar]');
    const btns = bar ? [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : [];
    const ccw = bar ? bar.querySelector('button[aria-label="Rotate counter-clockwise"]') : null;
    const t2 = document.querySelector('.thumb-item[data-page="2"]');
    return {
      label: lbl,
      rotations: Array.isArray(e.rotations) ? e.rotations.slice(0, 6) : null,
      actionBar: bar ? bar.getAttribute('data-page') : null,
      actionBarBtns: btns,
      ccwFound: !!ccw,
      ccwDisabled: ccw ? ccw.disabled : null,
      thumb2Class: t2 ? t2.className : null,
      selectedPages: [...document.querySelectorAll('.thumb-item.thumb-selected')].map((el) => el.getAttribute('data-page')),
    };
  }, label);
  console.log(`[P36V] ${label}: ${JSON.stringify(s)}`);
  return s;
}

test('2. selection action bar rotate-ccw applies rotation to the selected page', async () => {
  await openScanned();

  const before = await rotState('before-select');
  await check(before.rotations !== null, 'engine diagnostics expose no rotations array');

  // Ctrl+click page 2 to select it.
  await win.locator('.thumb-item[data-page="2"]').click({ modifiers: ['Control'] });
  await win.waitForTimeout(600);
  const selected = await rotState('after-ctrl-click');
  await check(selected.selectedPages.length === 1 && selected.selectedPages[0] === '2',
    `Ctrl+click did not single-select page 2 (selected=${JSON.stringify(selected.selectedPages)})`);
  await check(selected.actionBar !== null, 'selection action bar [data-rail-action-bar] did not render');
  await check(selected.ccwFound, `rotate-ccw button not found in action bar (buttons=${JSON.stringify(selected.actionBarBtns)})`);
  await check(selected.ccwDisabled === false, 'rotate-ccw button is disabled');

  // Click rotate-ccw.
  await win.locator('[data-rail-action-bar] button[aria-label="Rotate counter-clockwise"]').click();

  // Poll the engine rotation for visible page 2 (index 1) and the thumb class.
  let after = selected;
  for (let i = 0; i < 20; i += 1) {
    after = await rotState(`after-ccw-poll-${i}`);
    if (after.rotations && after.rotations[1] !== before.rotations[1]) break;
    await win.waitForTimeout(400);
  }
  const rotBefore = before.rotations[1];
  const rotAfter = after.rotations ? after.rotations[1] : null;
  await check(rotAfter !== rotBefore,
    `rotate-ccw did not change page 2 rotation (before=${rotBefore} after=${rotAfter}); thumb2="${after.thumb2Class}"`);

  console.log(`[P36V] SUMMARY item2 barPage=${selected.actionBar} btn=${selected.ccwFound}`
    + ` rotationPage2 ${rotBefore}->${rotAfter} thumb2Class="${after.thumb2Class}"`);
});
