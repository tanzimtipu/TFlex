// Verify dialog state passing convention for electronApp.evaluate
const { _electron: electron } = require('@playwright/test');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('[' + new Date().toISOString().substring(11, 23) + '] ' + s);

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
  // Single-object arg convention
  const setDlg = async (which, val) => {
    const r = await electronApp.evaluate((_e, o) => {
      globalThis.__advDlg[o.which] = o.val;
      return JSON.parse(JSON.stringify(globalThis.__advDlg));
    }, { which, val });
    log('after setDlg(' + which + '): ' + JSON.stringify(r));
  };
  const getDlg = () => electronApp.evaluate((_e) => JSON.parse(JSON.stringify(globalThis.__advDlg)));

  await setDlg('open', 'C:/FAKE/merge-source.pdf');
  log('getDlg: ' + JSON.stringify(await getDlg()));
  const raw = await win.evaluate(async () => await window.tflex.openFileDialog());
  log('raw IPC pick -> ' + JSON.stringify(raw));

  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});