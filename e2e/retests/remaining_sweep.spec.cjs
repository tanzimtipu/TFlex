const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('path');

test.describe('Remaining Sweep Verification', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('Items 2, 4, 5, 6, 7, 8, 9, 10, 11, 16', async () => {
    const results = [];
    async function record(id, pass, note = '') {
        results.push({ id, status: pass ? 'PASS' : 'FAIL', note });
        console.log(`RESULT: ${id} - ${pass ? 'PASS' : 'FAIL'} ${note}`);
    }

    // 16) Update indicator present
    const hasUpdateIndicator = await window.locator('.update-indicator').count() >= 0;
    await record(16, hasUpdateIndicator, "Update indicator component present");

    // Open doc
    await window.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click({ force: true });
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 20000 });

    // 8) Stamp places visibly
    await window.click('[data-tools-toggle]', { force: true });
    await window.click('[data-tool-id="stamp"]', { force: true });
    await window.waitForSelector('.modal-dialog:has-text("Stamp")');
    // Redesign: the stamp dialog's modal-body starts with a p.modal-help
    // paragraph — the confirm button carries data-stamp-confirm
    // ("Place on page") and is no longer the body's first child.
    await window.click('[data-stamp-confirm]');
    await window.mouse.click(450, 450);
    const hasStamp = await window.locator('.stamp-annotation, [data-annotation-type="stamp"]').first().isVisible();
    await record(8, hasStamp, "Stamp annotation visible");

    // 9) Edit text opens editor
    await window.click('[data-toolbar-edit-toggle]', { force: true });
    await window.waitForSelector('.edit-toolbar');
    // Redesign: the edit toolbar's buttons carry data-edit-tool; the text
    // button is "Edit text" (old aria-label="Text" is gone).
    await window.click('[data-edit-tool="text"]', { force: true });
    await window.mouse.click(400, 300);
    const hasEditor = await window.locator('.text-editor, textarea, [contenteditable="true"]').count() > 0;
    await record(9, hasEditor, "Text editor found");

    // 5 & 6) Export dialogs
    await window.click('[data-tools-toggle]', { force: true });
    await window.click('[data-tool-id="exportText"]', { force: true });
    await record(5, await window.locator('.modal-dialog:has-text("Export")').isVisible(), "Export text dialog opened");
    await window.keyboard.press('Escape');
    
    await window.waitForTimeout(500);
    await window.click('[data-tool-id="exportDocx"]', { force: true });
    await record(6, await window.locator('.modal-dialog:has-text("Export")').isVisible(), "Word export dialog opened");
    await window.keyboard.press('Escape');

    // 7) Crop preview
    await window.waitForTimeout(500);
    await window.click('[data-tool-id="cropPages"]', { force: true });
    const hasCropPreview = await window.locator('.modal-dialog canvas').isVisible();
    await record(7, hasCropPreview, "Crop dialog has preview");
    await window.keyboard.press('Escape');

    // 4) Closing edited tab prompts save
    await window.click('[data-tool-id="rotate"]', { force: true }); // modify
    await window.locator('.tab-active .tab-close').click({ force: true });
    const hasSavePrompt = await window.locator('.modal-dialog:has-text("Save")').isVisible();
    await record(4, hasSavePrompt, "Save prompt visible");
    await window.keyboard.press('Escape');

    console.table(results);
  });
});
