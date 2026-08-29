// Deep-instrument the Merge dialog pick flow
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
  win.on('console', (m) => { if (m.type() === 'error') log('CONSOLE ERR: ' + m.text().substring(0, 400)); });
  win.on('pageerror', (e) => log('pageerror: ' + String(e).substring(0, 400)));
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

  await win.evaluate(() => {
    Array.from(document.querySelectorAll('.sample-card')).find((c) => c.textContent.includes('report.pdf')).click();
  });
  await win.waitForFunction(() => window.tflexDiagnostics()?.pageCount === 34, null, { timeout: 20000 }).catch(() => {});
  log('report open');
  await setDlg('open', 'C:/FAKE/merge-source.pdf');

  // First, verify the raw IPC pick works from the dialog context:
  const raw = await win.evaluate(async () => await window.tflex.openFileDialog());
  log('raw IPC pick -> ' + JSON.stringify(raw));

  // Now the UI flow
  await win.click('button[aria-label="Merge with another PDF"]');
  await sleep(300);
  // instrument: monkey-bump window.tflex.openFileDialog reference? no - read-only.
  // Instead hook the app's pickFile by wrapping the exposed one in a Proxy? contextBridge is frozen.
  // Just observe: click Choose PDF and poll button label + picked
  await win.click('.modal-dialog button:has-text("Choose PDF")');
  for (let i = 0; i < 10; i++) {
    await sleep(250);
    const st = await win.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.modal-dialog button')).find((b) => b.textContent.includes('Picking') || b.textContent.includes('Choose') || b.textContent.includes('Change'));
      const picked = document.querySelector('.modal-picked')?.textContent;
      return { btnLabel: btn ? btn.textContent : '?', picked };
    });
    log('poll ' + i + ': ' + JSON.stringify(st));
  }
  await sleep(500);
  try { log('alive: ' + await win.evaluate(() => 1)); } catch (e) { log('DEAD: ' + e.message.split('\n')[0]); }
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});