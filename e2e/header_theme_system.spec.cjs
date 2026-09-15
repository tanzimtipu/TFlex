// Header theme picker offers all four options, including "System default".
//
// Selector notes (app markup, verified in AppHeader.tsx):
//   - the popover is .theme-toggle-popover (no [data-theme-popover] attribute);
//   - option labels are "Frosted Glass", "Dark", "Light", "System default".
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Header theme toggle has System default option', async () => {
  const { electronApp, window } = await launchDev();

  // Open theme toggle
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { timeout: 2000 });

  // Get all options
  const options = await window.locator('[data-theme-option]').allTextContents();
  console.log('Theme options:', options);

  expect(options).toContain('Light');
  expect(options).toContain('Dark');
  expect(options).toContain('Frosted Glass');
  expect(options).toContain('System default');

  await shot(window, 'theme-header-popover.png');

  await hardClose(electronApp);
});
