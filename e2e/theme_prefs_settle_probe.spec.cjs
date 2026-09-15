// Probe (evidence for visual judgment, not a regression gate): open the
// Preferences sheet in the frosted theme and screenshot AFTER the entry
// animations settle (bloom-in 250ms + crossfade 400ms, so 900ms is well
// past every motion budget). Shot 4 of the sync spec was taken within
// milliseconds of the sheet appearing and looked ghost-transparent; this
// probe answers whether that was a mid-animation frame or the settled look.
const { test } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('probe: settled Preferences sheet in frosted theme', async () => {
  const { electronApp, window } = await launchDev();
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  await window.waitForTimeout(900);
  await shot(window, 'theme-prefs-frosted-settled.png');
  await hardClose(electronApp);
});
