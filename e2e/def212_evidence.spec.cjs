// One-shot evidence capture for DEF-212 closure: Preferences sheet with
// the Frosted option present and selected.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('capture DEF-212 evidence: Frosted in prefs dropdown', async () => {
  const { electronApp, window } = await launchDev();
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  await window.selectOption('[data-prefs-theme-default]', 'frosted');
  await window.waitForTimeout(400);
  await shot(window, path.join('screenshots', 'def-212-closed-frosted-selected.png'));
  await hardClose(electronApp);
});
