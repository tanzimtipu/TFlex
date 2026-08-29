// Capture render-process-gone details during the UI huge-merge flow.
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const TEMP = process.env.TEMP || APP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('[' + new Date().toISOString().substring(11, 23) + '] ' + s);

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'file://C:/Users/tanzi/OneDrive/App%20Development/TFlex/dist/renderer/index.html' },
  });
  const win = await electronApp.firstWindow();
  win.on('close', () => log('PAGE CLOSED event'));
  win.on('crash', () => log('PAGE CRASH event'));
  win.on('console', (m) => { if (m.type() === 'error') log('RENDERER CONSOLE ERROR: ' + m.text().substring(0, 300)); });
  win.on('pageerror', (e) => log('RENDERER pageerror: ' + String(e).substring(0, 300)));
  electronApp.on('render-process-gone', (e, details) => log('RENDER-PROCESS-GONE: ' + JSON.stringify(details)));
  await win.waitForSelector('.sample-card', { timeout: 20000 });
  log('welcome ok');
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

  await win.evaluate(() => {
    Array.from(document.querySelectorAll('.sample-card')).find((c) => c.textContent.includes('report.pdf')).click();
  });
  await win.waitForFunction(() => window.tflexDiagnostics()?.pageCount === 34, null, { timeout: 20000 }).catch(() => log('wait 34 failed'));
  log('report open');
  await setDlg('open', path.join(TEMP, 'tflex-huge-A.pdf'));
  await win.click('button[aria-label="Merge with another PDF"]');
  await sleep(300);
  await win.click('.modal-dialog button:has-text("Choose PDF")');
  await sleep(800);
  const st = await win.evaluate(() => {
    const d = document.querySelector('.modal-picked')?.textContent;
    const mbtn = Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent.trim() === 'Merge');
    return { picked: d, mergeDisabled: mbtn ? mbtn.disabled : 'no-btn' };
  });
  log('after pick: ' + JSON.stringify(st));
  await win.click('.modal-footer button:has-text("Merge")');
  log('merge clicked');
  await sleep(1500);
  try { log('alive after merge click: ' + await win.evaluate(() => window.tflexDiagnostics().pageCount)); }
  catch (e) { log('DEAD after merge click: ' + e.message.split('\n')[0]); }
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});