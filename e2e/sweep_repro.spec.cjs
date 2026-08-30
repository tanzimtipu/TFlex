const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test.describe('Inconsistency Sweep', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  test('(1) + add-tab shows on welcome with no tabs open', async () => {
    // Welcome screen is shown when no document is open.
    // The "+" button should not be visible if there are no tabs.
    await window.screenshot({ path: 'screenshots/sweep_1_welcome.png' });
    const addTabButton = window.locator('button[data-new-tab]');
    const isVisible = await addTabButton.isVisible();
    console.log(`Add tab button visible on welcome: ${isVisible}`);
    // If it's visible, the bug is present.
    expect(isVisible).toBe(false);
  });

  test('(2) signature move inside pdf says "Item not found"', async () => {
    const reportPath = getSamplePath('report.pdf');
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');

    // Add a signature
    await window.click('button[title*="Sign"]');
    await window.waitForSelector('.sig-manager');
    await window.click('.modal-tabs button:has-text("Type")');
    await window.fill('input.sig-type-input', 'Jane QA');
    await window.click('.sig-tab-actions button:has-text("Save")');
    await window.waitForSelector('.sig-saved-pick');
    await window.locator('.sig-saved-pick').first().click();
    
    // Place it
    await window.waitForSelector('.signatures-layer[data-armed="true"]');
    await window.locator('.signatures-layer[data-armed="true"]').first().click({ position: { x: 300, y: 300 } });
    
    // Try to move it
    const signature = window.locator('.sig-placement').first();
    await signature.waitFor({ state: 'visible' });
    
    // Drag it
    const box = await signature.boundingBox();
    await window.mouse.move(box.x + 10, box.y + 10);
    await window.mouse.down();
    await window.mouse.move(box.x + 100, box.y + 100);
    await window.mouse.up();

    await window.screenshot({ path: 'screenshots/sweep_2_signature_move.png' });
    
    // Check for "Item not found" toast or error
    const toast = window.locator('.toast, .error-message, :text("Item not found")');
    const toastText = await toast.innerText().catch(() => '');
    console.log(`Toast text after move: ${toastText}`);
    expect(toastText).not.toContain('Item not found');
  });

  test('(3) Export-to-Word saves images not editable text', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    // Tools -> Export to Word
    await window.click('button[data-tools-toggle]');
    await window.click('button[data-tool-id="exportDocx"]');
    
    // Dialog should show up
    await window.waitForSelector('.modal-dialog');
    
    // Mock save dialog
    const tempPath = path.join(require('os').tmpdir(), `tflex-export-${Date.now()}.docx`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, tempPath);
    
    await window.click('.modal-footer button:has-text("Export")');
    
    // Wait for completion (toast)
    await window.waitForSelector(':text("Exported document to Word")', { timeout: 60000 });
    
    // Check if file exists
    expect(fs.existsSync(tempPath)).toBe(true);
  });

  test('(4) Edit + select text shows black window', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    // Click Edit tool in toolbar
    await window.click('button[data-toolbar-edit-toggle]');
    
    // In edit mode, we should see edit-overlay-item
    const editItem = window.locator('.edit-item').first();
    await editItem.waitFor({ state: 'visible' });
    
    // Double click to edit
    await editItem.dblclick();
    
    await window.screenshot({ path: 'screenshots/sweep_4_edit_black_window.png' });
  });

  test('(5) left-rail page selection reverts to page 2 of long.pdf', async () => {
    await window.click('.sample-card:has-text("long.pdf")');
    await window.waitForSelector('.workspace');
    
    // Jump to page 10
    await window.fill('.page-input', '10');
    await window.press('.page-input', 'Enter');
    
    // Wait for scroll
    await new Promise(r => setTimeout(r, 2000));
    
    // Check highlight in rail
    const activeThumb = window.locator('.thumb-current');
    const thumbPage = await activeThumb.getAttribute('data-page');
    console.log(`Active thumb page: ${thumbPage}`);
    
    // Bug says it reverts to page 2.
    expect(thumbPage).toBe('10');
  });

  test('(6) rotate page does nothing', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    const initialRotation = await window.evaluate(() => window.tflexDiagnostics().pageRotations?.[0] ?? 0);
    
    // Click rotate in toolbar
    await window.click('button[data-toolbar-rotate-cw]');
    
    await new Promise(r => setTimeout(r, 1000));
    const finalRotation = await window.evaluate(() => window.tflexDiagnostics().pageRotations?.[0] ?? 0);
    console.log(`Rotation: ${initialRotation} -> ${finalRotation}`);
    
    expect(finalRotation).not.toBe(initialRotation);
  });

  test('(7) delete page does nothing', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    const initialCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    
    // Select first thumb to show actions bar
    await window.locator('.thumb').first().click({ modifiers: ['Control'] });
    
    // Click delete in actions bar
    const deleteBtn = window.locator('button[aria-label="Delete this page"]');
    await deleteBtn.waitFor({ state: 'visible' });
    await deleteBtn.click();
    
    await new Promise(r => setTimeout(r, 1000));
    const finalCount = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`Page count: ${initialCount} -> ${finalCount}`);
    
    expect(finalCount).toBe(initialCount - 1);
  });

  test('(9) crop doesn\'t affect page', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    // Tools -> Crop
    await window.click('button[data-tools-toggle]');
    await window.click('button[data-tool-id="cropPages"]');
    
    await window.waitForSelector('.modal-dialog');
    
    // Change some crop value
    await window.fill('input[data-crop-top]', '50');
    
    // Confirm
    await window.click('.modal-footer button:has-text("Crop")');
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Check if modified
    const modified = await window.evaluate(() => window.tflexDiagnostics().modified);
    console.log(`Modified after crop: ${modified}`);
    
    expect(modified).toBe(true);
  });

  test('(10) stamp place-on-page does nothing', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace');
    
    // Tools -> Stamp
    await window.click('button[data-tools-toggle]');
    await window.click('button[data-tool-id="stamp"]');
    
    // Stamp picker should appear
    await window.waitForSelector('.stamp-picker');
    
    // Pick a stamp
    await window.locator('.stamp-item').first().click();
    
    // Armed?
    await window.waitForSelector('.stamp-layer[data-armed="true"]');
    
    // Click page to place
    await window.locator('.stamp-layer[data-armed="true"]').first().click({ position: { x: 200, y: 200 } });
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Check diagnostics
    const stampCount = await window.evaluate(() => window.tflexDiagnostics().annotations?.filter(a => a.kind === 'stamp').length ?? 0);
    console.log(`Stamps: ${stampCount}`);
    
    expect(stampCount).toBeGreaterThan(0);
  });
});
