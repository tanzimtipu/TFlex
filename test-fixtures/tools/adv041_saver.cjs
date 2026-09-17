// ADV phase-18 gate - isolate the save/reopen hang with per-step logging.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const MODE = process.argv[2] || 'full';
const savedPath = path.join(OUT_DIR, 'adv041 saver ' + MODE + '.pdf').replace(/\\/g, '/');

setTimeout(() => { console.log('ADV041SAVER HARD_TIMEOUT mode=' + MODE); process.exit(3); }, 75000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('console', (m) => { const t = m.text(); if (t.startsWith('WMSTEP')) console.log('ADV041SAVER ' + t); });
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const reportPath = getSamplePath('report.pdf').replace(/\\/g, '/');
  const formPath = getSamplePath('form.pdf').replace(/\\/g, '/');

  await app.evaluate(async ({ dialog }) => {
    globalThis.__advSave = null;
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advSave;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
  });
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: savedPath });

  await win.evaluate(async (args) => {
    const { mode, reportPath, formPath, savedPath } = args;
    const api = window.tflex.engine;
    const S = (m) => console.log('WMSTEP ' + m);
    const sum = (r) => (r && r.ok === true ? 'ok' : (r && r.ok === false ? r.error.code + ':' + r.error.message : String(r)));
    const wmN = async (id) => { const r = await api.getWatermarks(id); return r.ok ? JSON.stringify(r.value.map((w) => [w.id, w.pages.length])) : 'err'; };
    const src = mode.indexOf('form') === 0 ? formPath : reportPath;
    S('start mode=' + mode);
    const rl = await api.loadDocument('s1', src); S('load ' + src.split('/').pop() + ' ' + sum(rl));
    if (mode === 'full' || mode === 'onewm' || mode === 'formfull' || mode === 'formone') {
      if (mode === 'full' || mode === 'formfull') {
        const rA = await api.addWatermark('s1', { type: 'text', text: 'WM-ONE', range: [1, 2] }); S('add A ' + sum(rA));
      }
      const text = mode.indexOf('form') === 0 ? 'WM-FORM' : 'WM-TWO';
      const rB = await api.addWatermark('s1', { type: 'text', text }); S('add B ' + sum(rB));
      S('wm ' + await wmN('s1'));
    }
    if (mode === 'plain') { S('no watermark'); }
    const t0 = Date.now();
    const sa = await api.saveAs('s1', savedPath); S('saveAs ' + sum(sa) + ' ms=' + (Date.now() - t0));
    const t1 = Date.now();
    const rl2 = await api.loadDocument('s2', savedPath); S('load saved ' + sum(rl2) + ' ms=' + (Date.now() - t1));
    const st2 = await api.getState('s2'); S('state ' + (st2.ok ? 'pages=' + st2.value.pageCount : 'err'));
    S('wm reload ' + await wmN('s2'));
    const rd = await api.deleteWatermark('s2', 'wm-1'); S('delete wm-1 ' + sum(rd));
    S('wm after delete ' + await wmN('s2'));
    const t2 = Date.now();
    const sv = await api.save('s2'); S('save ' + sum(sv) + ' ms=' + (Date.now() - t2));
    const t3 = Date.now();
    const rl3 = await api.loadDocument('s3', savedPath); S('load again ' + sum(rl3) + ' ms=' + (Date.now() - t3));
    S('wm after delete+reload ' + await wmN('s3'));
    const rC = await api.addWatermark('s3', { type: 'text', text: 'WM-THREE' }); S('add C ' + sum(rC));
    S('wm final ' + await wmN('s3'));
    S('DONE');
  }, { mode: MODE, reportPath, formPath, savedPath });

  console.log('ADV041SAVER EVAL_RETURNED mode=' + MODE);
  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041SAVER FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
