const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('Performance Re-time', async () => {
  const startBoot = Date.now();
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  const coldStart = Date.now() - startBoot;
  console.log(`PERF: Cold start to interactive: ${coldStart}ms`);

  const longPath = getSamplePath('long.pdf');
  const startOpen = Date.now();
  
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, longPath);
  
  // Use keyboard Ctrl+O to open
  await window.keyboard.press('Control+o');
  await window.waitForSelector('.workspace', { timeout: 30000 });
  
  const openTime = Date.now() - startOpen;
  console.log(`PERF: Open 520-page duration: ${openTime}ms`);
  
  // Idle memory check
  await window.waitForTimeout(10000);
  const memory = await electronApp.evaluate(async () => {
    return process.memoryUsage().rss / 1024 / 1024;
  });
  console.log(`PERF: Idle memory (main): ${memory.toFixed(2)}MB`);

  await hardClose(electronApp);
});
