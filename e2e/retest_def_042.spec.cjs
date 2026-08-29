const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test('DEF-042 & DEF-040: Save As verification', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();

  try {
    // 1. Open a PDF
    await window.click('text=report.pdf');
    await window.waitForSelector('.workspace');

    // 2. Click "Optimize" (Reduce file size)
    const optimizeButton = window.locator('button[aria-label="Reduce file size"]');
    await optimizeButton.click();

    // 3. Click "Reduce and open as new tab"
    const reduceNewTabButton = window.locator('[data-optimize-confirm]');
    await reduceNewTabButton.click();

    // Wait for the new tab to appear and be active
    console.log('Waiting for optimized tab...');
    await window.waitForSelector('.tab-active:has-text("optimized")', { timeout: 15000 });

    // 4. In the new tab, observe the "Save As" button in the toolbar.
    const saveAsButton = window.locator('button[aria-label="Save As"][title="Save a copy"]');
    
    // Check if it's disabled
    await expect(saveAsButton).toBeVisible();
    const isDisabled = await saveAsButton.isDisabled();
    expect(isDisabled).toBe(false);

    // 5. Verify Save As dialog linearize toggle (DEF-040)
    await saveAsButton.click();
    
    const linearizeToggle = window.locator('[data-save-as-linearize]');
    await expect(linearizeToggle).toBeVisible();
    console.log('Linearize toggle is visible');
    
    // Close dialog
    await window.click('[data-save-as-cancel]');

  } finally {
    await app.close();
  }
});
