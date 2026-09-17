// ADV phase-18 gate - UI-level: range guard, 50-watermark applied list, double delete.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041UI ' + tag + ' ' + JSON.stringify(obj));
setTimeout(() => { console.log('ADV041UI HARD_TIMEOUT'); process.exit(3); }, 240000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => { errs.push(String(e && e.message ? e.message : e).slice(0, 200)); console.log('[PAGEERROR] ' + errs[errs.length - 1]); });
  win.on('console', (m) => { const t = m.text(); if (/error|Error|unhandled/.test(t)) console.log('[CONSOLE] ' + t.slice(0, 200)); });
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
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return d && d.pageCount > 1;
  }, { timeout: 30000 });
  logj('opened', await win.evaluate(() => ({ d: (({ pageCount, engineDocId, activeTool }) => ({ pageCount, engineDocId, activeTool }))(window.tflexDiagnostics()) })));

  const openWatermark = async () => {
    if (await win.$('[data-watermark-dialog]')) return;
    if (!(await win.$('[data-tool-id="watermark"]'))) {
      await win.click('[data-tools-badge]');
      await win.waitForSelector('[data-tool-id="watermark"]', { timeout: 10000 });
    }
    await win.click('[data-tool-id="watermark"]');
    await win.waitForSelector('[data-watermark-dialog]', { timeout: 10000 });
  };
  const closeWatermark = async () => {
    const c = await win.$('[data-watermark-dialog] .modal-close');
    if (c) await c.click();
    await sleep(200);
  };

  // Open the tools palette + watermark dialog
  await openWatermark();
  logj('dialog-open', { ok: true });

  // ---- (a) range guard ----
  await win.uncheck('[data-watermark-range-all]');
  await win.fill('[data-watermark-range-from]', '5');
  await win.fill('[data-watermark-range-to]', '2');
  await win.click('[data-watermark-confirm]');
  await sleep(250);
  const afterInverted = await win.evaluate(() => {
    const f = document.querySelector('[data-watermark-range-from]');
    const t = document.querySelector('[data-watermark-range-to]');
    const err = document.querySelector('[data-watermark-dialog] .optimize-error');
    const dlg = document.querySelector('[data-watermark-dialog]');
    return { from: f ? f.value : null, to: t ? t.value : null, error: err ? err.textContent : null, dialogStillOpen: !!dlg };
  });
  logj('range-inverted', afterInverted);
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-range-inverted.png') });

  // clear the From field, try to confirm
  await win.fill('[data-watermark-range-from]', '');
  await sleep(100);
  const afterClear = await win.evaluate(() => {
    const f = document.querySelector('[data-watermark-range-from]');
    const err = document.querySelector('[data-watermark-dialog] .optimize-error');
    return { from: f ? f.value : null, error: err ? err.textContent : null };
  });
  await win.click('[data-watermark-confirm]');
  await sleep(250);
  const afterClearConfirm = await win.evaluate(() => {
    const f = document.querySelector('[data-watermark-range-from]');
    const err = document.querySelector('[data-watermark-dialog] .optimize-error');
    return { from: f ? f.value : null, error: err ? err.textContent : null, dialogStillOpen: !!document.querySelector('[data-watermark-dialog]') };
  });
  logj('range-cleared-from', { afterClear, afterClearConfirm });
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-range-cleared.png') });

  // negative/zero from
  await win.fill('[data-watermark-range-from]', '-1');
  await win.fill('[data-watermark-range-to]', '2');
  await win.click('[data-watermark-confirm]');
  await sleep(200);
  logj('range-negative-from', await win.evaluate(() => {
    const f = document.querySelector('[data-watermark-range-from]');
    const err = document.querySelector('[data-watermark-dialog] .optimize-error');
    return { from: f ? f.value : null, error: err ? err.textContent : null };
  }));

  // restore all pages and close dialog
  await win.click('[data-watermark-range-all]').catch(() => {});
  await closeWatermark();

  // ---- (d) 50 watermarks in the applied list ----
  const applied = await win.evaluate(async () => {
    const api = window.tflex.engine;
    const docId = window.tflexDiagnostics().engineDocId;
    const t0 = performance.now();
    let fails = 0;
    for (let i = 0; i < 50; i++) {
      const r = await api.addWatermark(docId, { type: 'text', text: 'L' + i, size: 24 });
      if (!r.ok) fails++;
    }
    return { addMs: Math.round(performance.now() - t0), fails, docId };
  });
  logj('applied-50-engine', applied);

  await openWatermark();
  await sleep(400);
  const listInfo = await win.evaluate(() => {
    const rows = document.querySelectorAll('[data-watermark-applied]');
    const section = document.querySelector('.watermark-applied');
    const body = document.querySelector('[data-watermark-dialog] .modal-body');
    return {
      rows: rows.length,
      first: rows[0] ? rows[0].getAttribute('data-watermark-applied') : null,
      last: rows[rows.length - 1] ? rows[rows.length - 1].getAttribute('data-watermark-applied') : null,
      sectionH: section ? section.getBoundingClientRect().height : null,
      bodyScrollH: body ? body.scrollHeight : null,
      bodyClientH: body ? body.clientHeight : null,
      bodyOverflow: body ? getComputedStyle(body).overflowY : null,
    };
  });
  logj('applied-list-50', listInfo);
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-applied-50.png') });

  // ---- (e) double-click delete on the same id ----
  const beforeRows = (await win.evaluate(() => document.querySelectorAll('[data-watermark-applied]').length));
  await win.click('[data-watermark-delete="wm-1"]');
  await win.click('[data-watermark-delete="wm-1"]').catch((e) => logj('second-click', { err: String(e.message).slice(0, 120) }));
  await sleep(1200);
  const afterDelete = await win.evaluate(() => ({
    rows: document.querySelectorAll('[data-watermark-applied]').length,
    toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent),
    hasWm1: !!document.querySelector('[data-watermark-delete="wm-1"]'),
  }));
  logj('double-delete', { beforeRows, afterDelete });
  await win.screenshot({ path: path.join(SHOTS, 'adv-041-double-delete.png') });

  logj('pageerrors', errs);
  await app.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.log('ADV041UI FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
