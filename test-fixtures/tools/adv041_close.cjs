// ADV phase-18 gate - measure app.close() time with N watermarks on the doc.
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');
const N = Number(process.argv[2] || 0);
const logj = (tag, obj) => console.log('ADV041CLS ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041CLS HARD_TIMEOUT n=' + N); process.exit(3); }, 120000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
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
  if (N > 0) {
    const t0 = Date.now();
    await win.evaluate(async (count) => {
      const api = window.tflex.engine;
      const docId = window.tflexDiagnostics().engineDocId;
      for (let i = 0; i < count; i++) await api.addWatermark(docId, { type: 'text', text: 'C' + i, size: 24 });
    }, N);
    logj('applied', { n: N, ms: Date.now() - t0 });
  }
  const t1 = Date.now();
  const closed = await Promise.race([app.close().then(() => 'closed'), new Promise((r) => setTimeout(() => r('timeout'), 45000))]);
  logj('close', { n: N, result: closed, ms: Date.now() - t1 });
  process.exit(0);
})().catch((e) => {
  console.log('ADV041CLS FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  process.exit(1);
});
