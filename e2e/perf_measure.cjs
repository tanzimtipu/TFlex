const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const startTime = Date.now();
  
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  // Cold start: wait for welcome screen
  await window.waitForSelector('.welcome', { timeout: 30000 });
  const coldStart = Date.now() - startTime;
  console.log(`COLD_START: ${coldStart}ms`);
  
  // Open long.pdf (using temp copy for DEF-026)
  const longStart = Date.now();
  const longPath = getSamplePath('long.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, longPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 30000 });
  const longOpen = Date.now() - longStart;
  console.log(`LONG_OPEN: ${longOpen}ms`);
  
  // Idle memory
  const memory = await window.evaluate(() => performance.memory?.usedJSHeapSize);
  // Better: use process info
  const metrics = await electronApp.evaluate(async ({ app }) => {
    return app.getAppMetrics().reduce((acc, m) => acc + (m.memory.workingSetSize || 0), 0);
  });
  const memMB = Math.round(metrics / 1024);
  console.log(`MEMORY: ${memMB}MB`);
  
  await electronApp.close();
})();
