// RETEST DEF-199 (qa, 2026-09-14 fix round).
//
// DEF-199: every theme application echo re-applied the same theme, starting a
// SECOND View Transition that Chromium skips; the first transition's .finished
// promise rejected unhandled as a renderer pageerror "Transition was skipped"
// at boot and on every theme flip (pre-fix: 2 startViewTransition calls per
// flip + 1 pageerror per flip, plus 1 VT call + 1 pageerror at boot).
//
// Fix under test (frontend-dev, 2026-09-14):
//   1. useThemeTransition (useAnimations.ts) — two-guard identity dedupe:
//      lastAppliedRef (the hook's own apply record) + the data-theme
//      attribute on <html> (ground truth, survives remounts).
//   2. useThemeTransition — the held ViewTransition's .finished promise gets
//      a .catch, so a skip by a newer transition is a graceful takeover,
//      never an unhandled rejection.
//   3. App.tsx settings.changed handler — skips the echo re-apply when
//      document.documentElement's data-theme already equals the echoed theme.
//
// Measurements (this spec):
//   - document.startViewTransition is wrapped with a call counter installed
//     via addInitScript, so it counts the BOOT apply too (the wrapper is
//     injected before the reloaded document's scripts run).
//   - renderer pageerror + console.error streams are captured from launch.
//   - Expected: 1 VT call per theme flip, 0 VT calls at boot (the boot apply
//     is the instant firstApply and any echo is deduped), and ZERO
//     "Transition was skipped" pageerrors anywhere.
//
// Screenshots: screenshots/def-199-retest-{midcrossfade,dark,light}.png

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

// ---------------------------------------------------------------------------
// Error stream. pageerror is the channel the defect surfaced on; console
// errors are captured alongside and reported (the filing was console-level).
// ---------------------------------------------------------------------------
function attachErrorHooks() {
  rendererErrors = [];
  win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
}

// Snapshot and clear the collected errors for this phase.
function takeErrors(label) {
  const errs = rendererErrors.slice();
  rendererErrors = [];
  console.log(`[199] ${label} renderer errors: ${JSON.stringify(errs)}`);
  return errs;
}

function skippedOf(errs) {
  return errs.filter((e) => /Transition was skipped/.test(e));
}

async function boot() {
  ({ electronApp, window: win } = await launchDev());
  attachErrorHooks();
}

async function closeApp() {
  await hardClose(electronApp, 'def-199-retest');
  electronApp = null;
  win = null;
}

test.afterEach(async () => {
  if (electronApp) await closeApp();
});

// ---------------------------------------------------------------------------
// startViewTransition call counter. Installed with addInitScript so it is in
// place BEFORE the (re)loaded document's React code boots — otherwise the
// boot apply would escape counting. Counts only; never alters behavior.
// ---------------------------------------------------------------------------
async function installVtCounter() {
  await win.addInitScript(() => {
    window.__vt = { calls: 0 };
    if (typeof document.startViewTransition !== 'function') return;
    const orig = document.startViewTransition.bind(document);
    document.startViewTransition = (cb) => {
      window.__vt.calls += 1;
      const vt = orig(cb);
      if (vt && vt.finished) vt.finished.then(() => {}).catch(() => {});
      return vt;
    };
  });
}

async function resetVt() {
  await win.evaluate(() => {
    if (window.__vt) window.__vt.calls = 0;
  });
}

async function readVt() {
  return win.evaluate(() => (window.__vt ? window.__vt.calls : null));
}

async function themeAttr() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// Open the theme popover and pick an option; wait past the 400ms crossfade
// plus the settings-echo window so both the primary and any echo apply have
// landed (or been deduped) before the counter is read.
async function flipThemeTo(option) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${option}"]`);
  await win.waitForTimeout(1200);
}

// Force a settings.changed echo the same way main produces one: a geometry
// report. Resize the BrowserWindow by 2px; main's debounced window-state
// reporter re-reports geometry on resize and every report lands in the
// renderer as a settings.changed echo (DEF-202) — the exact echo class that
// re-applied the theme at boot before the fix.
async function forceGeometryEcho() {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    w.setSize(b.width + 2, b.height, { animate: false });
  });
}

// ---------------------------------------------------------------------------
// DEF-199 / test 1 — fresh launch, no wrapper: the literal filing repro.
// Boot with the console/pageerror stream observed; wait through the boot
// echo window (geometry reports on window restore arrive as settings.changed
// echoes); the "Transition was skipped" rejection surfaces here in the
// broken state on every launch.
// ---------------------------------------------------------------------------
test('DEF-199: boot on a fresh launch produces zero "Transition was skipped" pageerrors', async () => {
  test.setTimeout(180000);
  await boot();
  const vtApi = await win.evaluate(() => typeof document.startViewTransition === 'function');
  console.log('[199] document.startViewTransition available:', vtApi);
  const bootTheme = await themeAttr();
  console.log('[199] boot data-theme:', bootTheme);

  // Settle through the boot echo window (window restore geometry reports +
  // any settings echoes). 5s covers the debounced reporter with margin.
  await win.waitForTimeout(5000);

  const errs = takeErrors('boot (fresh launch, unwrapped)');
  const skipped = skippedOf(errs);
  console.log('[199] boot "Transition was skipped" count:', skipped.length);
  expect(skipped, `boot pageerrors must not contain "Transition was skipped": ${JSON.stringify(skipped)}`).toEqual([]);
  const pageErrors = errs.filter((e) => e.startsWith('pageerror:'));
  expect(pageErrors, `zero renderer pageerrors at boot (got ${JSON.stringify(pageErrors)})`).toEqual([]);
  expect(errs, `zero renderer console errors at boot (got ${JSON.stringify(errs)})`).toEqual([]);

  // Theme must still be the booted theme — nothing re-applied or clobbered.
  const themeAfter = await themeAttr();
  expect(themeAfter, 'boot theme unchanged after the echo window').toBe(bootTheme);
  await win.screenshot({ path: path.join(SHOTS, 'def-199-retest-boot.png') });
  await closeApp();
});

