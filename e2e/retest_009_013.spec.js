import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { launchApp } = require('./lib/launch.cjs');

test.describe('Retest DEF-009..013 and Regression', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    test.setTimeout(180000);
    console.log('Launching Electron...');
    electronApp = await launchApp(['--disable-gpu', '--no-sandbox']);
    console.log('Electron launched. Waiting for window...');
    window = await electronApp.firstWindow();
    console.log('Window found. Waiting for .sample-card...');
    await window.waitForSelector('.sample-card', { timeout: 60000 });
    console.log('App ready.');
  }, 180000);

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  async function getDiag() {
    return await window.evaluate(() => window.tflexDiagnostics());
  }

  async function takeScreenshot(name) {
    const screenshotPath = path.join(__dirname, '../screenshots', name);
    await window.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  }

  test('DEF-009: Concurrent delete during in-flight save', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    const diag = await getDiag();
    const docId = diag.activeTabId;
    const filePath = diag.activeFilePath;
    
    // Trigger save and immediately deletes
    await window.evaluate(async (id) => {
      window.tflex.engine.save(id);
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
    }, docId);

    // Wait for save to finish (modified should become false if save was snapshot, then true if deletes queued after)
    // Or if sequenced, save happens, then deletes, then modified is true.
    // If deletes happened during save and were lost, modified would be false and pages would be 31 in memory but 34 on disk.
    
    await new Promise(r => setTimeout(r, 2000));
    
    const finalDiag = await getDiag();
    console.log(`DEF-009: modified=${finalDiag.modified}, pageCount=${finalDiag.pageCount}`);
    
    // According to FIX READY: "backend-dev promise queue; save+op ordering deterministic"
    // This implies operations should be queued and performed AFTER the save.
    // So modified should be TRUE after the deletes.
    
    expect(finalDiag.pageCount).toBe(31);
    expect(finalDiag.modified).toBe(true); 
    
    await takeScreenshot('def-009-verify.png');
    
    // Close tab to clean up
    await window.click('.tab-close');
  });

  test('DEF-010: Rail undo multi-step', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    // Rotate 4 times
    for (let i = 0; i < 4; i++) {
      await window.click('button[title="Rotate clockwise"]');
      await new Promise(r => setTimeout(r, 100));
    }
    
    const diag = await getDiag();
    expect(diag.pageCount).toBe(34);
    
    const undoBtn = window.locator('button[title="Undo last change"]');
    await expect(undoBtn).not.toBeDisabled();
    
    // Click undo 3 times
    for (let i = 0; i < 3; i++) {
      await undoBtn.click();
      await new Promise(r => setTimeout(r, 200));
      await expect(undoBtn).not.toBeDisabled();
    }
    
    const finalDiag = await getDiag();
    // After 4 CW and 3 Undo (CCW), we should have 1 CW rotation (90 deg)
    // We can't easily check rotation value via diag unless it's exposed, 
    // but we can check if undo button is still enabled for the 4th undo.
    await expect(undoBtn).not.toBeDisabled();
    
    await takeScreenshot('def-010-verify.png');
    await window.click('.tab-close');
  });

  test('DEF-011: Save-As to locked destination', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    await window.click('button[title="Rotate clockwise"]');
    
    // Use a path that is likely to fail
    const protectedPath = 'C:/Windows/System32/tflex_should_fail.pdf';
    
    // We can't use the native dialog in Playwright easily, so we call the engine
    await window.evaluate(async (path) => {
        const diag = window.tflexDiagnostics();
        try {
            await window.tflex.engine.saveAs(diag.activeTabId, path);
        } catch (e) {
            // Toast should be triggered by the renderer when it sees the error
        }
    }, protectedPath);
    
    // Check for toast "Could not write file"
    const toast = window.locator('.toast', { hasText: 'Could not write file' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    
    await takeScreenshot('def-011-verify.png');
    await window.click('.tab-close');
  });

  test('DEF-012: Split-all rejected', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    // Call split with all pages
    await window.evaluate(async () => {
        const diag = window.tflexDiagnostics();
        await window.tflex.engine.split(diag.activeTabId, '1-34', 'split');
    });
    
    // Check for toast "Empty range" or similar
    // The requirement says "empty-range toast"
    const toast = window.locator('.toast');
    const toastText = await toast.innerText();
    console.log('DEF-012 Toast text:', toastText);
    expect(toastText.toLowerCase()).toContain('range');
    
    const diag = await getDiag();
    expect(diag.pageCount).toBe(34);
    
    await takeScreenshot('def-012-verify.png');
    await window.click('.tab-close');
  });

  test('DEF-013: Corrupt PDF open', async () => {
    const junk = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    
    await window.evaluate(async (bytes) => {
      try {
        await window.tflex.engine.loadDocumentBytes('junk-doc', bytes);
      } catch (e) {
      }
    }, junk);
    
    // Check for "open-error" toast
    const toast = window.locator('.toast');
    await expect(toast).toBeVisible();
    const toastText = await toast.innerText();
    console.log('DEF-013 Toast text:', toastText);
    
    await takeScreenshot('def-013-verify.png');
  });

  test('P1 Regression: Welcome Screen', async () => {
    const samples = window.locator('.sample-card');
    await expect(samples).toHaveCount(4);
  });

  test('P1 Regression: Search', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    await window.click('button[title*="Find in document"]');
    const input = window.locator('.search-input');
    await input.fill('orchestration');
    
    await new Promise(r => setTimeout(r, 2000));
    const diag = await getDiag();
    expect(diag.searchHits).toBe(8);
    
    await window.click('.tab-close');
  });

  test('P1 Regression: Theme', async () => {
    const diagBefore = await getDiag();
    const themeBefore = diagBefore.theme;
    
    await window.click('.theme-toggle');
    await new Promise(r => setTimeout(r, 500));
    
    const diagAfter = await getDiag();
    expect(diagAfter.theme).not.toBe(themeBefore);
  });

  test('P2 Regression: Merge', async () => {
    // Open two documents and merge them
    // For simplicity, we'll use the engine directly
    const result = await window.evaluate(async () => {
        // Load report and form
        const doc1 = await window.tflex.engine.loadDocument('doc1', 'samples/report.pdf');
        const doc2 = await window.tflex.engine.loadDocument('doc2', 'samples/form.pdf');
        
        // Merge doc2 into doc1 at the end
        await window.tflex.engine.merge('doc1', ['samples/form.pdf'], 34);
        const state = await window.tflex.engine.getState('doc1');
        return state.pageCount;
    });
    
    // report.pdf (34) + form.pdf (2) = 36
    expect(result).toBe(36);
  });

  test('P2 Regression: Reorder, Rotate, Delete, Undo', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    // Rotate
    await window.click('button[title="Rotate clockwise"]');
    let diag = await getDiag();
    expect(diag.modified).toBe(true);
    
    // Delete
    await window.click('button[title="Delete page"]');
    diag = await getDiag();
    expect(diag.pageCount).toBe(33);
    
    // Undo
    await window.click('button[title="Undo last change"]');
    diag = await getDiag();
    expect(diag.pageCount).toBe(34);
    
    // Reorder (via engine)
    await window.evaluate(async () => {
        const diag = window.tflexDiagnostics();
        await window.tflex.engine.applyOp(diag.activeTabId, { kind: 'reorder', from: 0, to: 5 });
    });
    diag = await getDiag();
    expect(diag.modified).toBe(true);
    
    await window.click('.tab-close');
  });
});
