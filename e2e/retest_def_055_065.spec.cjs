const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const fs = require('fs');

test('Defect Batch Verification DEF-055 to DEF-065', async () => {
  const electronApp = await launchApp();
  const firstWindow = await electronApp.firstWindow();
  
  const results = {};

  const verify = async (id, fn) => {
    try {
      console.log(`Verifying ${id}...`);
      await test.step(id, fn);
      results[id] = 'PASSED';
      console.log(`${id}: PASSED`);
    } catch (e) {
      results[id] = `FAILED: ${e.message}`;
      console.log(`${id}: FAILED`);
      console.log(e.stack);
      // Try to recover by closing any modals
      await firstWindow.keyboard.press('Escape');
      await firstWindow.waitForTimeout(500);
      await firstWindow.keyboard.press('Escape'); // Twice to be sure
    }
  };

  await verify('DEF-055', async () => {
    const addTabButton = firstWindow.locator('[data-new-tab]');
    await expect(addTabButton).not.toBeVisible();
  });

  await verify('DEF-065', async () => {
    const saveBtn = firstWindow.locator('button[aria-label="Save"]');
    if (await saveBtn.isVisible()) {
      await expect(saveBtn).toBeDisabled();
    }
  });

  // Setup: Open long.pdf
  await test.step('Open long.pdf', async () => {
    const longPath = getSamplePath('long.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, longPath);
    await firstWindow.click('button:has-text("Open PDF")');
    await firstWindow.waitForSelector('.workspace', { timeout: 20000 });
  });

  await verify('DEF-056', async () => {
    const toolsBtn = firstWindow.locator('[data-tools-toggle]');
    if (await toolsBtn.getAttribute('aria-pressed') !== 'true') {
      await toolsBtn.click();
    }
    const annToolbar = firstWindow.locator('[data-annotation-toolbar]');
    const highlightTool = annToolbar.locator('[data-tool="highlight"]');
    await highlightTool.click();
    const colorSwatch = firstWindow.locator('[data-color-current]');
    const color = await colorSwatch.getAttribute('data-color-current');
    expect(color.toLowerCase()).toBe('#2563eb');
  });

  await verify('DEF-057', async () => {
    const rotateBtn = firstWindow.locator('[data-toolbar-rotate-cw]');
    await rotateBtn.click();
    const thumb = firstWindow.locator('.thumb-current');
    await expect(thumb).toHaveClass(/thumb-rot-90/);
  });

  await verify('DEF-058', async () => {
    const thumb10 = firstWindow.locator('button.thumb[data-page="10"]');
    await thumb10.scrollIntoViewIfNeeded();
    await thumb10.click();
    await firstWindow.waitForTimeout(3000); 
    const currentThumb = firstWindow.locator('.thumb-current');
    const label = await currentThumb.locator('.thumb-label').textContent();
    // If it's broken, it might be 1 or 2 or something else.
    expect(label.trim()).toBe('10');
  });

  await verify('DEF-064', async () => {
    const thumb10 = firstWindow.locator('button.thumb[data-page="10"]');
    await thumb10.click({ modifiers: ['Control'] });
    const deleteBtn = firstWindow.locator('button[aria-label="Delete this page"]');
    await deleteBtn.click();
    await firstWindow.waitForTimeout(2000);
    const totalLabel = await firstWindow.locator('.page-total').textContent();
    // long.pdf has 520 pages.
    expect(totalLabel).toContain('/ 519');
  });

  await verify('DEF-059', async () => {
    // Escape to clear previous state
    await firstWindow.keyboard.press('Escape');
    const signBtn = firstWindow.locator('button[aria-label="Sign tool"]');
    await signBtn.click();
    
    // If manager opens, add a signature
    const manager = firstWindow.locator('.sig-manager');
    if (await manager.isVisible()) {
        await firstWindow.locator('.sig-tab:has-text("Draw")').click();
        const pad = firstWindow.locator('.sig-canvas');
        await pad.click({ position: { x: 50, y: 50 } });
        await firstWindow.locator('.sig-tab-actions button:has-text("Save")').click();
        await firstWindow.waitForTimeout(500);
        // Modal switches to Saved tab. Click the new signature.
        await firstWindow.locator('.sig-saved-pick').first().click();
    }
    
    // Now it should be armed. Click page.
    const page = firstWindow.locator('.pdf-page').first();
    await page.click({ position: { x: 100, y: 100 }, force: true });
    
    const sig = firstWindow.locator('.sig-placement').first();
    await expect(sig).toBeVisible();
    const box = await sig.boundingBox();
    await firstWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await firstWindow.mouse.down();
    await firstWindow.mouse.move(box.x + 200, box.y + 200);
    await firstWindow.mouse.up();
    const toast = firstWindow.locator('.toast-error');
    await expect(toast).not.toBeVisible();
  });

  await verify('DEF-063', async () => {
    await firstWindow.keyboard.press('Escape');
    const toolsBtn = firstWindow.locator('[data-tools-toggle]');
    if (await toolsBtn.getAttribute('aria-pressed') !== 'true') {
      await toolsBtn.click({ force: true });
    }
    const stampTool = firstWindow.locator('[data-tool-id="stamp"]');
    await stampTool.click({ force: true });
    const approvedBtn = firstWindow.locator('button:has-text("APPROVED")');
    await approvedBtn.click({ force: true });
    await firstWindow.locator('[data-stamp-confirm]').click({ force: true });
    const toast = firstWindow.locator('.toast-info:has-text("Placed APPROVED stamp")');
    await expect(toast).toBeVisible();
  });

  await verify('DEF-062', async () => {
    await firstWindow.keyboard.press('Escape');
    const toolsBtn = firstWindow.locator('[data-tools-toggle]');
    if (await toolsBtn.getAttribute('aria-pressed') !== 'true') {
      await toolsBtn.click({ force: true });
    }
    const cropTool = firstWindow.locator('[data-tool-id="cropPages"]');
    await cropTool.click({ force: true });
    const topInput = firstWindow.locator('input[aria-label="Top"]');
    await topInput.fill('50');
    const applyBtn = firstWindow.locator('[data-crop-confirm]');
    await applyBtn.click({ force: true });
    const saveBtn = firstWindow.locator('button[aria-label="Save"]');
    await expect(saveBtn).toHaveClass(/tool-btn-modified/);
  });

  await verify('DEF-061', async () => {
    await firstWindow.keyboard.press('Escape');
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    const addTab = firstWindow.locator('[data-new-tab]');
    await addTab.click({ force: true });
    await firstWindow.click('button:has-text("Open PDF")', { force: true });
    await firstWindow.waitForSelector('.workspace', { timeout: 20000 });
    const editToggle = firstWindow.locator('[data-toolbar-edit-toggle]');
    await editToggle.click({ force: true });
    await firstWindow.waitForTimeout(3000); 
    // Click page to place a text box (box tool is default? No, check model.ts)
    // Actually, tool === 'text' by default in EditToolbar.
    // Click on page to open inline editor
    await firstWindow.click('.pdf-page', { position: { x: 100, y: 100 }, force: true });
    const editor = firstWindow.locator('.edit-inline-editor');
    await expect(editor).toBeVisible();
    const bgColor = await editor.evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe('rgb(0, 0, 0)');
  });

  await verify('DEF-060', async () => {
    await firstWindow.keyboard.press('Escape');
    const toolsBtn = firstWindow.locator('[data-tools-toggle]');
    if (await toolsBtn.getAttribute('aria-pressed') !== 'true') {
      await toolsBtn.click({ force: true });
    }
    const exportDocxTool = firstWindow.locator('[data-tool-id="exportDocx"]');
    await exportDocxTool.click({ force: true });
    const exportBtn = firstWindow.locator('[data-docx-export-confirm]');
    await expect(exportBtn).toBeVisible();
  });

  console.log('--- FINAL RESULTS ---');
  console.log(JSON.stringify(results, null, 2));
  
  await electronApp.close();
});
