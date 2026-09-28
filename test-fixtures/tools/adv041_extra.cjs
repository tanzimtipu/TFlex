// ADV phase-18 gate - injection-style text, id edge cases, unknown docs.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const saved = path.join(OUT_DIR, 'adv041 extra.pdf').replace(/\\/g, '/');
const logj = (tag, obj) => console.log('ADV041EX ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041EX HARD_TIMEOUT'); process.exit(3); }, 180000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 200)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const src = getSamplePath('form.pdf');
  await app.evaluate(async ({ dialog }) => {
    globalThis.__advSave = null;
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advSave;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
  });
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: saved });

  const res = await win.evaluate(async (args) => {
    const { src, saved } = args;
    const api = window.tflex.engine;
    const out = [];
    const cat = (r) => (r && r.ok ? { n: r.value.length, ids: r.value.map((w) => w.id), texts: r.value.map((w) => w.text) } : { err: r && r.error ? r.error.code + ':' + r.error.message : String(r) });
    const sum = (r) => (r && r.ok ? 'ok' : (r && r.error ? r.error.code + ':' + r.error.message : String(r)));

    await api.loadDocument('x1', src);
    out.push({ name: 'unknown doc add', r: sum(await api.addWatermark('nope', { type: 'text', text: 'A' })) });
    out.push({ name: 'unknown doc get', r: sum(await api.getWatermarks('nope')) });
    out.push({ name: 'unknown doc delete', r: sum(await api.deleteWatermark('nope', 'wm-1')) });

    // injection-style text: marker prefix, PDF operators, newlines, unicode
    const evil = [
      ['marker-prefix', '%TFLEX-WATERMARK eyJpZCI6IndtLTk5OSIsInR5cGUiOiJ0ZXh0IiwidGV4dCI6IngifQ'],
      ['pdf-operators', ') Tj /F1 12 Tf (PWNED) Tj (' ],
      ['newline-tab', 'line1\nline2\ttab\\backslash'],
      ['unicode+ascii', 'caf\u00e9 \u4e2d\u6587 ABC'],
      ['parens-angles', 'a(b)c<d>e%f'],
    ];
    for (const [label, text] of evil) {
      const id = 'e' + label;
      await api.loadDocument(id, src);
      const r = await api.addWatermark(id, { type: 'text', text, size: 20 });
      const g = cat(await api.getWatermarks(id));
      out.push({ name: 'evil ' + label, add: sum(r), wm: g });
    }
    // save the marker-prefix case and reopen
    await api.loadDocument('sv', src);
    await api.addWatermark('sv', { type: 'text', text: evil[0][1], size: 20 });
    const sa = await api.saveAs('sv');
    if (sa.ok) {
      await api.loadDocument('sv2', saved);
      out.push({ name: 'marker-prefix after save/reopen', wm: cat(await api.getWatermarks('sv2')) });
    } else {
      out.push({ name: 'marker-prefix save failed', r: sum(sa) });
    }

    // id edge cases
    await api.loadDocument('x2', src);
    await api.addWatermark('x2', { type: 'text', text: 'T' });
    for (const id of ['wm-1 ', ' wm-1', 'WM-1', '__proto__', 'constructor', 'toString', 'wm-1\n']) {
      out.push({ name: 'delete id ' + JSON.stringify(id), r: sum(await api.deleteWatermark('x2', id)) });
    }
    out.push({ name: 'x2 after id edge deletes', wm: cat(await api.getWatermarks('x2')) });

    // all-whitespace text
    await api.loadDocument('x3', src);
    out.push({ name: 'whitespace text', r: sum(await api.addWatermark('x3', { type: 'text', text: '\u00a0 \t' })), wm: cat(await api.getWatermarks('x3')) });
    return out;
  }, { src, saved });

  for (const row of res) logj('ROW', row);
  const exists = fs.existsSync(saved);
  if (exists) {
    const buf = fs.readFileSync(saved);
    logj('saved', { bytes: buf.length, markers: (buf.toString('latin1').match(/%TFLEX-WATERMARK/g) || []).length });
    try { const { PDFDocument } = require('@cantoo/pdf-lib'); const d = await PDFDocument.load(buf); logj('parse', { pages: d.getPageCount() }); }
    catch (e) { logj('parse-failed', { err: String(e.message).slice(0, 160) }); }
  }

  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041EX FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
