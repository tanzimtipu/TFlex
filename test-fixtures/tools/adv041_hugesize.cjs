// ADV phase-18 gate - bake watermark with size=1e9, save, reopen via UI (pdf.js render).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'adv041 size1e9.pdf').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041BIG ' + tag + ' ' + JSON.stringify(obj));
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => ({ __timeout: label }))]);
setTimeout(() => { console.log('ADV041BIG HARD_TIMEOUT'); process.exit(3); }, 180000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 240)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const src = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }) => {
    globalThis.__advOpen = null;
    globalThis.__advSave = null;
    dialog.showOpenDialog = async () => {
      const p = globalThis.__advOpen;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advSave;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
  });
  const setOpen = (p) => app.evaluate((_e, o) => { globalThis.__advOpen = o.val; }, { val: p });
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: out });

  await setOpen(src);
  await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
  await win.waitForFunction(() => window.tflexDiagnostics && window.tflexDiagnostics().pageCount > 1, { timeout: 30000 });

  const baked = await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const t0 = performance.now();
    const r = await api.addWatermark(docId, { type: 'text', text: 'HUGE', size: 1e9, position: 'center' });
    const addMs = Math.round(performance.now() - t0);
    const sa = await api.saveAs(docId);
    return { addOk: r.ok, addErr: r.ok ? null : r.error.code + ':' + r.error.message, addMs, saveOk: sa.ok, path: sa.ok ? sa.value : null };
  });
  logj('baked', baked);

  // close the tab (saved -> unmodified), then reopen the saved file through the UI
  const tabIds = await win.evaluate(() => Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => t.getAttribute('data-tab-id')));
  await win.click('[data-tab-id="' + tabIds[0] + '"] .tab-close').catch((e) => logj('close-err', { e: String(e.message).slice(0, 120) }));
  await sleep(1200);
  logj('tabs-after-close', await win.evaluate(() => (window.tflexDiagnostics ? window.tflexDiagnostics().openTabs : -1)));

  await setOpen(out);
  await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
  for (let i = 1; i <= 12; i++) {
    await sleep(1000);
    const r = await withTimeout(win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return { pageCount: d.pageCount, openTabs: d.openTabs, currentPage: d.currentPage };
    }), 3000, 'poll' + i);
    logj('reopen-poll', { i, r });
    if (r && r.__timeout) break;
  }
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-size1e9-reopen.png') }).catch((e) => logj('shot-err', { e: String(e.message).slice(0, 120) }));
  logj('file', { exists: fs.existsSync(out.replace(/\//g, '\\')), bytes: fs.existsSync(out.replace(/\//g, '\\')) ? fs.statSync(out.replace(/\//g, '\\')).size : 0 });

  await Promise.race([app.close(), sleep(5000)]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041BIG FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
