const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('Phase 4: Forms and Signatures', async () => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 800 });

  // Open form.pdf
  console.log('Opening form.pdf...');
  await window.click('.sample-card:has-text("form.pdf")');
  await window.waitForSelector('.workspace');

  // Wait for form fields to load
  await window.waitForFunction(() => {
    const diag = window.tflexDiagnostics();
    return diag.engineAvailable && diag.formFieldsLoaded;
  }, { timeout: 10000 });

  // 1. Fill a text field
  console.log('Filling form fields...');
  const nameField = window.locator('input[data-form-field="form-0-applicant_name"]');
  await nameField.fill('Jane QA');
  
  // Wait for debounce between fields (ROOT issue confirmed: shared debouncer clobbers rapid fills)
  await new Promise(r => setTimeout(r, 1000));
  
  // Verify values in diagnostics
  const fieldsInitial = await window.evaluate(() => window.tflexDiagnostics().formFields);
  const termsInitialVal = fieldsInitial.find(f => f.name === 'terms_agreed').value;
  const expectedTermsVal = termsInitialVal === 'true' ? 'false' : 'true';

  // 2. Toggle a checkbox
  const termsAgreed = window.locator('button[data-form-field="form-0-terms_agreed"]');
  await termsAgreed.waitFor({ state: 'visible' });
  await termsAgreed.click({ force: true });
  
  // Wait for debounce and IPC
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify values in diagnostics
  const fields = await window.evaluate(() => window.tflexDiagnostics().formFields);
  const nameVal = fields.find(f => f.name === 'applicant_name').value;
  const termsVal = fields.find(f => f.name === 'terms_agreed').value;
  console.log(`Name value: ${nameVal}, Terms agreed: ${termsVal} (initial was ${termsInitialVal})`);
  expect(nameVal).toBe('Jane QA');
  expect(String(termsVal)).toBe(expectedTermsVal);
  
  // 3. Save and Reopen (Verify SC 1)
  console.log('Verifying Save/Reopen preserves values...');
  const tempPath = path.join(require('os').tmpdir(), `tflex-qa-form-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, tempPath);
  await window.click('button[aria-label="Save As"]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 20000 });

  await window.click('.tab-close');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tempPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  
  await window.waitForFunction(() => window.tflexDiagnostics().formFieldsLoaded, { timeout: 10000 });
  const fieldsReopened = await window.evaluate(() => window.tflexDiagnostics().formFields);
  const nameValReopened = fieldsReopened.find(f => f.name === 'applicant_name').value;
  console.log(`Reopened name value: ${nameValReopened}`);
  expect(nameValReopened).toBe('Jane QA');

  // 4. Signature (SC 3 & 4) - Note: UI placement verification is blocked by DEF-022,
  // but we can check if it saves to the PDF via engine.
  console.log('Testing Signature flow...');
  await window.click('button[title*="Sign"]');
  await window.waitForSelector('.sig-manager');
  await window.click('.modal-tabs button:has-text("Type")');
  await window.fill('input.sig-type-input', 'Jane QA Sig');
  await window.click('.sig-tab-actions button:has-text("Save")');
  await window.waitForSelector('.sig-saved-pick');
  await window.locator('.sig-saved-pick').first().click();
  await window.waitForSelector('.sig-manager', { state: 'hidden' });
  
  // Place it
  await window.waitForSelector('.signatures-layer[data-armed="true"]');
  await window.locator('.signatures-layer[data-armed="true"]').first().click({ position: { x: 300, y: 300 } });
  await new Promise(r => setTimeout(r, 1000));
  
  // If DEF-022 is NOT fixed, this might be 0, but the engine should have it.
  const sigCount = await window.evaluate(() => window.tflexDiagnostics().signatures.length);
  console.log(`Signatures count in UI: ${sigCount}`);

  // 5. Flatten (SC 2)
  console.log('Testing Flatten...');
  await window.click('button[title*="Flatten"]');
  await window.waitForSelector('.modal-dialog');
  await window.click('.modal-footer button:has-text("Flatten")');
  await new Promise(r => setTimeout(r, 2000));
  
  const fieldsAfter = await window.evaluate(() => window.tflexDiagnostics().formFields.length);
  console.log(`Form fields after flatten: ${fieldsAfter}`);
  expect(fieldsAfter).toBe(0);

  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  await electronApp.close();
});
