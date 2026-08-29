// Pinpoint when the page dies around a huge merge.
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
  await win.on('close', () => log('PAGE CLOSED'));
  await win.on('crash', () => log('PAGE CRASHED'));
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

  // STEP 1: engine-level huge merge (no UI) - does the ENGINE survive?
  log('step1: engine-level merge');
  try {
    const r = await win.evaluate(async (p) => {
      const api = window.tflex.engine;
      const load = await api.loadDocument('iso-m', 'C:/Users/tanzi/OneDrive/App Development/TFlex/assets/samples/report.pdf');
      const m = await api.merge('iso-m', [p], 'after');
      return { loadOk: load.ok, mergeOk: m.ok, pages: m.ok ? m.value.pageCount : (m.error && m.error.message) };
    }, path.join(TEMP, 'tflex-huge-A.pdf').replace(/\\/g, '/'));
    log('step1 result: ' + JSON.stringify(r));
  } catch (e) {
    log('step1 DEAD: ' + e.message.split('\n')[0]);
    process.exit(1);
  }
  await sleep(1500);
  try { log('page alive check: ' + await win.evaluate(() => 2)) } catch (e) { log('page now DEAD: ' + e.message.split('\n')[0]); process.exit(1); }

  // STEP 2: UI merge of huge into sample
  log('step2: UI merge of huge into report - open dialog OK');
  await win.evaluate(() => {
    Array.from(document.querySelectorAll('.sample-card')).find((c) => c.textContent.includes('report.pdf')).click();
  });
  await win.waitForFunction(() => window.tflexDiagnostics()?.pageCount === 34, null, { timeout: 20000 }).catch(() => log('wait pagecount 34 timed out'));
  log('sample open ok');
  await setDlg('open', path.join(TEMP, 'tflex-huge-A.pdf'));
  await win.click('button[aria-label="Merge with another PDF"]');
  log('merge dialog opened');
  await win.click('.modal-dialog button:has-text("Choose PDF")');
  await sleep(500);
  log('choose pdf clicked');
  const picked = await win.evaluate(() => document.querySelector('.modal-picked')?.textContent);
  log('picked shows: ' + picked);
  await win.click('.modal-footer button:has-text("Merge")');
  log('merge confirm clicked');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const d = await win.evaluate(() => {
        const dd = window.tflexDiagnostics();
        return { pc: dd.pageCount, epc: dd.engineState ? dd.engineState.pageCount : null };
      });
      log('poll t=' + ((i + 1) * 500) + 'ms pc=' + d.pc + ' epc=' + d.epc);
      if (d.pc >= 1000) break;
    } catch (e) {
      log('POLL DEAD at t=' + ((i + 1) * 500) + 'ms: ' + e.message.split('\n')[0]);
      break;
    }
  }
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});