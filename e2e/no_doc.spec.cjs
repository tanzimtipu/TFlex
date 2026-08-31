const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test('No Doc Test', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.welcome-screen', { timeout: 10000 });
  console.log('Welcome screen visible');
  await electronApp.close();
});
