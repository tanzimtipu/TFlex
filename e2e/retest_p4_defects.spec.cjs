const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('Retest P4 Defects and SCs', async () => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 800 });

  console.log('--- Retesting DEF-023 (Modified state) and DEF-024 (Pointer events) ---');
  // Open form.pdf (using temp copy for DEF-026)
  const formPath = getSamplePath('form.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, formPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  await window.waitForFunction(() => window.tflexDiagnostics().formFieldsLoaded, { timeout: 10000 });

  // DEF-024: Click checkbox WITHOUT force:true
  const termsAgreed = window.locator('button[data-form-field="form-0-terms_agreed"]');
  await termsAgreed.click(); // Should succeed without force:true
  console.log('DEF-024: Checkbox clicked without force:true');

  // Wait for modified state (DEF-023)
  await window.waitForFunction(() => window.tflexDiagnostics().modified, { timeout: 5000 });
  const isModified = await window.evaluate(() => window.tflexDiagnostics().modified);
  console.log(`DEF-023: Document modified: ${isModified}`);
  expect(isModified).toBe(true);

  // Check if Save As is enabled
  const saveAsBtn = window.locator('button[aria-label="Save As"]');
  await expect(saveAsBtn).not.toBeDisabled();
  console.log('DEF-023: Save As button enabled');

  await window.screenshot({ path: path.join(screenshotsDir, 'def-023-024-retest.png') });

  console.log('--- Retesting DEF-022 (Signature bridge) and SC-3/4 (Signatures) ---');
  // 3. Signature flow
  await window.click('button[title*="Sign"]');
  await window.waitForSelector('.sig-manager');
  await window.click('.modal-tabs button:has-text("Type")');
  await window.fill('input.sig-type-input', 'QA Retest');
  await window.click('.sig-tab-actions button:has-text("Save")');
  await window.waitForSelector('.sig-saved-pick');
  
  // SC-4: Reuse saved signature
  await window.locator('.sig-saved-pick').first().click();
  await window.waitForSelector('.sig-manager', { state: 'hidden' });
  
  // Place it (SC-3)
  await window.waitForSelector('.signatures-layer[data-armed="true"]');
  await window.locator('.signatures-layer[data-armed="true"]').first().click({ position: { x: 400, y: 400 } });
  
  // DEF-022: Verify it persists after IPC echo
  await new Promise(r => setTimeout(r, 1000));
  const sigs = await window.evaluate(() => window.tflexDiagnostics().signatures);
  console.log('Signature 0:', JSON.stringify(sigs[0]));
  console.log(`DEF-022: Signature count after placement: ${sigs.length}`);
  expect(sigs.length).toBeGreaterThan(0);
  expect(sigs[0].page).toBe(1);

  // SC-3: Move/Resize
  console.log('Testing signature move/resize...');
  const sigLocator = window.locator('.sig-placement').first();
  await sigLocator.waitFor({ state: 'visible' });
  await sigLocator.dispatchEvent('mousedown', { button: 0, clientX: 400, clientY: 400 });
  await window.mouse.move(500, 500);
  await window.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  
  const sigAfterMove = await window.evaluate(() => window.tflexDiagnostics().signatures[0]);
  console.log(`Signature pos after move: ${sigAfterMove.rect.x}, ${sigAfterMove.rect.y}`);
  expect(sigAfterMove.rect.x).toBeGreaterThan(241); // Previous was 241

  await window.screenshot({ path: path.join(screenshotsDir, 'p4-signatures.png') });

  console.log('--- Verifying SC-1 (Positioned editors) ---');
  const fieldRects = await window.evaluate(() => window.tflexDiagnostics().formFields.map(f => f.rect));
  console.log('Field rects:', fieldRects);
  // Ensure we don't have all (0,0,0,0) - DEF-021 check
  const nonZeroRects = fieldRects.filter(r => r.width > 0 && r.height > 0);
  console.log(`Non-zero rects: ${nonZeroRects.length} / ${fieldRects.length}`);
  expect(nonZeroRects.length).toBe(fieldRects.length);

  console.log('--- Verifying SC-2 (Flatten) ---');
  await window.click('button[title*="Flatten"]');
  await window.waitForSelector('.modal-dialog');
  await window.click('.modal-footer button:has-text("Flatten")');
  await new Promise(r => setTimeout(r, 2000));
  
  const fieldsAfter = await window.evaluate(() => window.tflexDiagnostics().formFields.length);
  console.log(`Form fields after flatten: ${fieldsAfter}`);
  expect(fieldsAfter).toBe(0);
  
  await window.screenshot({ path: path.join(screenshotsDir, 'p4-flattened.png') });

  await electronApp.close();
});
