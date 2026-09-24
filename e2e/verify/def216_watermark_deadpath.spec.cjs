// DEF-216 focused verification (qa, 2026-09-17, phase-18 gate triage).
//
// Phase 18 promises the Watermark tool: open the Tools palette, pick
// Watermark, type text, click "Apply watermark" -> the engine bakes the
// watermark into the document and the host toasts "Watermark applied."
//
// The orchestrator's HEAD read says the apply control is a DEAD PATH:
//   - src/shared/ipc.ts:144 declares the channel
//       engineAddWatermark: "engine:addWatermark"
//   - src/main/index.ts registers NO ipcMain.handle for it (the engine
//     handler block ends at engineImportFdf).
//   - src/preload/preload.ts exposes NO addWatermark method (the engine
//     bridge ends at importFdf; addStamp is the last Phase-12 entry).
//   - so engineClient.addWatermark (src/renderer/engine/engineClient.ts:1211)
//     hits `this.inner.addWatermark === undefined` and returns
//     missingPhase18() -> err("engine-error", "watermark requires the
//     Phase 18 backend update") (engineClient.ts:636-641).
//   - App.tsx onWatermarkConfirm (App.tsx:4390-4420) then pushes an ERROR
//     toast via describeEngineError: for code "engine-error" that renders
//     as "Engine error: <context>".
//
// This spec drives the real dev build through the canonical launchApp()
// helper (e2e/lib/launch.cjs), performs the exact user flow, captures the
// toast the app actually shows (TOAST_EVIDENCE), screenshots the state,
// and asserts the Phase-18 promise (toast "Watermark applied.", no error
// styling). A failure of the final assertion is the defect evidence.
//
// Screenshot: screenshots/def-216-watermark-deadpath.png

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { shot, hardClose, openSample, runTool } = require('../lib/helpers.cjs');

test('DEF-216: Watermark apply is a dead path - engine:addWatermark never registered/exposed', async () => {
  test.setTimeout(180000);

  const electronApp = await launchApp([], null, null);
  const window = await electronApp.firstWindow();
  try {
    // 1. Launch (welcome screen) and open the bundled "report" sample
    //    through the same flow the other specs use: override the open
    //    dialog, click "Open PDF" on the welcome screen.
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await window.waitForTimeout(1500); // settle the workspace

    // 2-3. Phase 36 migration: the All-tools palette is retired; runTool opens
    // the Watermark dialog through its current home (REVIEW dock verb).
    await runTool(window, 'watermark');
    const entryEnabled = (await window.locator('[data-watermark-dialog]').count()) > 0;
    console.log(`[def216] watermark dialog mounted: ${entryEnabled}`);
    // (runTool already opened the Watermark dialog through its current home.)

    // 4. The Watermark dialog must mount.
    const dialog = window.locator('[data-watermark-dialog]');
    await dialog.waitFor({ timeout: 15000, state: 'attached' });
    console.log('[def216] [data-watermark-dialog] mounted');

    // 5. Type "CONFIDENTIAL" into the text field (default type is text).
    const textField = window.locator('[data-watermark-text]');
    await textField.waitFor({ timeout: 15000, state: 'visible' });
    await textField.fill('CONFIDENTIAL');

    // 6. Click "Apply watermark" and wait for the toast.
    const confirm = window.locator('[data-watermark-confirm]');
    await confirm.waitFor({ timeout: 15000, state: 'visible' });
    await confirm.click();
    const toast = window.locator('.toast-stack .toast').first();
    await toast.waitFor({ timeout: 10000, state: 'visible' });
    await window.waitForTimeout(1500); // let the toast animation settle

    // 7. Capture the exact toast text + styling class.
    const toastText = (await toast.locator('.toast-text').textContent()) || '';
    const toastClass = await toast.getAttribute('class');
    const isErrorToast = /toast-error/.test(toastClass || '');
    console.log(`TOAST_EVIDENCE="${toastText}" (class="${toastClass}", isError=${isErrorToast})`);

    // 8. Screenshot the post-apply state (dialog closed, toast visible).
    await shot(window, 'def-216-watermark-deadpath.png');

    // 9. Assert the Phase-18 promise. This is expected to FAIL on the
    //    current HEAD: the engine channel is unregistered in main and
    //    unexposed in preload, so the user gets the error toast instead.
    expect(
      toastText,
      `Phase 18 promise: the apply must confirm with the success toast, not an error (dead path: engine:addWatermark never registered in main / exposed in preload)`,
    ).toBe('Watermark applied.');
    expect(
      isErrorToast,
      'Phase 18 promise: no error styling on the confirm toast',
    ).toBe(false);
  } finally {
    await hardClose(electronApp, 'def216-watermark');
  }
});