// DIAGNOSTIC 3 (qa, 2026-09-13): does the REAL Save button save? diag2 showed
// [aria-label="Save"] matches the group DIV first (center = gap -> click
// misses); the actual button is `button[aria-label="Save"]`. This spec
// replicates the sweep's DEF-075 steps and clicks the BUTTON, then watches
// modified + the file on disk. Verdict input for the no_op_sweep triage.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

test('diag3: real Save button saves the modified doc', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // same DEF-075 placement as the sweep
  await win.click('[aria-label="Sign tool"]');
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA Roundtrip');
  await win.click('.sig-tab-actions button:has-text("Save")');
  await win.waitForSelector('.sig-saved-pick');
  await win.click('.sig-saved-pick');
  await win.click('.pdf-page', { position: { x: 150, y: 150 } });
  await win.waitForSelector('[data-sig-action="confirm"]');
  await win.click('[data-sig-action="confirm"]');
  await win.waitForFunction(() => window.tflexDiagnostics().signatures.length > 0);

  const fs = require('node:fs');
  const sizeBefore = fs.statSync(reportPath).size;
  console.log(`[diag3] before: modified=true, file size ${sizeBefore}`);

  // CLICK THE REAL BUTTON (button[aria-label="Save"])
  await win.click('button[aria-label="Save"]');
  let cleared = false;
  for (let i = 0; i < 10; i += 1) {
    await win.waitForTimeout(500);
    const mid = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return { modified: d.modified, toast: (document.querySelector('[data-toast], .toast') || {}).textContent || null };
    });
    console.log(`[diag3] t+${(i + 1) * 500}ms:`, JSON.stringify(mid));
    if (!mid.modified) { cleared = true; break; }
  }
  const sizeAfter = fs.statSync(reportPath).size;
  const after = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, signatures: d.signatures.length };
  });
  console.log(`[diag3] after: ${JSON.stringify(after)} cleared=${cleared} file size ${fs.statSync(reportPath).size} (was ${sizeBefore})`);
  console.log('[diag3] renderer errors:', JSON.stringify(errors));
  await hardClose(electronApp, 'diag3-real-save');
});