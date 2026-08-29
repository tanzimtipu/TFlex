// Isolate: does a huge merge crash the app, with and without concurrent reorder?
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const TEMP = process.env.TEMP || APP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'file://C:/Users/tanzi/OneDrive/App%20Development/TFlex/dist/renderer/index.html' },
  });
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 20000 });
  await electronApp.evaluate(async ({ dialog }) => {
    globalThis.__advDlg = { open: null, save: null };
    dialog.showOpenDialog = async () => {
      const p = globalThis.__advDlg && globalThis.__advDlg.open;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advDlg && globalThis.__advDlg.save;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
    return true;
  });
  const setDlg = (k, v) => electronApp.evaluate((_e, kk, vv) => { globalThis.__advDlg[kk] = vv; }, k, v);

  // Part 1: huge merge with NO concurrent drag
  await win.evaluate(() => {
    Array.from(document.querySelectorAll('.sample-card')).find((c) => c.textContent.includes('report.pdf')).click();
  });
  await win.waitForFunction(() => window.tflexDiagnostics()?.pageCount === 34, null, { timeout: 20000 }).catch(() => {});
  await setDlg('open', path.join(TEMP, 'tflex-huge-A.pdf'));
  await win.click('button[aria-label="Merge with another PDF"]');
  await win.waitForSelector('.modal-dialog');
  await win.click('.modal-dialog button:has-text("Choose PDF")');
  await win.waitForTimeout(300);
  await win.click('.modal-footer button:has-text("Merge")');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const alive = await win.evaluate(() => typeof window.tflexDiagnostics === 'function').catch((e) => 'DEAD');
    if (alive !== 'DEAD') {
      const d = await win.evaluate(() => window.tflexDiagnostics());
      console.log(`  t=${(i + 1) * 500}ms pageCount=${d.pageCount} enginePc=${d.engineState ? d.engineState.pageCount : null}`);
      if (d.pageCount >= 1000) break;
    } else {
      console.log(`  t=${(i + 1) * 500}ms PAGE DEAD`);
      break;
    }
  }
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message.split('\n')[0]);
  process.exit(1);
});