const { test } = require('@playwright/test');
const { launchDev, hardClose } = require('./lib/helpers.cjs');

test('screenshot: Preferences dialog with theme dropdown (DEF-212 evidence)', async () => {
  const { electronApp, window } = await launchDev();

  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });

  const dialog = window.locator('[data-prefs-dialog]');
  await dialog.screenshot({ path: require('node:path').join(__dirname, '..', 'screenshots', 'def-212-prefs-theme-dialog.png') });

  // Dump the select's option list into the log as machine-readable evidence.
  const options = await window.locator('[data-prefs-dialog] select option').allTextContents();
  const values = await window.locator('[data-prefs-dialog] select option').evaluateAll(
    (opts) => opts.map((o) => ({ value: o.value, label: o.textContent })),
  );
  console.log('OPTIONS_EVIDENCE', JSON.stringify({ options, values }));

  await hardClose(electronApp);
});