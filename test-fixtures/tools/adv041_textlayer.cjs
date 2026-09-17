// ADV phase-18 gate - text-layer integrity + render check after apply and save/reopen.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const OUT_DIR = path.join(os.tmpdir(), 'tflex-adv041');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const saved = path.join(OUT_DIR, 'adv041 textlayer.pdf').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041TXT ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041TXT HARD_TIMEOUT'); process.exit(3); }, 180000).unref();

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

  const res = await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const join = (r) => (r.ok ? (Array.isArray(r.value) ? r.value.map((p) => p.text || '').join('\n') : JSON.stringify(r.value)) : 'ERR:' + (r.error && r.error.code));
    const tb = await api.exportText(docId);
    const beforeStr = join(tb);
    const r = await api.addWatermark(docId, { type: 'text', text: 'INTEGRITY-MARK', size: 48, opacity: 0.4, position: 'center' });
    const ta = await api.exportText(docId);
    const afterStr = join(ta);
    const occurrences = (s, sub) => s.split(sub).length - 1;
    return {
      addOk: r.ok, addErr: r.ok ? null : r.error.code + ':' + r.error.message,
      beforeLen: beforeStr.length, afterLen: afterStr.length,
      beforeTechnical: occurrences(beforeStr, 'Technical'), afterTechnical: occurrences(afterStr, 'Technical'),
      wmOccurrences: occurrences(afterStr, 'INTEGRITY-MARK'),
      beforeFirstChunkPreserved: beforeStr.length > 0 ? afterStr.includes(beforeStr.slice(0, 120)) : null,
      beforePages: tb.ok && Array.isArray(tb.value) ? tb.value.length : -1,
      afterPages: ta.ok && Array.isArray(ta.value) ? ta.value.length : -1,
    };
  });
  logj('exportText-integrity', res);
  await sleep(1500);
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-render-after-watermark.png') });

  // save + reopen, re-extract
  await app.evaluate((_e, o) => { globalThis.__advSave = o.val; }, { val: saved });
  const after = await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const sa = await api.saveAs(docId);
    if (!sa.ok) return { saveErr: sa.error.code + ':' + sa.error.message };
    const ld = await api.loadDocument('reopen', sa.value);
    if (!ld.ok) return { loadErr: ld.error.code + ':' + ld.error.message };
    const g = await api.getWatermarks('reopen');
    const t = await api.exportText('reopen');
    const s = t.ok && Array.isArray(t.value) ? t.value.map((p) => p.text || '').join('\n') : '';
    return { saved: sa.value, reloaded: ld.ok, wm: g.ok ? g.value.map((w) => [w.id, w.type, w.text, w.pages.length]) : 'err', reopenedLen: s.length, reopenedHasMark: s.includes('INTEGRITY-MARK'), reopenedTechnical: (s.match(/Technical/g) || []).length };
  });
  logj('save-reopen', after);
  const exists = fs.existsSync(saved);
  logj('file', { exists, bytes: exists ? fs.statSync(saved).size : 0 });

  await Promise.race([app.close(), sleep(5000)]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041TXT FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
