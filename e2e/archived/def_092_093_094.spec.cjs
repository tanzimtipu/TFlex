const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('path');

test.describe('Defect Re-verification: DEF-092, DEF-093, DEF-094', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    if (app) await hardClose(app);
  });

  test('DEF-093: activeTool diagnostic returns null instead of undefined', async () => {
    // 1. Launch TFlex (already done in beforeAll)
    // 2. Close all tabs (starts with no tabs usually)
    
    // Wait for the app to be stable and diagnostics to be injected
    await page.waitForFunction(() => typeof window.tflexDiagnostics === 'function', { timeout: 10000 });
    
    const diagnostics = await page.evaluate(() => window.tflexDiagnostics());
    console.log('Diagnostics (no tabs):', JSON.stringify(diagnostics, null, 2));
    
    // Expected: activeTool should be null when no tool is active.
    // Use toBe(null) to distinguish from undefined.
    expect(diagnostics.activeTool).toBe(null);
  });

  test('DEF-094: data-tools-toggle attribute present on Tools button', async () => {
    // 1. Launch TFlex.
    // 2. Open any PDF.
    const reportPath = getSamplePath('report.pdf');
    
    // Trigger open via IPC to avoid UI navigation issues
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    
    // Click "Open PDF" button on welcome screen
    const openBtn = page.locator('button:has-text("Open PDF")').first();
    await openBtn.click();
    
    await page.waitForSelector('.workspace', { state: 'visible' });

    // 3. Inspect the "Tools" button in the toolbar.
    const toolsButton = page.locator('button[data-tools-toggle]');
    await expect(toolsButton).toBeVisible();
    
    // Also verify it's the correct button (should have "Tools" in text or title)
    const buttonTitle = await toolsButton.getAttribute('title');
    const buttonText = await toolsButton.textContent();
    console.log('Tools button title:', buttonTitle, 'text:', buttonText);
    expect(buttonTitle || buttonText).toMatch(/Tools/i);
  });

  test('DEF-092: Textbox floating bar unmounts after confirm', async () => {
    // 1. Launch TFlex.
    // 2. Open a PDF (already open from previous test)
    
    // 3. Select the Text Box tool.
    // The annotation toolbar should be visible in the workspace.
    const textBoxTool = page.locator('button[data-tool="textbox"]');
    await expect(textBoxTool).toBeVisible();
    await textBoxTool.click();
    
    // 4. Click on the page to place a textbox.
    // Use the annotation layer which is definitely on top
    const layer = page.locator('.annotation-layer').first();
    await page.screenshot({ path: 'screenshots/retest_092_before_click.png' });
    await layer.waitFor({ state: 'visible', timeout: 10000 });
    await layer.click({ position: { x: 100, y: 100 }, force: true });
    
    // The textbox editor should appear
    const editor = page.locator('.ann-textbox-editor');
    await expect(editor).toBeVisible();
    
    // Type something
    await editor.type('Retest Textbox');
    
    // 5. Click the "Confirm" (Checkmark) button on the floating action bar.
    const confirmButton = page.locator('button[aria-label="Confirm text box"]');
    await expect(confirmButton).toBeVisible();
    
    // Use keyboard shortcut as a fallback if click is tricky
    await page.keyboard.press('Control+Enter');
    
    // Expected: The floating action bar should disappear after confirming.
    await expect(confirmButton).toBeHidden({ timeout: 5000 });
    
    // Verify the textbox was actually placed (diagnostic check)
    const diagnostics = await page.evaluate(() => window.tflexDiagnostics());
    // Assuming textbox is an annotation. The field might be named differently in engineState.
    console.log('Engine State:', JSON.stringify(diagnostics.engineState, null, 2));
    const hasTextbox = diagnostics.engineState && diagnostics.engineState.annotations && diagnostics.engineState.annotations.some(a => a.kind === 'textbox' || a.kind === 'text-box');
    expect(hasTextbox).toBe(true);
  });
});
