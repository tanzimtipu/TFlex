// ADV phase-18 gate - tile loop cost vs `size`. Usage: node adv041_tile.cjs <size> [pages]
// One addWatermark(tile:true) is measured; a small positive size is the hostile case.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const SIZE = Number(process.argv[2] || 24);
const PAGES = process.argv[3] === 'report' ? 'report' : 'form';
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

setTimeout(() => { console.log('ADV041TILE HARD_TIMEOUT size=' + SIZE + ' pages=' + PAGES); process.exit(3); }, 60000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const formPath = getSamplePath('form.pdf').replace(/\\/g, '/');
  const reportPath = getSamplePath('report.pdf').replace(/\\/g, '/');

  await app.evaluate(async ({ dialog }) => {
    globalThis.__advSave = null;
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });

  const res = await win.evaluate(async (args) => {
    const { size, useReport, formPath, reportPath } = args;
    const api = window.tflex.engine;
    const src = useReport ? reportPath : formPath;
    const S = (m) => console.log('TILESTEP ' + m);
    S('start size=' + size);
    await api.loadDocument('tl', src);
    const st0 = await api.getState('tl');
    const pages = st0.ok ? st0.value.pageCount : -1;
    S('pages=' + pages);
    const t0 = Date.now();
    const r = await api.addWatermark('tl', { type: 'text', text: 'X', size, tile: true });
    const ms = Date.now() - t0;
    S('add ' + (r.ok ? 'ok' : r.error.code + ':' + r.error.message) + ' ms=' + ms);
    let wm = 'n/a';
    if (r.ok) {
      const g = await api.getWatermarks('tl');
      wm = g.ok ? JSON.stringify(g.value.map((w) => [w.id, w.pages.length])) : 'err';
    }
    return { size, pages, ms, add: r.ok ? 'ok' : r.error.code + ':' + r.error.message, wm };
  }, { size: SIZE, useReport: PAGES === 'report', formPath, reportPath });

  console.log('ADV041TILE RESULT ' + JSON.stringify(res));
  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041TILE FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  process.exit(1);
});
