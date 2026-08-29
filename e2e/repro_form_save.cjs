const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

async function repro() {
    console.log('Launching app...');
    const electronApp = await launchApp();
    const window = await electronApp.firstWindow();
    
    console.log('Opening form.pdf via sample card...');
    await window.click('.sample-card:has-text("form.pdf")');
    await window.waitForSelector('.workspace');
    
    // Fill name
    console.log('Filling name...');
    const input = window.locator('input[data-form-field="form-0-applicant_name"]');
    await input.fill('Jane QA');
    
    // Wait for debounce
    await new Promise(r => setTimeout(r, 2000));
    
    // Check diagnostics
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    const field = diag.formFields.find(f => f.name === 'applicant_name');
    const termsField = diag.formFields.find(f => f.name === 'terms_agreed');
    console.log('In-memory name:', field.value, typeof field.value);
    console.log('In-memory terms:', termsField.value, typeof termsField.value);
    
    if (field.value !== 'Jane QA') {
        console.error('FAILED: Value not updated in engine');
        await electronApp.close();
        return;
    }
    
    // Save As
    console.log('Saving As...');
    const tempPath = path.join(__dirname, '../temp-form-save.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, tempPath);
    await window.click('button[aria-label="Save As"]');
    await window.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 20000 });
    
    console.log('Closing and Reopening...');
    await window.click('.tab-close');
    await new Promise(r => setTimeout(r, 1000));
    
    await electronApp.evaluate(async ({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, tempPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    const diagReopened = await window.evaluate(() => window.tflexDiagnostics());
    const fieldReopened = diagReopened.formFields.find(f => f.name === 'applicant_name');
    console.log('Reopened value:', fieldReopened.value);
    
    if (fieldReopened.value === 'Jane QA') {
        console.log('SUCCESS: Value persisted');
    } else {
        console.log('FAILED: Value reverted to', fieldReopened.value);
    }
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    await electronApp.close();
}

repro().catch(console.error);
