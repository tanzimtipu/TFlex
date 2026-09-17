// ADV phase-18 gate - resource/perf abuse: N tiled text watermarks on report.pdf.
// Usage: node adv041_perf.cjs [count] [size] [tile:0|1]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const COUNT = Number(process.argv[2] || 100);
const SIZE = Number(process.argv[3] || 24);
const TILE = (process.argv[4] || '1') === '1';
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const savedPath = path.join(OUT_DIR, 'adv041 perf ' + COUNT + '-' + SIZE + '-' + (TILE ? 't' : 'n') + '.pdf').replace(/\\/g, '/');

setTimeout(() => { console.log('ADV041PERF HARD_TIMEOUT'); process.exit(3); }, 420000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('console', (m) => { const t = m.text(); if (t.startsWith('PERFSTEP')) console.log('ADV041PERF ' + t); });
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const reportPath = getSamplePath('report.pdf').replace(/\\/g, '/');

  await app.evaluate(async ({ dialog }) => {
    globalThis.__advSave = null;
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advSave;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
  });
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: savedPath });

  const startMem = (await app.evaluate(() => process.memoryUsage().heapUsed));

  const res = await win.evaluate(async (args) => {
    const { count, size, tile, reportPath } = args;
    const api = window.tflex.engine;
    const S = (m) => console.log('PERFSTEP ' + m);
    await api.loadDocument('p1', reportPath);
    const t0 = Date.now();
    let fails = 0;
    for (let i = 0; i < count; i++) {
      const r = await api.addWatermark('p1', { type: 'text', text: 'WM' + i, size, tile });
      if (!r.ok) { fails++; }
      if ((i + 1) % 10 === 0) S('applied ' + (i + 1) + ' elapsedMs=' + (Date.now() - t0) + ' memMB=' + Math.round(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1));
    }
    const applyMs = Date.now() - t0;
    const t1 = Date.now();
    const g = await api.getWatermarks('p1');
    const listMs = Date.now() - t1;
    const t2 = Date.now();
    const sa = await api.saveAs('p1');
    const saveMs = Date.now() - t2;
    return {
      count, size, tile, fails, applyMs, listMs, saveMs,
      saveOk: sa.ok, savePath: sa.ok ? sa.value : (sa.error ? sa.error.code + ':' + sa.error.message : 'n/a'),
      wmCount: g.ok ? g.value.length : -1,
      wmPagesTotal: g.ok ? g.value.reduce((a, w) => a + w.pages.length, 0) : -1,
    };
  }, { count: COUNT, size: SIZE, tile: TILE, reportPath });

  const fsPath = savedPath.replace(/\//g, '\\');
  const fileBytes = fs.existsSync(fsPath) ? fs.statSync(fsPath).size : -1;
  const endMem = (await app.evaluate(() => process.memoryUsage().heapUsed));
  console.log('ADV041PERF RESULT ' + JSON.stringify({ ...res, fileBytes, mainHeapStartMB: Math.round(startMem / 1048576), mainHeapEndMB: Math.round(endMem / 1048576) }));

  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041PERF FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  process.exit(1);
});