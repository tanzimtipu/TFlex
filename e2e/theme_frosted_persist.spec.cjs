// Frosted theme verification (DEF-212 follow-up).
// Test 1 - the task: Frosted is selectable in Preferences and the
//   SELECTION persists across an app restart (dropdown shows it again).
//   settings.json is re-parsed from disk, not trusted from the UI.
// Test 2 - the dialog's own promise ("Applies on next launch"): after a
//   persisted themeDefault: 'frosted', the boot theme must BE frosted.
//   Unmasked by first persisting theme: 'dark' through the header picker
//   (frosted is the factory default, so it would hide a dead setting).
// Uses launchApp with a FIXED userData dir so launches share the settings
// store (launchDev creates a fresh temp profile on every launch).
const { test, expect } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const themeSelect = '[data-prefs-theme-default]';
const userDataDir = path.join(os.tmpdir(), 'tflex-e2e-frosted-persist');
const settingsPath = path.join(userDataDir, 'settings.json');

async function openPrefs(window) {
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
}

async function bootTheme(window, want) {
  await expect.poll(async () =>
    window.evaluate(() => document.documentElement.getAttribute('data-theme'))
  ).toBe(want);
}

function freshProfile() {
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
}

test('Frosted selectable and selection persists across restart', async () => {
  freshProfile();

  // Launch 1: open Preferences, verify the 4 options, select Frosted.
  let app = await launchApp([], userDataDir, null);
  let window = await app.firstWindow();
  await openPrefs(window);
  const options = await window.locator(`${themeSelect} option`).allTextContents();
  expect(options).toEqual(['Light', 'Dark', 'Frosted', 'System default']);
  await window.selectOption(themeSelect, 'frosted');
  await expect(window.locator(themeSelect)).toHaveValue('frosted');
  await window.waitForTimeout(500); // allow the settings IPC write to flush
  await hardClose(app);

  // Document-level check: re-parse settings.json from disk while closed.
  const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  expect(onDisk.themeDefault).toBe('frosted');

  // Launch 2: the dropdown must show Frosted again (selection persisted).
  app = await launchApp([], userDataDir, null);
  window = await app.firstWindow();
  await openPrefs(window);
  await expect(window.locator(themeSelect)).toHaveValue('frosted');
  await hardClose(app);
});

test('persisted themeDefault applies on next launch', async () => {
  freshProfile();

  // Launch 1: set the APPLIED theme to dark via the header picker
  // (applied immediately and persisted), so the factory default
  // 'frosted' cannot mask whether themeDefault is honoured at boot.
  let app = await launchApp([], userDataDir, null);
  let window = await app.firstWindow();
  await window.click('[data-theme-toggle]');
  await window.click('[data-theme-option="dark"]');
  await bootTheme(window, 'dark');
  await hardClose(app);

  // Launch 2: dark persisted through the theme field (baseline sanity),
  // then select Frosted as the theme DEFAULT in Preferences.
  app = await launchApp([], userDataDir, null);
  window = await app.firstWindow();
  await bootTheme(window, 'dark');
  await openPrefs(window);
  await window.selectOption(themeSelect, 'frosted');
  await expect(window.locator(themeSelect)).toHaveValue('frosted');
  await window.waitForTimeout(500);
  await hardClose(app);

  // Launch 3: per the dialog hint ("Applies on next launch") the boot
  // theme must now be frosted, not the previously persisted dark.
  app = await launchApp([], userDataDir, null);
  window = await app.firstWindow();
  await bootTheme(window, 'frosted');
  await hardClose(app);
});
