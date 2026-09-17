// ADV phase-18 gate - quantify the applied-list layout with many watermarks.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041LAY ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041LAY HARD_TIMEOUT'); process.exit(3); }, 180000).unref();

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
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });
  await app.evaluate((_e, o) => { globalThis.__advOpen = o.val; }, { val: src });
  await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
  await win.waitForFunction(() => window.tflexDiagnostics && window.tflexDiagnostics().pageCount > 1, { timeout: 30000 });
  await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    for (let i = 0; i < 50; i++) await api.addWatermark(docId, { type: 'text', text: 'L' + i, size: 24 });
  });
  await win.click('[data-tools-badge]');
  await win.waitForSelector('[data-tool-id="watermark"]', { timeout: 10000 });
  await win.click('[data-tool-id="watermark"]');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
  await sleep(600);

  const measure = async (label) => logj(label, await win.evaluate(() => {
    const bd = document.querySelector('[data-watermark-dialog]');
    const dlg = document.querySelector('[data-watermark-dialog] .modal-dialog');
    const body = document.querySelector('[data-watermark-dialog] .modal-body');
    const footer = document.querySelector('[data-watermark-dialog] .modal-footer');
    const r = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      backdrop: r(bd), dialog: r(dlg), body: r(body), footer: r(footer),
      bodyScroll: body ? { sw: body.scrollWidth, cw: body.clientWidth, sh: body.scrollHeight, ch: body.clientHeight, oy: getComputedStyle(body).overflowY, ox: getComputedStyle(body).overflowX } : null,
      dialogScroll: dlg ? { sw: dlg.scrollWidth, cw: dlg.clientWidth, sh: dlg.scrollHeight, ch: dlg.clientHeight, oy: getComputedStyle(dlg).overflowY } : null,
      backdropScroll: bd ? { sw: bd.scrollWidth, cw: bd.clientWidth, sh: bd.scrollHeight, ch: bd.clientHeight, oy: getComputedStyle(bd).overflowY, ox: getComputedStyle(bd).overflowX } : null,
      docScroll: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    };
  }));

  await measure('layout-initial');
  // try to scroll the backdrop to the bottom; is the footer reachable?
  await win.evaluate(() => { const bd = document.querySelector('[data-watermark-dialog]'); if (bd) bd.scrollTop = bd.scrollHeight; const dlg = document.querySelector('[data-watermark-dialog] .modal-dialog'); if (dlg) dlg.scrollTop = dlg.scrollHeight; });
  await sleep(300);
  await measure('layout-scrolled-bottom');
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-applied-50-bottom.png') });

  await Promise.race([app.close(), sleep(5000)]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041LAY FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
