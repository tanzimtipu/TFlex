// INSTALLED-APP-ONLY spec. Excluded from the standard suite via
// playwright.config.js testIgnore (e2e/installed/**). Run ONLY when the
// orchestrator explicitly asks to test the installed app.
//
// Diagnostic: does the installed 1.8.0 app pop the UpdatePromptDialog
// (.sheet-backdrop) during an e2e-style session? This explains the
// sweep_annotations_sign `.sheet-backdrop intercepts pointer events` failures.
// Read-only probe: screenshots + DOM inspection only, no assertions on app
// behavior, no edits to the app.
const { test } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const INSTALLED = process.env.TFLEX_PACKAGED_EXE || 'C:\\Program Files\\Jovrel\\Jovrel.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test('diag: installed app sheet-backdrop source', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp([], null, INSTALLED);
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    // Poll for up to 25s: does a sheet-backdrop appear (update prompt timing)?
    let seen = null;
    for (let i = 0; i < 25; i += 1) {
      const st = await win.evaluate(() => {
        const bd = document.querySelector('.sheet-backdrop');
        if (!bd) return { sheet: false };
        const sheet = bd.querySelector('.sheet, .sheet-dialog, [role="dialog"]');
        return {
          sheet: true,
          sheetClass: sheet ? sheet.className : '(no child)',
          text: (sheet ? sheet.textContent : bd.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
        };
      });
      if (st.sheet) { seen = st; break; }
      await win.waitForTimeout(1000);
    }
    console.log('[DIAG-SHEET] sheet-backdrop seen:', JSON.stringify(seen));
    await win.screenshot({ path: path.join(SHOTS, 'diag-installed-sheet-backdrop.png') });
    await hardClose(electronApp);
  } catch (err) {
    console.log('[DIAG-SHEET] FAILED:', err.message);
    await win.screenshot({ path: path.join(SHOTS, 'diag-installed-sheet-FAILURE.png') }).catch(() => {});
    await hardClose(electronApp);
    throw err;
  }
});