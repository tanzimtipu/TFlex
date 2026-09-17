// ADV phase-18 gate - does the applied list refresh after delete when many watermarks exist?
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.argv[2] || 50);
const logj = (tag, obj) => console.log('ADV041REF ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041REF HARD_TIMEOUT'); process.exit(3); }, 220000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 200)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const src = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }) => {
    globalThis.__advOpen = null;
    dialog.showOpenDialog = async () => {
      const p = globalThis.__advOpen;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  });
  await app.evaluate((_e, o) => { globalThis.__advOpen = o.val; }, { val: src });
  await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
  await win.waitForFunction(() => window.tflexDiagnostics && window.tflexDiagnostics().pageCount > 1, { timeout: 30000 });

  const openWatermark = async () => {
    await win.waitForFunction(() => !document.querySelector('[data-watermark-dialog]'), { timeout: 8000 }).catch(() => {});
    if (!(await win.$('[data-tool-id="watermark"]'))) {
      await win.click('[data-tools-badge]');
      await win.waitForSelector('[data-tool-id="watermark"]', { timeout: 10000 });
    }
    await win.click('[data-tool-id="watermark"]');
    await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
    await sleep(300);
  };

  const setup = await win.evaluate(async (count) => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const t0 = performance.now();
    for (let i = 0; i < count; i++) await api.addWatermark(docId, { type: 'text', text: 'R' + i, size: 24 });
    return { addMs: Math.round(performance.now() - t0), docId };
  }, N);
  logj('setup', setup);

  await openWatermark();
  const snap = () => win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const g = await api.getWatermarks(docId);
    return {
      engine: g.ok ? g.value.length : -1,
      dom: document.querySelectorAll('[data-watermark-applied]').length,
      hasWm1: !!document.querySelector('[data-watermark-delete="wm-1"]'),
    };
  });

  logj('before', await snap());
  await win.click('[data-watermark-delete="wm-1"]');
  const series = [];
  for (let i = 0; i < 24; i++) { await sleep(500); series.push({ t: (i + 1) * 500, ...(await snap()) }); }
  logj('series', series);
  logj('final', await snap());

  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041REF FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