// ---------------------------------------------------------------------------
// DEF-199 / test 2 — wrapped counter: 0 VT calls at boot, exactly 1 per
// flip (frosted -> dark, dark -> light), zero pageerrors in every phase.
// The counter is installed before the reloaded document boots, so the boot
// apply and every echo it triggers are counted.
// ---------------------------------------------------------------------------
test('DEF-199: one startViewTransition per flip (0 at boot); zero "Transition was skipped" pageerrors', async () => {
  test.setTimeout(240000);
  await boot();

  const vtApi = await win.evaluate(() => typeof document.startViewTransition === 'function');
  console.log('[199] document.startViewTransition available:', vtApi);
  expect(vtApi, 'Electron renderer must expose the View Transitions API (primary crossfade path)').toBe(true);

  // Reboot the renderer WITH the counter in place.
  await installVtCounter();
  await win.reload();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  attachErrorHooks(); // reset the stream on the fresh document
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Boot apply = firstApply = instant (no VT). Then force the geometry-report
  // echo that re-applied the theme at boot before the fix: the fixed
  // App.tsx handler must drop it via the data-theme check, and the hook's
  // lastAppliedRef guard is the second line of defense.
  await resetVt();
  await forceGeometryEcho();
  await win.waitForTimeout(3000);

  const bootCalls = await readVt();
  const bootTheme = await themeAttr();
  const bootErrs = takeErrors('boot (wrapped reload + forced geometry echo)');
  console.log('[199] boot startViewTransition calls:', bootCalls, '| data-theme:', bootTheme);
  const bootSkipped = skippedOf(bootErrs);
  console.log('[199] boot "Transition was skipped" count:', bootSkipped.length);
  expect(bootCalls, 'no View Transition may start at boot (firstApply is instant; echoes dedupe)').toBe(0);
  expect(bootSkipped, `boot "Transition was skipped" pageerrors: ${JSON.stringify(bootSkipped)}`).toEqual([]);
  expect(bootErrs, `zero renderer errors at boot (got ${JSON.stringify(bootErrs)})`).toEqual([]);
  expect(bootTheme, 'boot theme on a fresh session is the default').toBe('frosted');

  // ---- flip 1: frosted -> dark ------------------------------------------
  await resetVt();
  const before1 = await themeAttr();
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="dark"]');
  await win.waitForTimeout(130);
  await win.screenshot({ path: path.join(SHOTS, 'def-199-retest-midcrossfade.png') }); // mid-blend
  await win.waitForTimeout(1100); // crossfade (400ms token) + echo window

  const darkCalls = await readVt();
  const after1 = await themeAttr();
  const darkErrs = takeErrors('flip frosted->dark');
  const darkSkipped = skippedOf(darkErrs);
  console.log(`[199] flip1 ${before1} -> ${after1}: startViewTransition calls: ${darkCalls} | "Transition was skipped": ${darkSkipped.length}`);
  expect(after1, 'flip 1 must land on dark').toBe('dark');
  expect(darkCalls, `exactly ONE startViewTransition per flip (pre-fix measured 2; got ${darkCalls})`).toBe(1);
  expect(darkSkipped, `flip 1 "Transition was skipped" pageerrors: ${JSON.stringify(darkSkipped)}`).toEqual([]);
  expect(darkErrs, `zero renderer errors on flip 1 (got ${JSON.stringify(darkErrs)})`).toEqual([]);
  await win.screenshot({ path: path.join(SHOTS, 'def-199-retest-dark.png') });

  // ---- flip 2: dark -> light ---------------------------------------------
  await resetVt();
  const before2 = await themeAttr();
  await flipThemeTo('light');

  const lightCalls = await readVt();
  const after2 = await themeAttr();
  const lightErrs = takeErrors('flip dark->light');
  const lightSkipped = skippedOf(lightErrs);
  console.log(`[199] flip2 ${before2} -> ${after2}: startViewTransition calls: ${lightCalls} | "Transition was skipped": ${lightSkipped.length}`);
  expect(after2, 'flip 2 must land on light').toBe('light');
  expect(lightCalls, `exactly ONE startViewTransition per flip (pre-fix measured 2; got ${lightCalls})`).toBe(1);
  expect(lightSkipped, `flip 2 "Transition was skipped" pageerrors: ${JSON.stringify(lightSkipped)}`).toEqual([]);
  expect(lightErrs, `zero renderer errors on flip 2 (got ${JSON.stringify(lightErrs)})`).toEqual([]);
  await win.screenshot({ path: path.join(SHOTS, 'def-199-retest-light.png') });

  // ---- summary -------------------------------------------------------------
  console.log('[199] SUMMARY bootCalls:', bootCalls, '| flip1:', darkCalls, '| flip2:', lightCalls,
    '| skipped pageerrors: boot', bootSkipped.length, 'flip1', darkSkipped.length, 'flip2', lightSkipped.length);
  expect(
    bootSkipped.length + darkSkipped.length + lightSkipped.length,
    'zero "Transition was skipped" pageerrors across boot + both flips',
  ).toBe(0);
  await closeApp();
});