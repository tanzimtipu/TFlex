import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { launchApp } = require('./lib/launch.cjs');

test.describe('Adversarial Reproduction', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    console.log('Launching Electron...');
    electronApp = await launchApp(['--disable-gpu', '--no-sandbox']);
    console.log('Electron launched. Waiting for window...');
    window = await electronApp.firstWindow();
    console.log('Window found. Waiting for .sample-card...');
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    console.log('Ready.');
  }, 120000);

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('ADV-008: Concurrent delete during in-flight save', async () => {
    // 1. Open report.pdf
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    const docId = diag.activeTabId;
    const filePath = diag.activeFilePath;
    
    // 2. Trigger save and immediately deletes
    const results = await window.evaluate(async (id) => {
      const saveP = window.tflex.engine.save(id);
      const op1 = window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      const op2 = window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      const op3 = window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      return await Promise.all([saveP, op1, op2, op3]);
    }, docId);

    console.log('ADV-008 results:', JSON.stringify(results));

    const finalDiag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('ADV-008 memPages:', finalDiag.pageCount);

    // Read file from disk to check page count
    // Since we can't easily parse PDF here, we'll just check if the engine thinks it's not modified
    // and if the disk file still has 34 pages when re-opened.
    
    expect(finalDiag.modified).toBe(false);
    expect(finalDiag.pageCount).toBe(31); // 34 - 3 = 31 in memory
    
    // Now close and re-open the same file
    await window.click('.tab-close');
    await new Promise(r => setTimeout(r, 500));
    
    // We need to open the file that was just "saved"
    // The samples are opened as copies in a temp dir usually.
    // Let's check where it was.
    console.log('ADV-008 saved file path:', filePath);
    
    // Use the engine to load it again
    const reopenResult = await window.evaluate(async (path) => {
      return await window.tflex.engine.loadDocument('repro-8', path);
    }, filePath);
    
    const reopenedState = await window.evaluate(async () => {
      return await window.tflex.engine.getState('repro-8');
    });
    
    console.log('ADV-008 diskPages:', reopenedState.pageCount);
    
    if (reopenedState.pageCount === 34 && finalDiag.pageCount === 31) {
      console.log('ADV-008 REPRODUCED: Memory has 31 pages, Disk has 34 pages, Modified is false.');
    }
  });

  test('ADV-009: Undo button disables after single undo', async () => {
    // Open report.pdf
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    // Rotate 4 times
    for (let i = 0; i < 4; i++) {
      await window.click('button[title="Rotate clockwise"]');
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Check if undo button is enabled
    const undoBtn = window.locator('button[title="Undo last change"]');
    await expect(undoBtn).not.toBeDisabled();
    
    // Click undo once
    await undoBtn.click();
    await new Promise(r => setTimeout(r, 200));
    
    // Check if it's now disabled
    const isDisabled = await undoBtn.isDisabled();
    console.log('ADV-009 Undo button disabled after one click:', isDisabled);
    
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log('ADV-009 canUndo in engine:', diag.canUndo);
    
    if (isDisabled && diag.canUndo) {
       console.log('ADV-009 REPRODUCED: Undo button disabled but engine can still undo.');
    }
  });

  test('ADV-010: Save-As fails silently', async () => {
    // Open report.pdf
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    await window.click('button[title="Rotate clockwise"]');
    
    // Try to save to a path that should fail (e.g., a directory, or system protected path)
    const protectedPath = 'C:/Windows/System32/tflex_test_should_fail.pdf';
    
    const result = await window.evaluate(async (path) => {
      const diag = window.tflexDiagnostics();
      try {
        return await window.tflex.engine.saveAs(diag.activeTabId, path);
      } catch (e) {
        return { error: e.message };
      }
    }, protectedPath);
    
    console.log('ADV-010 Save-As result:', JSON.stringify(result));
    
    // Check for toasts
    const toastCount = await window.locator('.toast').count();
    console.log('ADV-010 Toast count:', toastCount);
    
    if (result.error && result.error.code === 'cancelled' && toastCount === 0) {
       // Wait, if it returns 'cancelled' for an error, that's the bug
    }
    
    // The ADV report says it returns 'cancelled' for every failure
    if (toastCount === 0) {
      console.log('ADV-010 REPRODUCED: No toast shown for failed Save-As.');
    }
  });

  test('ADV-011: Split-all leaves 0-page source', async () => {
    // Open report.pdf
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    const docId = diag.activeTabId;
    const filePath = diag.activeFilePath;

    // Split all pages (1-34)
    // We'll call the engine directly to avoid UI interaction complexity for the split dialog
    await window.evaluate(async (id) => {
      return await window.tflex.engine.split(id, '1-34', 'split');
    }, docId);
    
    const state = await window.evaluate(async (id) => {
      return await window.tflex.engine.getState(id);
    }, docId);
    
    console.log('ADV-011 Source page count after split-all:', state.pageCount);
    
    if (state.pageCount === 0) {
      console.log('ADV-011 REPRODUCED: Source document has 0 pages.');
      
      // Save it
      await window.evaluate(async (id) => {
        await window.tflex.engine.save(id);
      }, docId);
      
      // Reopen
      await window.evaluate(async (path) => {
        await window.tflex.engine.loadDocument('repro-11', path);
      }, filePath);
      
      const reopenedState = await window.evaluate(async () => {
        return await window.tflex.engine.getState('repro-11');
      });
      
      console.log('ADV-011 Reopened page count:', reopenedState.pageCount);
      if (reopenedState.pageCount === 1) {
        console.log('ADV-011 REPRODUCED: Saved 0-page PDF reopened as 1-page PDF.');
      }
    }
  });

  test('ADV-012: Engine throws TypeError on corrupt bytes', async () => {
    const junk = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    
    const result = await window.evaluate(async (bytes) => {
      try {
        const res = await window.tflex.engine.loadDocumentBytes('junk-doc', bytes);
        return { res };
      } catch (e) {
        return { error: { message: e.message, stack: e.stack } };
      }
    }, junk);
    
    console.log('ADV-012 Result:', JSON.stringify(result));
    
    if (result.error && result.error.message.includes("Cannot read properties of undefined (reading 'Pages')")) {
      console.log('ADV-012 REPRODUCED: Engine threw TypeError instead of returning Result.');
    }
  });
});
