const { test, expect } = require('@playwright/test');
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
    if (electronApp) await electronApp.close();
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
    
    // UI flow
    await window.click('[data-toolbar-edit-toggle]');
    await window.waitForSelector('[data-edit-toolbar]');
    await window.click('button[aria-label="Highlight"]');
    
    // Click on the page content to create annotation
    await window.click('.page-view', { position: { x: 100, y: 100 } });
    
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
    
    // Fill via engine
    await window.evaluate(async (id) => {
      const res = await window.tflex.engine.getFormFields(id);
      const fields = res.value || res;
      if (fields && fields.length > 0) {
        await window.tflex.engine.fillFormField(id, { id: fields[0].id, value: 'QA Value' });
      }
    }, dId);

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
    await window.click('button[aria-label="Reduce file size"]');
    await window.waitForSelector('.sheet, .dialog, [role="dialog"]');
    const select = window.locator('select').first();
    await select.selectOption('max');
    
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

    const dId = await getEngineDocId();

    await window.evaluate(async ({ id }) => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xDE, 0, 0, 0, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0x44, 0x74, 0x8E, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
      await window.tflex.engine.placeSignature(id, {
        id: `sig-${Date.now()}`,
        signatureId: 'default',
        page: 1,
        rect: { x: 100, y: 100, width: 100, height: 50 },
        pngBytes: pngBytes.buffer
      });
    }, dId);

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
