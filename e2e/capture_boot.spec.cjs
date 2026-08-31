const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test('Capture Boot HTML', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // Wait a tiny bit to capture the very first paint
  await window.waitForTimeout(100);
  const html1 = await window.content();
  console.log('BOOT_HTML_1:', html1);
  
  await window.waitForTimeout(500);
  const html2 = await window.content();
  console.log('BOOT_HTML_2:', html2);
  
  await electronApp.close();
});
