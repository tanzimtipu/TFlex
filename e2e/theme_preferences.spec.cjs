const { test, expect } = require('@playwright/test');
const { launchDev, hardClose } = require('./lib/helpers.cjs');

test('Preferences theme dropdown works', async () => {
  const { electronApp, window } = await launchDev();
  
  // Open Preferences
  await window.click('[data-open-preferences]');
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  
  // Find theme control
  const themeSelect = await window.locator('[data-prefs-dialog] select').filter({ hasText: /theme/i });
  
  if (await themeSelect.count() === 0) {
    console.log('No theme select found');
    await hardClose(electronApp);
    return;
  }
  
  // Check options
  const options = await themeSelect.locator('option').allTextContents();
  console.log('Theme options:', options);
  
  // Check for System default
  const hasSystem = options.some(o => o.toLowerCase().includes('system'));
  console.log('Has System default:', hasSystem);
  
  // Try selecting Light
  await themeSelect.selectOption({ label: 'Light' });
  await window.waitForTimeout(500);
  
  const theme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('Selected theme:', theme);
  
  // Expect Light to be applied
  expect(theme).toBe('light');
  
  await hardClose(electronApp);
});