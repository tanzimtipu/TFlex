// DEF-213 retest probe (qa, 2026-09-17).
//
// Original defect: on a FRESH profile (no settings.json) the app boots Frosted,
// but the "Appearance -> Theme default" dropdown DISPLAYED "dark" (a hardcoded
// implicit default), and explicitly selecting "dark" was a SILENT NO-OP - the
// reducer treated an absent field as already 'dark' and returned state
// unchanged, so settings.json never gained a `themeDefault` key.
//
// The fix (frontend-dev) made the implicit default follow the concrete booted
// theme (`state.themeDefault ?? state.theme`), so on a factory profile the
// dropdown shows "frosted" and picking "dark" now persists
// `themeDefault: "dark"`.
//
// This spec launches the dev build through the canonical launchApp() helper
// with a FRESH empty user-data dir (factory profile), then asserts the two
// RETEST-3 acceptance criteria:
//   1. the theme-default dropdown shows `frosted` on a fresh profile (was `dark`)
//   2. selecting `dark` persists `themeDefault: "dark"` in settings.json
//      WHILE the app is still running (read pre-quit, so a quit-time clobber is
//      not mistaken for a live write).
//
// Screenshot: screenshots/def-213-retest.png (Preferences open on the fresh
// profile, the theme-default select showing Frosted).
const { test, expect } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, shot } = require('./lib/helpers.cjs');

const userDataDir = path.join(os.tmpdir(), 'tflex-e2e-probe-settings');
const settingsPath = path.join(userDataDir, 'settings.json');

function readSettings() {
  if (!fs.existsSync(settingsPath)) return null;
  return fs.readFileSync(settingsPath, 'utf8');
}

function dump(label) {
  const c = readSettings();
  if (c === null) {
    console.log(`[${label}] settings.json DOES NOT EXIST`);
    return;
  }
  console.log(`[${label}] content=${c.replace(/\s+/g, ' ')}`);
}

// Poll settings.json while the app is RUNNING until the theme-default key has
// the expected value (bounded), so the assertion is not sensitive to a write
// debounce. Returns the last raw content seen.
async function pollThemeDefault(window, want, timeoutMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = readSettings();
    try {
      const parsed = last ? JSON.parse(last) : null;
      if (parsed && parsed.themeDefault === want) return last;
    } catch (_) { /* unparseable - keep polling */ }
    await window.waitForTimeout(400);
  }
  return last;
}

test('RETEST DEF-213: fresh-profile dropdown shows Frosted and selecting Dark persists themeDefault=dark', async () => {
  test.setTimeout(120000);

  // 1. Fresh empty user-data dir (factory profile) -> the app boots Frosted.
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const app = await launchApp([], userDataDir, null);
  const window = await app.firstWindow();
  try {
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    dump('boot (fresh profile, welcome screen)');

    // 2. Open Preferences via the gear and read the "Appearance -> Theme
    //    default" select value on the fresh profile.
    await window.click('[data-open-preferences]');
    await window.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
    const bootValue = await window.locator('[data-prefs-theme-default]').inputValue();
    console.log(`[fresh-profile] theme-default select value = ${bootValue}`);
    dump('boot (dialog open, fresh profile, nothing selected)');

    // Screenshot: Preferences open on the fresh profile, dropdown showing Frosted.
    await shot(window, 'def-213-retest.png');

    // ASSERTION 1: the dropdown shows the theme the app actually boots with
    // (frosted on a factory profile), not the old hardcoded 'dark'.
    expect(
      bootValue,
      'DEF-213: the fresh-profile theme-default dropdown must show frosted (pre-fix it showed dark)',
    ).toBe('frosted');

    // 3. Select dark, wait, then read settings.json WHILE the app is still
    //    running. Expect a `themeDefault: "dark"` key (pre-fix: silent no-op,
    //    the key was absent).
    await window.selectOption('[data-prefs-theme-default]', 'dark');
    const afterSelectValue = await window.locator('[data-prefs-theme-default]').inputValue();
    console.log(`[after select] theme-default select value in DOM = ${afterSelectValue}`);
    const runningContent = await pollThemeDefault(window, 'dark', 8000);
    console.log(`[running] settings.json while app RUNNING = ${runningContent ? runningContent.replace(/\s+/g, ' ') : 'ABSENT'}`);

    // ASSERTION 2: selecting dark persists themeDefault=dark to the running file.
    let parsed = null;
    try { parsed = runningContent ? JSON.parse(runningContent) : null; } catch (_) { parsed = null; }
    expect(
      parsed,
      'DEF-213: settings.json must exist and be valid JSON after selecting dark while the app runs',
    ).not.toBeNull();
    expect(
      parsed && parsed.themeDefault,
      `DEF-213: selecting dark must persist a themeDefault=dark key while the app runs (pre-fix it was a silent no-op; observed settings.json = ${runningContent ? runningContent.replace(/\s+/g, ' ') : 'ABSENT'})`,
    ).toBe('dark');
  } finally {
    await hardClose(app, 'def213');
    dump('after hardClose (post-quit)');
  }
});