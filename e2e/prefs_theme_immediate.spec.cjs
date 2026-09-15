// Preferences theme applies IMMEDIATELY (dialog stays open, no Save click)
// and the applied theme is still in effect after the dialog closes.
//
// Selector notes (app markup, verified in source):
//   - the prefs select is [data-prefs-theme-default] (PreferencesDialog.tsx),
//     not [data-prefs-theme-select];
//   - the close button is the sheet's .sheet-close (aria-label
//     "Close preferences"), there is no [data-prefs-close] attribute;
//   - the live theme is applied to <html> (applyTheme -> documentElement),
//     so the proof is document.documentElement.dataset.theme, not body's;
//   - a fresh profile boots 'frosted' (factory default), so the spec picks
//     a target theme DIFFERENT from the current one — re-picking the
//     current theme is guarded as a no-op by design (App.tsx).
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Preferences theme changes apply immediately', async () => {
  const { electronApp, window } = await launchDev();

  // Open Preferences
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });

  // Get initial applied theme
  const initialTheme = await window.evaluate(() => document.documentElement.dataset.theme);
  console.log('Initial theme:', initialTheme);

  // Pick a theme DIFFERENT from the current one ('dark' unless already dark)
  const target = initialTheme === 'dark' ? 'light' : 'dark';
  await window.selectOption('[data-prefs-theme-default]', target);
  await expect(window.locator('[data-prefs-theme-default]')).toHaveValue(target);

  // Verify theme changed IMMEDIATELY (dialog still open, no Save click)
  await expect.poll(async () =>
    window.evaluate(() => document.documentElement.dataset.theme)
  ).toBe(target);
  const newTheme = await window.evaluate(() => document.documentElement.dataset.theme);
  console.log('New theme:', newTheme);
  expect(newTheme).toBe(target);
  expect(newTheme).not.toBe(initialTheme);

  await shot(window, 'theme-prefs-immediate.png');

  // Close preferences
  await window.click('[data-prefs-dialog] .sheet-close');
  await window.waitForSelector('[data-prefs-dialog]', { state: 'hidden' });

  // Verify theme persisted (still applied after the dialog closed)
  const finalTheme = await window.evaluate(() => document.documentElement.dataset.theme);
  expect(finalTheme).toBe(target);

  await hardClose(electronApp);
});
