// Preferences and header theme controls stay synchronized: a change made
// in either surface is reflected as the selected option in the other.
//
// Selector notes (app markup, verified in source):
//   - the prefs select is [data-prefs-theme-default];
//   - the header popover is .theme-toggle-popover; the selected option is
//     marked with .theme-toggle-option-selected (there is no .active class);
//   - the selected-option button's text is its label ("Dark", "Frosted Glass").
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Preferences and header stay synchronized', async () => {
  const { electronApp, window } = await launchDev();

  // Set theme via Preferences
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  await window.selectOption('[data-prefs-theme-default]', 'dark');
  await expect(window.locator('[data-prefs-theme-default]')).toHaveValue('dark');
  await window.click('[data-prefs-dialog] .sheet-close');
  await window.waitForSelector('[data-prefs-dialog]', { state: 'hidden' });

  // Check header shows Dark as the selected option
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { timeout: 2000 });
  const activeInHeader = await window
    .locator('[data-theme-option].theme-toggle-option-selected')
    .textContent();
  console.log('Header shows:', activeInHeader);
  expect(activeInHeader).toBe('Dark');
  await shot(window, 'theme-sync-header-dark.png');

  // Close header popover (Escape closes it per AppHeader's key handler)
  await window.keyboard.press('Escape');
  await expect(window.locator('.theme-toggle-popover')).toBeHidden();

  // Now change via header
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { timeout: 2000 });
  await window.click('[data-theme-option="frosted"]');

  // Check Preferences shows the header's choice
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  await expect(window.locator('[data-prefs-theme-default]')).toHaveValue('frosted');
  const prefsValue = await window.locator('[data-prefs-theme-default]').inputValue();
  console.log('Preferences shows:', prefsValue);
  expect(prefsValue).toBe('frosted');
  await shot(window, 'theme-sync-prefs-frosted.png');

  await hardClose(electronApp);
});
