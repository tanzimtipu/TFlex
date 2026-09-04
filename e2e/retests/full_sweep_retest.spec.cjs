const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test.describe('Full Sweep Retest', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  async function getEngineDocId() {
    return await window.evaluate(() => {
      const diag = window.tflexDiagnostics();
      return diag.engineDocId;
    });
  }

  /** Safe wait to avoid React-19 loops. Uses evaluate + sleep instead of waitForFunction. */
  async function waitSafe(predicate, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await window.evaluate(predicate)) return;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timeout in waitSafe`);
  }

  test('DEF-068: Annotation creation updates engine state', async () => {
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    const dId = await getEngineDocId();
    await waitSafe(() => window.tflexDiagnostics().engineState !== null);
    const initialCount = await window.evaluate(() => window.tflexDiagnostics().engineState.annotations.length);
    
    // UI flow. Redesign: annotation tools are DISABLED while Edit mode is
    // open (mutual exclusion), so Highlight is armed directly with Edit
    // closed. The page container is .pdf-page (old .page-view is gone).
    await window.click('button[aria-label="Highlight"]');
    
    // Click on the page content to create annotation
    await window.click('.pdf-page', { position: { x: 100, y: 100 } });
    
    await waitSafe(() => {
        const diag = window.tflexDiagnostics();
        return diag.engineState && diag.engineState.annotations.length > 0;
    });

    const finalCount = await window.evaluate(() => window.tflexDiagnostics().engineState.annotations.length);
    console.log(`DEF-068: Initial=${initialCount}, Final=${finalCount}`);
    expect(finalCount).toBeGreaterThan(initialCount);
  });

  test('DEF-069: Save As clears modified flag', async () => {
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    
    await waitSafe(() => window.tflexDiagnostics().formFieldsLoaded);

    const dId = await getEngineDocId();
    
    // Fill via the REAL UI path (the rendered form widget). Redesign note:
    // a DIRECT window.tflex.engine.fillFormField call no longer converges
    // the diagnostics mirror (it seeds at document load and shadows the
    // peekLastState cache), so the modified flag would never surface —
    // the UI path routes through noteOpApplied and does.
    const fieldId = await window.evaluate(() => {
      const f = document.querySelector('[data-form-field]');
      return f ? f.getAttribute('data-form-field') : null;
    });
    if (!fieldId) throw new Error('No [data-form-field] widget rendered for form.pdf');
    await window.fill(`[data-form-field="${fieldId}"]`, 'QA Value');
    await window.waitForTimeout(1500); // 500ms fill debounce + getState sync

    // Wait for modified flag
    await waitSafe(() => window.tflexDiagnostics().modified === true);
    
    const savePath = path.join(os.tmpdir(), `retest-save-as-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    
    await window.click('button[aria-label="Save As"]');
    
    // Wait for modified flag to clear
    await waitSafe(() => window.tflexDiagnostics().modified === false);
    
    const modified = await window.evaluate(() => window.tflexDiagnostics().modified);
    console.log(`DEF-069: Modified after save=${modified}`);
    expect(modified).toBe(false);
    if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
  });

  test('DEF-073: Shared optimizePreset collision', async () => {
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    // Open Optimize and set to 'max'
    // Redesign: the preset <select> became a radiogroup
    // (input[data-optimize-preset]); onChange persists even on Escape.
    await window.click('button[aria-label="Reduce file size"]');
    await window.waitForSelector('.sheet, .dialog, [role="dialog"]');
    const presetRadio = window.locator('input[data-optimize-preset="max"]');
    await presetRadio.check();
    
    await waitSafe(() => window.tflexDiagnostics().optimizePreset === 'max');
    
    await window.keyboard.press('Escape');
    await window.waitForSelector('.sheet, .dialog', { state: 'hidden' });

    // Open Save As and toggle "Fast web view"
    await electronApp.evaluate(async ({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    await window.click('button[aria-label="Save As"]');
    
    const linearize = window.locator('input[type="checkbox"]').first();
    if (await linearize.isVisible()) {
        const isChecked = await linearize.isChecked();
        await linearize.setChecked(!isChecked);
    }
    await window.keyboard.press('Escape');

    // Re-verify Optimize preset is still 'max'
    const preset = await window.evaluate(() => window.tflexDiagnostics().optimizePreset);
    console.log(`DEF-073: Preset after linearize toggle=${preset}`);
    expect(preset).toBe('max');
  });

  test('DEF-074: About dialog surfaces version info', async () => {
    // Redesign: the renderer bundle is chunk-split and boots a little
    // slower; a menu:action fired before the renderer subscribes is
    // dropped silently. Wait for the app shell first (the suite's other
    // tests wait for .workspace — this one runs from the welcome screen).
    await window.waitForSelector('.app', { timeout: 15000 });
    // Help -> About TFlex
    await electronApp.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        if (!menu) return;
        const help = menu.items.find(i => i.label.replace("&", "").includes('Help'));
        if (help && help.submenu) {
            const about = help.submenu.items.find(i => i.label.replace("&", "").includes('About'));
            if (about) about.click();
        }
    });
    
    const aboutDialog = await window.waitForSelector('.sheet, .dialog, .about-dialog', { timeout: 15000 });
    const content = await aboutDialog.textContent();
    console.log(`DEF-074: About content=${content.substring(0, 50)}...`);
    expect(content).toContain('TFlex');
  });

  test('DEF-075: Signature metadata round-trip', async () => {
    const reportPath = getSamplePath('report.pdf');
    const tempPath = path.join(os.tmpdir(), `sig-retest-${Date.now()}.pdf`);
    fs.copyFileSync(reportPath, tempPath);
    
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, tempPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(800);

    // Place the signature through the REAL UI flow. Redesign: the Sign
    // modal is Draw/Type/Saved tabs (no "Use this signature" button) —
    // Type -> Save lands on the Saved tab and clicking the saved row arms
    // placement; the next page click places it. The UI path routes the
    // placement through noteOpApplied so the diagnostics mirror (and the
    // Save button) see modified=true; a direct engine placeSignature call
    // does not converge the mirror post-redesign.
    await window.click('button[aria-label="Sign tool"]');
    await window.click('.sig-tab:has-text("Type")');
    await window.fill('input[aria-label="Type your signature"]', 'QA Sign');
    await window.click('.sig-tab-actions button:has-text("Save")');
    await window.waitForSelector('.sig-saved-pick');
    await window.click('.sig-saved-pick');
    await window.click('.pdf-page', { position: { x: 100, y: 100 } });

    await waitSafe(() => window.tflexDiagnostics().modified === true);
    
    await window.click('button[aria-label="Save"]');
    await waitSafe(() => window.tflexDiagnostics().modified === false);

    const closeBtn = window.locator('.tab-close, [aria-label*="Close"]').first();
    await closeBtn.click();
    
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, tempPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    const dId2 = await getEngineDocId();
    await waitSafe(() => window.tflexDiagnostics().engineState !== null);
    
    const sigs = await window.evaluate(() => window.tflexDiagnostics().engineState.signatures || []);
    console.log(`DEF-075: Signatures after reload=${sigs.length}`);
    expect(sigs.length).toBeGreaterThan(0);
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });





});
