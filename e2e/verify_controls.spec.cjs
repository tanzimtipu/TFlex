const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test('Window Controls Work', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.titlebar-control-close', { timeout: 30000 });
  
  console.log('Clicking close button...');
  await window.click('.titlebar-control-close', { force: true });
  
  // Wait for app to close
  await new Promise(r => setTimeout(r, 5000));
  
  const isClosed = await electronApp.evaluate(() => {
    try {
        return require('electron').BrowserWindow.getAllWindows().length === 0;
    } catch(e) {
        return true; // If app closed, require might fail or evaluate might fail
    }
  }).catch(() => true);
  
  console.log(`App closed: ${isClosed}`);
  expect(isClosed).toBe(true);
});
