const { test, expect } = require('@playwright/test');
const { launchDev, hardClose } = require('./lib/helpers.cjs');

test('Preferences has theme dropdown with 4 options', async () => {
  const { electronApp, window } = await launchDev();

  // Open Preferences
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });

  // Find ANY theme control (select, button, or options)
  const hasSelect = await window.locator('[data-prefs-dialog] select').count() > 0;
  const hasThemeButtons = await window.locator('[data-prefs-dialog] button:has-text("Light"), [data-prefs-dialog] button:has-text("Dark")').count() > 0;

  console.log('Has select:', hasSelect);
  console.log('Has theme buttons:', hasThemeButtons);

  if (hasSelect) {
    // Check select options
    const options = await window.locator('[data-prefs-dialog] select option').allTextContents();
    console.log('Options:', options);
    expect(options).toContain('Light');
    expect(options).toContain('Dark');
    expect(options).toContain('Frosted');
    expect(options).toContain('System default');
  } else if (hasThemeButtons) {
    // Check buttons
    const buttons = await window.locator('[data-prefs-dialog] button').allTextContents();
    console.log('Buttons:', buttons);
    expect(buttons.some(b => b.includes('Light'))).toBe(true);
    expect(buttons.some(b => b.includes('Dark'))).toBe(true);
    expect(buttons.some(b => b.includes('Frosted'))).toBe(true);
    expect(buttons.some(b => b.includes('System'))).toBe(true);
  } else {
    throw new Error('No theme control found in Preferences');
  }

  await hardClose(electronApp);
});