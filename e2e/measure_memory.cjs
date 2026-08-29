const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

async function measureMemory() {
  console.log('Launching app for memory measurement...');
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();

  // Wait for welcome screen
  await window.waitForSelector('.welcome', { timeout: 20000 });
  
  console.log('Opening long.pdf (temp copy for DEF-026)...');
  const longPath = getSamplePath('long.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, longPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 60000 });
  
  // Wait for idle - let things settle for 10 seconds
  console.log('Waiting 10s for idle state...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('Capturing metrics...');
  const metrics = await electronApp.evaluate(async ({ app }) => {
    return app.getAppMetrics();
  });

  console.log('--- Process Memory Breakdown ---');
  console.log('| Type | PID | Working Set (MB) | Private Bytes (MB) | Shared Bytes (MB) |');
  console.log('| --- | --- | --- | --- | --- |');
  
  let totalWorkingSet = 0;
  metrics.forEach(m => {
    const ws = (m.memory.workingSetSize / 1024).toFixed(2);
    const pb = (m.memory.privateBytes / 1024).toFixed(2);
    const sb = (m.memory.sharedBytes / 1024).toFixed(2);
    console.log(`| ${m.type} | ${m.pid} | ${ws} | ${pb} | ${sb} |`);
    totalWorkingSet += m.memory.workingSetSize;
  });
  
  const totalWSMB = (totalWorkingSet / 1024).toFixed(2);
  console.log(`\nTotal Working Set: ${totalWSMB} MB`);

  await window.screenshot({ path: path.join(__dirname, '../screenshots/def-016-memory-breakdown.png') });
  
  await electronApp.close();
}

measureMemory().catch(err => {
  console.error(err);
  process.exit(1);
});
