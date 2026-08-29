// Repeat the save-in-flight race 3x to confirm reproducibility, and test the
// 8-byte truncated loadDocumentBytes unhandled throw at the IPC boundary.
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
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
  win.on('pageerror', (e) => log('renderer pageerror: ' + String(e).substring(0, 200)));
  await win.waitForSelector('.sample-card', { timeout: 20000 });

  // Race repeatability
  for (let trial = 1; trial <= 3; trial++) {
    const src = path.join(TEMP, 'tflex-race-x' + trial + '.pdf');
    fs.copyFileSync(path.join(APP, 'assets/samples/report.pdf'), src);
    const r = await win.evaluate(async (p) => {
      const api = window.tflex.engine;
      await api.loadDocument('adv-rx', p);
      await api.merge('adv-rx', [p], 'after'); // 68 pages
      const saveP = api.save('adv-rx');
      const dels = [];
      for (let i = 0; i < 3; i++) {
        dels.push(api.applyOp('adv-rx', { kind: 'delete', page: 67 - i }));
      }
      const saveRes = await saveP;
      const ds = await Promise.all(dels);
      const st = await api.getState('adv-rx');
      const rl = await api.loadDocument('adv-rx-chk', p);
      const disk = rl.ok ? (await api.getState('adv-rx-chk')).value.pageCount : -1;
      return { saveOk: saveRes.ok, dels: ds.map((x) => (x.ok ? 'ok' : x.error.code)), memPages: st.value.pageCount, diskPages: disk, modified: st.value.modified };
    }, src.replace(/\\/g, '/'));
    log('race trial ' + trial + ': ' + JSON.stringify(r));
  }

  // 8-byte truncated via loadDocumentBytes -> does the IPC throw instead of a Result?
  const trunc = await win.evaluate(async () => {
    const api = window.tflex.engine;
    try {
      const res = await api.loadDocumentBytes('adv-t1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]));
      return { returned: res.ok ? 'ok' : 'err:' + res.error.code };
    } catch (e) {
      return { THREW: e.message };
    }
  });
  log('8-byte truncated loadDocumentBytes: ' + JSON.stringify(trunc));

  // Also try the path-based loadDocument on the 8-byte file
  const tinyFile = path.join(TEMP, 'tflex-tiny.pdf');
  fs.writeFileSync(tinyFile, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]));
  const truncPath = await win.evaluate(async (p) => {
    const api = window.tflex.engine;
    try {
      const res = await api.loadDocument('adv-t2', p);
      return { returned: res.ok ? 'ok' : 'err:' + res.error.code };
    } catch (e) {
      return { THREW: e.message };
    }
  }, tinyFile.replace(/\\/g, '/'));
  log('path loadDocument of 8-byte file: ' + JSON.stringify(truncPath));

  // UI-level: open the 8-byte file via the app's Open dialog (sniff will reject - expect toast)
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
  await electronApp.evaluate((_e, o) => { globalThis.__advDlg.open = o.val; }, { val: tinyFile });
  await win.click('.btn-primary:has-text("Open")');
  await sleep(1500);
  const ui = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { openTabs: d.openTabs, toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent) };
  });
  log('UI open of 8-byte file: ' + JSON.stringify(ui));

  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});