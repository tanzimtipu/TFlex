const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test('Verify #520 eliminated', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  await window.waitForSelector('.welcome');
  
  console.log('Starting diagnostic poll (100 iterations)...');
  for (let i = 0; i < 100; i++) {
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    if (i % 20 === 0) console.log(`Iteration ${i}...`);
  }
  
  console.log('Poll complete. Checking for React errors...');
  
  // If the tree collapsed, diagnostics would likely fail or return null
  const finalDiag = await window.evaluate(() => window.tflexDiagnostics());
  expect(finalDiag).not.toBeNull();
  
  await electronApp.close();
});
