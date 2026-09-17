// ADV phase-18 gate - apply through the UI and screenshot the rendered page (proxy refresh).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const saved = path.join(OUT_DIR, 'adv041 render-ui.pdf').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041RND ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041RND HARD_TIMEOUT'); process.exit(3); }, 180000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 200)));
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
  await app.evaluate((_e, o) => { globalThis.__advOpen = o.val; globalThis.__advSave = o.save; }, { val: src, save: saved });
  await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
  await win.waitForFunction(() => window.tflexDiagnostics && window.tflexDiagnostics().pageCount > 1, { timeout: 30000 });

  await win.click('[data-tools-badge]');
  await win.waitForSelector('[data-tool-id="watermark"]', { timeout: 10000 });
  await win.click('[data-tool-id="watermark"]');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
  await sleep(300);
  await win.fill('[data-watermark-text]', 'RENDER-TEST');
  await win.fill('[data-watermark-size]', '64');
  await win.fill('[data-watermark-opacity]', '100');
  await sleep(200);
  await win.click('[data-watermark-confirm]');
  await sleep(4000);
  logj('applied-via-ui', await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const g = await api.getWatermarks(docId);
    return { wm: g.ok ? g.value.map((w) => [w.id, w.text, w.pages.length]) : 'err', modified: window.tflexDiagnostics().modified };
  }));
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-render-ui-applied.png') });

  // save + reopen through the UI's save path, then screenshot the reopened page
  await win.keyboard.press('Control+s').catch(() => {});
  await sleep(2500);
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-render-ui-after-save.png') });

  await Promise.race([app.close(), sleep(5000)]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041RND FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
