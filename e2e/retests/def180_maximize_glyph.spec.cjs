// DEF-180 repro — maximize/restore caption glyph + label do not flip when a
// renderer settings write happened earlier in the session.
//
// Hypothesis: the maximized flag reaches the renderer only through the
// `settings.changed` geometry echo. The echo filter (shouldApplyEcho)
// discards any echo whose content differs from the renderer's latest
// local-write snapshot in any field except recentFiles. A maximize writes
// geometry (maximized + normal bounds) from MAIN; after any renderer
// settings write (theme toggle, palette, prefs) the geometry-only echo no
// longer matches the snapshot and is discarded, so TitleBar's `maximized`
// prop stays false forever and the caption never flips.
//
// Proof shape (one launch):
//   A. Maximize at boot, BEFORE any renderer settings write (writeSeq=0)
//      -> the echo is applied (boot path) -> caption flips to
//      "Restore window" + restore glyph. This is the DEF-119 behaviour.
//   B. Toggle the theme (a renderer settings write), then maximize again
//      -> the geometry-only echo is discarded -> caption stays
//      "Maximize window" while the window IS maximized and settings.json
//      records maximized=true. That mismatch is the defect.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollMaxLabel(win, want, timeoutMs = 6000) {
  const maxBtn = win.locator('[data-window-maximize]');
  const deadline = Date.now() + timeoutMs;
  let label = null;
  while (Date.now() < deadline) {
    await wait(250);
    label = await maxBtn.getAttribute('aria-label');
    if (label === want) return label;
  }
  return label;
}

test('DEF-180: caption flips when no settings write preceded, but not after one', async () => {
  test.setTimeout(120000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const maxBtn = win.locator('[data-window-maximize]');

  // ---- A: maximize with NO prior renderer settings write ----
  await maxBtn.click();
  const labelA = await pollMaxLabel(win, 'Restore window', 6000);
  const isMaxA = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
  console.log(`[A no-write] isMaximized=${isMaxA} label=${labelA}`);
  expect(isMaxA).toBe(true);
  expect(labelA, 'boot-path maximize must flip the caption (writeSeq=0 echo applied)').toBe('Restore window');
  const svgA = await maxBtn.locator('svg').first().evaluate((el) => el.outerHTML);
  const minSvg = await win.locator('[data-window-minimize] svg').first().evaluate((el) => el.outerHTML);
  expect(svgA, 'restore glyph must be distinct from minimize').not.toBe(minSvg);

  // Restore and let the echo land.
  await maxBtn.click();
  const labelBack = await pollMaxLabel(win, 'Maximize window', 6000);
  console.log(`[A no-write] restored label=${labelBack}`);
  expect(labelBack).toBe('Maximize window');

  // ---- B: renderer settings write, THEN maximize ----
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="dark"]');
  await win.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await wait(500); // let the theme write + echo settle

  await maxBtn.click();
  const isMaxB = await pollIsMaximized(electronApp, 6000);
  const labelB = await pollMaxLabel(win, 'Restore window', 6000);
  const udd = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  const settingsPath = path.join(udd, 'settings.json');
  let persistedMax = null;
  try {
    persistedMax = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).geometry.maximized;
  } catch { /* file read race */ }
  console.log(`[B after-write] isMaximized=${isMaxB} caption=${labelB} settings.json geometry.maximized=${persistedMax}`);
  expect(isMaxB, 'the window must actually maximize').toBe(true);
  expect(persistedMax, 'main must persist maximized=true to settings.json').toBe(true);
  // The DEFECT: the renderer-side caption does not follow.
  expect(labelB, 'caption must flip to Restore window after a prior settings write too').toBe('Restore window');

  await hardClose(electronApp, 'def180');
});

async function pollIsMaximized(electronApp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let ok = false;
  while (Date.now() < deadline) {
    await wait(250);
    ok = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    if (ok) return true;
  }
  return ok;
}