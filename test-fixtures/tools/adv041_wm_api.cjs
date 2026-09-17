// ADV phase-18 gate - watermark API hostile settings / delete / save-reopen.
// Usage: node adv041_wm_api.cjs <group>
// Groups: base textA sizeBig ranges imgSmall img100 delete undoRedo saveReopen race
// Read-only use of the canonical launcher.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const GROUP = process.argv[2] || 'base';
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const logj = (tag, obj) => console.log('ADV041 ' + tag + ' ' + JSON.stringify(obj));
const HARD_MS = Number(process.env.ADV_HARD_MS || 90000);
setTimeout(() => { console.log('ADV041 HARD_TIMEOUT group=' + GROUP); process.exit(3); }, HARD_MS).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });

  const formPath = getSamplePath('form.pdf').replace(/\\/g, '/');
  const reportPath = getSamplePath('report.pdf').replace(/\\/g, '/');
  const savedPath = path.join(OUT_DIR, 'adv041 saved output.pdf').replace(/\\/g, '/');
  const raceOut = path.join(OUT_DIR, 'race.pdf').replace(/\\/g, '/');

  await app.evaluate(async ({ dialog }) => {
    globalThis.__advSave = null;
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advSave;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
  });
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: GROUP === 'race' ? raceOut : savedPath });

  const res = await win.evaluate(async (args) => {
    const { group, formPath, reportPath, savedPath, raceOut, png, outDir } = args;
    const api = window.tflex.engine;
    const R = [];
    const sum = (r) => {
      if (r && typeof r === 'object' && 'ok' in r) {
        if (!r.ok) return { ok: false, code: r.error && r.error.code, msg: r.error && r.error.message };
        const v = r.value;
        if (v && typeof v === 'object' && 'pageCount' in v) {
          return { ok: true, value: { pageCount: v.pageCount, modified: v.modified, deleted: v.deleted, annotations: v.annotations && v.annotations.length } };
        }
        return { ok: true, v };
      }
      return { raw: String(r) };
    };
    const call = async (name, fn) => {
      try { const r = await fn(); R.push({ name, ...sum(r) }); return r; }
      catch (e) { R.push({ name, THREW: String(e && e.message ? e.message : e) }); return null; }
    };
    const cat = (r) => (r && r.ok
      ? { ok: true, n: r.value.length, ids: r.value.map((w) => w.id), pages: r.value.map((w) => w.pages), texts: r.value.map((w) => w.text) }
      : sum(r));
    const getWm = async (id) => {
      try { return await api.getWatermarks(id); } catch (e) { return { THREW: String(e && e.message ? e.message : e) }; }
    };
    const add = (docId, settings) => api.addWatermark(docId, settings);

    if (group === 'base') {
      await api.loadDocument('base', formPath);
      const bf = await api.getState('base');
      await api.loadDocument('baser', reportPath);
      const br = await api.getState('baser');
      R.push({ name: 'pageCounts', form: bf.ok ? bf.value.pageCount : sum(bf), report: br.ok ? br.value.pageCount : sum(br) });
      await api.loadDocument('v1', formPath);
      await call('valid text default', () => add('v1', { type: 'text', text: 'OK' }));
      R.push({ name: 'valid wm', wm: cat(await getWm('v1')) });
      const st = await api.getState('v1');
      R.push({ name: 'valid state', modified: st.ok ? st.value.modified : sum(st) });
    }

    if (group === 'textA') {
      const cases = [
        ['size=0', { type: 'text', text: 'S0', size: 0 }],
        ['size=-5', { type: 'text', text: 'Sneg', size: -5 }],
        ['size=NaN', { type: 'text', text: 'SNaN', size: NaN }],
        ['size=Infinity', { type: 'text', text: 'SInf', size: Infinity }],
        ['opacity=-1', { type: 'text', text: 'O-1', opacity: -1 }],
        ['opacity=2', { type: 'text', text: 'O2', opacity: 2 }],
        ['opacity=NaN', { type: 'text', text: 'ONaN', opacity: NaN }],
        ['color bad', { type: 'text', text: 'CBAD', color: { r: 2, g: -1, b: NaN } }],
        ['x NaN', { type: 'text', text: 'XNaN', x: NaN, y: 10 }],
        ['x Inf y -1e9', { type: 'text', text: 'XINF', x: Infinity, y: -1e9 }],
        ['x only', { type: 'text', text: 'XONLY', x: 50 }],
        ['y only', { type: 'text', text: 'YONLY', y: 50 }],
        ['font unknown', { type: 'text', text: 'FBAD', font: 'Comic Sans' }],
        ['position unknown', { type: 'text', text: 'PBAD', position: 'middle' }],
        ['type unknown', { type: 'nope', text: 'TBAD' }],
        ['text empty', { type: 'text', text: '' }],
        ['no text field', { type: 'text' }],
        ['settings null', null],
        ['settings string', 'not-an-object'],
        ['only spaces text', { type: 'text', text: '   ' }],
      ];
      for (const [label, settings] of cases) {
        const id = 't-' + label.replace(/[^a-z0-9]/gi, '_');
        await api.loadDocument(id, formPath);
        const r = await call('add ' + label, () => add(id, settings));
        const st = await api.getState(id);
        const wm = cat(await getWm(id));
        R.push({ name: 'RESULT ' + label, applied: !!(r && r.ok), modified: st.ok ? st.value.modified : sum(st), wm });
      }
    }

    if (group === 'sizeBig') {
      await api.loadDocument('b1', formPath);
      await call('size=1e9', () => add('b1', { type: 'text', text: 'SBIG', size: 1e9 }));
      R.push({ name: 'size=1e9 wm', wm: cat(await getWm('b1')) });
      await api.loadDocument('b2', formPath);
      await call('text 100k', () => add('b2', { type: 'text', text: 'A'.repeat(100000) }));
      const st = await api.getState('b2');
      R.push({ name: 'text 100k state', modified: st.ok ? st.value.modified : sum(st), wm: cat(await getWm('b2')) });
      await call('text 100k nonASCII', () => add('b2', { type: 'text', text: '\u4e2d\u6587'.repeat(10000) }));
      R.push({ name: 'text 100k nonASCII wm', wm: cat(await getWm('b2')) });
    }

    if (group === 'ranges') {
      const ranges = [
        ['range [0,0]', [0, 0]],
        ['range [3,2]', [3, 2]],
        ['range [1,9999]', [1, 9999]],
        ['range [1.5,3]', [1.5, 3]],
        ['range ["1",2]', ['1', 2]],
        ['range [1,1]', [1, 1]],
        ['range [5,6]', [5, 6]],
        ['range len3', [1, 2, 3]],
        ['range [NaN,2]', [NaN, 2]],
        ['range [-5,-1]', [-5, -1]],
      ];
      for (const [label, range] of ranges) {
        const id = 'r-' + label.replace(/[^a-z0-9]/gi, '_');
        await api.loadDocument(id, reportPath);
        const r = await call('add ' + label, () => add(id, { type: 'text', text: 'RG', range }));
        R.push({ name: 'RESULT ' + label, applied: !!(r && r.ok), wm: cat(await getWm(id)) });
      }
    }

    if (group === 'imgSmall') {
      const pngBytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const truncPng = pngBytes.slice(0, 24);
      const randomBytes = new Uint8Array(64);
      for (let i = 0; i < randomBytes.length; i++) randomBytes[i] = (i * 37) & 0xff;
      const cases = [
        ['img 1x1 png', pngBytes],
        ['img truncated png', truncPng],
        ['img random bytes', randomBytes],
        ['img empty bytes', new Uint8Array(0)],
        ['img text as bytes', new TextEncoder().encode('not an image at all')],
      ];
      for (const [label, bytes] of cases) {
        const id = 'i-' + label.replace(/[^a-z0-9]/gi, '_');
        await api.loadDocument(id, formPath);
        const r = await call('add ' + label, () => add(id, { type: 'image', imageBytes: bytes, size: 100 }));
        const st = await api.getState(id);
        R.push({ name: 'RESULT ' + label, applied: !!(r && r.ok), modified: st.ok ? st.value.modified : sum(st), wm: cat(await getWm(id)) });
      }
      await api.loadDocument('i-none', formPath);
      await call('img no bytes', () => add('i-none', { type: 'image' }));
      R.push({ name: 'RESULT img no bytes', wm: cat(await getWm('i-none')) });
      // imageSize extreme on a small png
      await api.loadDocument('i-big', formPath);
      await call('img 1x1 size=1e9', () => add('i-big', { type: 'image', imageBytes: pngBytes, size: 1e9 }));
      R.push({ name: 'RESULT img size=1e9', wm: cat(await getWm('i-big')) });
    }

    if (group === 'img100') {
      const bigBytes = new Uint8Array(100 * 1024 * 1024);
      const t0 = performance.now();
      await api.loadDocument('big', formPath);
      const r = await call('add img 100MB zeros', () => add('big', { type: 'image', imageBytes: bigBytes, size: 100 }));
      R.push({ name: 'img 100MB elapsedMs', ms: Math.round(performance.now() - t0), applied: !!(r && r.ok), wm: cat(await getWm('big')) });
    }

    if (group === 'delete') {
      await api.loadDocument('d1', formPath);
      await call('d1 add wm', () => add('d1', { type: 'text', text: 'DELME' }));
      R.push({ name: 'd1 after add', wm: cat(await getWm('d1')) });
      for (const bad of ['', 'wm-999']) await call('delete "' + bad + '"', () => api.deleteWatermark('d1', bad));
      await call('delete null', () => api.deleteWatermark('d1', null));
      await call('delete undefined', () => api.deleteWatermark('d1', undefined));
      await call('delete 7', () => api.deleteWatermark('d1', 7));
      await call('delete {}', () => api.deleteWatermark('d1', {}));
      await call('delete []', () => api.deleteWatermark('d1', []));
      R.push({ name: 'd1 after bad deletes', wm: cat(await getWm('d1')) });
      await call('delete wm-1 #1', () => api.deleteWatermark('d1', 'wm-1'));
      R.push({ name: 'd1 after real delete', wm: cat(await getWm('d1')) });
      await call('delete wm-1 #2', () => api.deleteWatermark('d1', 'wm-1'));
      R.push({ name: 'd1 after double delete', wm: cat(await getWm('d1')) });
      await call('delete unknown doc watermark', () => api.deleteWatermark('nope', 'wm-1'));
      // two watermarks, delete middle/unknown ordering
      await api.loadDocument('d2', formPath);
      await call('d2 add A', () => add('d2', { type: 'text', text: 'AAA' }));
      await call('d2 add B', () => add('d2', { type: 'text', text: 'BBB' }));
      R.push({ name: 'd2 after 2 adds', wm: cat(await getWm('d2')) });
      await call('d2 delete wm-1', () => api.deleteWatermark('d2', 'wm-1'));
      R.push({ name: 'd2 after delete wm-1', wm: cat(await getWm('d2')) });
      await call('d2 add C (id reuse?)', () => add('d2', { type: 'text', text: 'CCC' }));
      R.push({ name: 'd2 after add C', wm: cat(await getWm('d2')) });
    }

    if (group === 'undoRedo') {
      await api.loadDocument('u1', formPath);
      await call('u1 add', () => add('u1', { type: 'text', text: 'UNDO' }));
      R.push({ name: 'u1 after add', wm: cat(await getWm('u1')) });
      await call('u1 undo', () => api.undo('u1'));
      R.push({ name: 'u1 after undo', wm: cat(await getWm('u1')) });
      await call('u1 redo', () => api.redo('u1'));
      R.push({ name: 'u1 after redo', wm: cat(await getWm('u1')) });
      await call('u1 delete', () => api.deleteWatermark('u1', 'wm-1'));
      R.push({ name: 'u1 after delete', wm: cat(await getWm('u1')) });
      await call('u1 undo2', () => api.undo('u1'));
      R.push({ name: 'u1 after undo of delete', wm: cat(await getWm('u1')) });
      await call('u1 redo2', () => api.redo('u1'));
      R.push({ name: 'u1 after redo of delete', wm: cat(await getWm('u1')) });
      // add, undo, add again -> id numbering after undo
      await api.loadDocument('u2', formPath);
      await call('u2 add 1', () => add('u2', { type: 'text', text: 'ONE' }));
      await call('u2 undo', () => api.undo('u2'));
      await call('u2 add 2', () => add('u2', { type: 'text', text: 'TWO' }));
      R.push({ name: 'u2 add-undo-add', wm: cat(await getWm('u2')) });
    }

    if (group === 'saveReopen') {
      await api.loadDocument('s1', reportPath);
      await call('s1 add A range 1-2', () => add('s1', { type: 'text', text: 'WM-ONE', range: [1, 2] }));
      await call('s1 add B all', () => add('s1', { type: 'text', text: 'WM-TWO' }));
      R.push({ name: 's1 wm before reload', wm: cat(await getWm('s1')) });
      const sa = await call('s1 saveAs', () => api.saveAs('s1'));
      R.push({ name: 's1 saveAs path', p: sa && sa.ok ? sa.value : null });
      await api.loadDocument('s2', savedPath);
      const st2 = await api.getState('s2');
      R.push({ name: 's2 reload pageCount', v: st2.ok ? st2.value.pageCount : sum(st2), wm: cat(await getWm('s2')) });
      await call('s2 delete wm-1', () => api.deleteWatermark('s2', 'wm-1'));
      R.push({ name: 's2 wm after delete', wm: cat(await getWm('s2')) });
      await call('s2 save', () => api.save('s2'));
      await api.loadDocument('s3', savedPath);
      const st3 = await api.getState('s3');
      R.push({ name: 's3 reload pageCount', v: st3.ok ? st3.value.pageCount : sum(st3), wm: cat(await getWm('s3')) });
      // reloaded doc: add a new watermark -> id numbering
      await call('s3 add C', () => add('s3', { type: 'text', text: 'WM-THREE' }));
      R.push({ name: 's3 after add C', wm: cat(await getWm('s3')) });
    }

    if (group === 'race') {
      await api.loadDocument('race', formPath);
      await call('race add', () => add('race', { type: 'text', text: 'RACE' }));
      const saveP = api.saveAs('race');
      const delP = api.deleteWatermark('race', 'wm-1');
      const [saveR, delR] = await Promise.all([saveP, delP]);
      R.push({ name: 'race save', ...sum(saveR) });
      R.push({ name: 'race delete', ...sum(delR) });
      R.push({ name: 'race mem wm', wm: cat(await getWm('race')) });
      await api.loadDocument('racecheck', raceOut);
      R.push({ name: 'race disk wm', wm: cat(await getWm('racecheck')) });
    }

    return { R };
  }, {
    group: GROUP, formPath, reportPath, savedPath, raceOut, outDir: OUT_DIR.replace(/\\/g, '/'),
    png: PNG_1x1,
  });

  for (const row of res.R) logj('ROW', row);
  logj('DONE', { group: GROUP, rows: res.R.length });

  if (GROUP === 'saveReopen') {
    const savedFsPath = path.join(OUT_DIR, 'adv041 saved output.pdf');
    const exists = fs.existsSync(savedFsPath);
    logj('SAVED_FILE', { exists, bytes: exists ? fs.statSync(savedFsPath).size : 0 });
    if (exists) {
      const buf = fs.readFileSync(savedFsPath);
      const latin = buf.toString('latin1');
      logj('MARKER_OCCURRENCES', { count: (latin.match(/%TFLEX-WATERMARK/g) || []).length });
      logj('TEXT_RESIDUE', { WM_ONE: latin.includes('WM-ONE'), WM_TWO: latin.includes('WM-TWO') });
      try {
        const { PDFDocument } = require('pdf-lib');
        const doc = await PDFDocument.load(buf);
        logj('PDF_PARSE', { pages: doc.getPageCount() });
      } catch (e) { logj('PDF_PARSE_FAILED', { err: String(e.message).slice(0, 200) }); }
    }
  }

  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041 FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
