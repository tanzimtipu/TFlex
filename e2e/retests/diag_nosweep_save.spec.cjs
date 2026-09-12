// DIAGNOSTIC (qa, 2026-09-13): no_op_sweep.spec.cjs FAILS twice in a row at
// the DEF-075 Save step - click '[aria-label="Save"]' then waitForFunction
// !modified times out (30s). Reproduced 2/2 on the current dev build. This
// diagnostic replicates the exact step sequence and instruments the Save
// button (existence, box, disabled state, what a click does, whether modified
// clears, whether a dialog or toast appears). qa diagnostic - not a product
// fix and not a test adjustment.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

test('diag: no_op_sweep Save step', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // replicate DEF-075's placement steps (they pass in the sweep)
  await win.click('[aria-label="Sign tool"]');
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA Roundtrip');
  await win.click('.sig-tab-actions button:has-text("Save")');
  await win.waitForSelector('.sig-saved-pick');
  await win.click('.sig-saved-pick');
  await win.click('.pdf-page', { position: { x: 150, y: 150 } });
  await win.waitForSelector('[data-sig-action="confirm"]');
  await win.click('[data-sig-action="confirm"]');
  await win.waitForFunction(() => window.tflexDiagnostics().signatures.length > 0);
  const before = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const saveBtn = document.querySelector('[aria-label="Save"]');
    const cs = saveBtn ? getComputedStyle(saveBtn) : null;
    return {
      modified: d.modified,
      pageCount: d.pageCount,
      saveBtnExists: !!saveBtn,
      saveBtnDisabled: saveBtn ? saveBtn.disabled : null,
      saveBtnRect: saveBtn ? saveBtn.getBoundingClientRect().toJSON() : null,
      saveBtnPointerEvents: cs ? cs.pointerEvents : null,
      saveBtnVisibility: cs ? cs.visibility : null,
      saveBtnClass: saveBtn ? saveBtn.className : null,
      topAtCenter: (() => {
        const b = saveBtn.getBoundingClientRect();
        return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2).tagName + '.' +
            (document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2).className || '')
          : null;
      })(),
      dialogsOpen: !!document.querySelector('.dialog, .sheet, [data-about-dialog], [data-delete-pages-dialog]'),
    };
  });
  console.log('[diag] before save:', JSON.stringify(before, null, 1));

  await win.click('[aria-label="Save"]');
  // poll modified + UI state for 3s after the click
  for (let i = 0; i < 6; i += 1) {
    await win.waitForTimeout(500);
    const mid = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return {
        modified: d.modified,
        tabModified: d.tabModified,
        toast: (document.querySelector('[data-toast], .toast') || {}).textContent || null,
        dialogOpen: !!document.querySelector('.dialog, .sheet'),
      };
    });
    console.log(`[diag] t+${(i + 1) * 500}ms:`, JSON.stringify(mid));
    if (!mid.modified) break;
  }

  // save the file bytes check: did the file on disk change?
  const fs = require('node:fs');
  const stat = fs.statSync(reportPath);
  console.log(`[diag] sample file mtime: ${stat.mtime.toISOString()} size ${stat.size}`);

  const after = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, signatures: d.signatures.length, pageCount: d.pageCount };
  });
  console.log('[diag] after:', JSON.stringify(after));
  console.log('[diag] renderer errors:', JSON.stringify(errors));
  await win.screenshot({ path: require('node:path').resolve(__dirname, '../../screenshots/diag-nosweep-save-state.png') });

  // The diagnostic itself does not assert modified cleared - it instruments.
  await hardClose(electronApp, 'diag-nosweep-save');
});