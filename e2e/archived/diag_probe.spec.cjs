const { test } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');

test('Diagnostics probe (dev build)', async () => {
  const electronApp = await launchApp([]);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });

  console.log('=== WELCOME DIAG ===');
  console.log(JSON.stringify(await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const keys = Object.keys(d);
    return { keys };
  }), null, 2));

  // Open report.pdf
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });

  console.log('=== DOC DIAG (after open) ===');
  console.log(JSON.stringify(await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const out = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = Object.keys(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }), null, 2));

  console.log('=== engineState ===');
  console.log(JSON.stringify(await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    const out = {};
    for (const k of Object.keys(e)) {
      const v = e[k];
      if (Array.isArray(v)) out[k] = { len: v.length, sample: v.slice(0, 3) };
      else out[k] = v;
    }
    return out;
  }), null, 2));

  await hardClose(electronApp);
});
