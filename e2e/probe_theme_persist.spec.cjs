// Probe: does selecting a theme default in Preferences ever reach
// settings.json? Reads the settings file while the app is RUNNING
// (pre-quit) and prints it, to separate "save never fires" from
// "quit-time save clobbers the field".
const { test } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const userDataDir = path.join(os.tmpdir(), 'tflex-e2e-probe-settings');
const settingsPath = path.join(userDataDir, 'settings.json');

function dump(label) {
  if (!fs.existsSync(settingsPath)) {
    console.log(`[${label}] settings.json DOES NOT EXIST`);
    return;
  }
  const stat = fs.statSync(settingsPath);
  console.log(`[${label}] mtime=${stat.mtime.toISOString()}`);
  console.log(`[${label}] content=${fs.readFileSync(settingsPath, 'utf8').replace(/\s+/g, ' ')}`);
}

test('probe: themeDefault write reaches settings.json', async () => {
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const app = await launchApp([], userDataDir, null);
  const window = await app.firstWindow();
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  dump('boot (dialog open, nothing selected)');

  await window.selectOption('[data-prefs-theme-default]', 'dark');
  const selectValue = await window.locator('[data-prefs-theme-default]').inputValue();
  console.log(`[after select] select value in DOM = ${selectValue}`);
  await window.waitForTimeout(1500);
  dump('1.5s after selecting dark (app RUNNING)');

  await window.waitForTimeout(3000);
  dump('4.5s after selecting dark (app RUNNING)');

  await hardClose(app);
  dump('after hardClose (post-quit)');
});
