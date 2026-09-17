// ADV phase-18 gate - isolate delete-button list refresh (single vs double click).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.argv[2] || 3);
const logj = (tag, obj) => console.log('ADV041DEL ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041DEL HARD_TIMEOUT'); process.exit(3); }, 200000).unref();

const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => ({ __timeout: label }))]);

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
  const readList = () => win.evaluate(() => ({
    ids: Array.from(document.querySelectorAll('[data-watermark-applied]')).map((r) => r.getAttribute('data-watermark-applied')),
    bodyScrollW: (() => { const b = document.querySelector('[data-watermark-dialog] .modal-body'); return b ? { sw: b.scrollWidth, cw: b.clientWidth } : null; })(),
  }));
  const addN = (n) => win.evaluate(async (count) => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    let fails = 0;
    for (let i = 0; i < count; i++) {
      const r = await api.addWatermark(docId, { type: 'text', text: 'D' + i, size: 24 });
      if (!r.ok) fails++;
    }
    return { fails };
  }, n);

  // --- single click delete
  await openWatermark();
  await addN(N);
  // reopen to refresh list (dialog is open, close + reopen)
  await win.click('[data-watermark-dialog] .modal-close');
  await sleep(300);
  await openWatermark();
  await sleep(500);
  logj('layout-before-single', await win.evaluate(() => {
    const b = document.querySelector('[data-watermark-dialog] .modal-body');
    const d = document.querySelector('[data-watermark-dialog]');
    const f = document.querySelector('[data-watermark-dialog] .modal-footer');
    const rows = document.querySelectorAll('[data-watermark-applied]');
    const r0 = rows[0] ? rows[0].getBoundingClientRect() : null;
    return {
      rows: rows.length,
      bodyScrollW: b ? b.scrollWidth : null, bodyClientW: b ? b.clientWidth : null,
      bodyScrollH: b ? b.scrollHeight : null, bodyClientH: b ? b.clientHeight : null,
      dialogRect: d ? { x: Math.round(d.getBoundingClientRect().x), y: Math.round(d.getBoundingClientRect().y), w: Math.round(d.getBoundingClientRect().width), h: Math.round(d.getBoundingClientRect().height) } : null,
      footerRect: f ? { y: Math.round(f.getBoundingClientRect().y), h: Math.round(f.getBoundingClientRect().height) } : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      firstRowW: r0 ? Math.round(r0.width) : null,
    };
  }));
  logj('before-single', await readList());
  const tDel = Date.now();
  await win.click('[data-watermark-delete="wm-1"]');
  const midRows = [];
  for (let i = 0; i < 6; i++) { await sleep(300); midRows.push((await readList()).ids.length); }
  logj('after-single-poll', { poll: midRows, totalMs: Date.now() - tDel });
  logj('after-single', await readList());
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-single-delete.png') });
  const resp1 = await withTimeout(win.evaluate(() => 1 + 1), 4000, 'single-post');
  logj('responsive-after-single', resp1);

  // --- double click delete (two clicks on the same still-present button)
  await win.click('[data-watermark-dialog] .modal-close').catch(() => {});
  await sleep(300);
  await openWatermark();
  await sleep(300);
  const idsBefore = (await readList()).ids;
  logj('before-double', { ids: idsBefore });
  if (idsBefore.length > 0) {
    const target = idsBefore[0];
    // click twice as fast as Playwright allows
    await win.click('[data-watermark-delete="' + target + '"]');
    const second = await withTimeout(win.click('[data-watermark-delete="' + target + '"]'), 4000, 'second-click');
    logj('second-click', second);
    await sleep(1500);
    logj('after-double', await readList());
    logj('toasts', await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent)));
    const resp2 = await withTimeout(win.evaluate(() => 2 + 2), 4000, 'double-post');
    logj('responsive-after-double', resp2);
    await win.screenshot({ path: path.join(SHOTS, 'adv-041-double-delete2.png') });
  }

  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041DEL FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
