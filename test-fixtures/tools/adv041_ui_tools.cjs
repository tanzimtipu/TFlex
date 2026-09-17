// ADV phase-18 gate - UI tools: arming interactions, tab race, tile-size crash, control sweep.
// Usage: node adv041_ui_tools.cjs <part>   part = arm | tabs | crash | sweep
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
const PART = process.argv[2] || 'arm';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logj = (tag, obj) => console.log('ADV041TOOL ' + tag + ' ' + JSON.stringify(obj));
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => ({ __timeout: label }))]);
setTimeout(() => { console.log('ADV041TOOL HARD_TIMEOUT part=' + PART); process.exit(3); }, 180000).unref();

(async () => {
  const app = await launchApp([], undefined);
  const win = await app.firstWindow();
  const pageClosed = { v: false };
  win.on('close', () => { pageClosed.v = true; console.log('[PAGECLOSED]'); });
  win.on('pageerror', (e) => console.log('[PAGEERROR] ' + String(e && e.message ? e.message : e).slice(0, 200)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const report = getSamplePath('report.pdf');
  const form = getSamplePath('form.pdf');
  await app.evaluate(async ({ dialog }) => {
    globalThis.__advOpen = null;
    globalThis.__advSave = null;
    dialog.showOpenDialog = async () => {
      const p = globalThis.__advOpen;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });
  const setOpen = (p) => app.evaluate((_e, o) => { globalThis.__advOpen = o.val; }, { val: p });

  const openDoc = async (p) => {
    await setOpen(p);
    await win.locator('.btn-primary', { hasText: 'Open' }).first().click();
    await sleep(1500);
  };
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
  const diag = () => win.evaluate(() => {
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : {};
    const hl = document.querySelector('[data-tool="highlight"]');
    return { activeTool: d.activeTool, highlightPressed: hl ? hl.getAttribute('aria-pressed') : null, tabs: d.openTabs, engineDocId: d.engineDocId, modified: d.modified };
  });

  await openDoc(report);

  if (PART === 'arm') {
    await win.click('[data-tool="highlight"]');
    await sleep(200);
    logj('armed', await diag());
    await openWatermark();
    logj('dialog-open-with-highlight', await diag());
    await win.click('[data-watermark-dialog] .modal-close');
    await sleep(400);
    logj('after-close', await diag());
  }

  if (PART === 'tabs') {
    // open a second doc in a new tab
    await openDoc(form);
    logj('two-tabs', await diag());
    // tab1 = report (first), tab2 = form (second)
    const tabIds = await win.evaluate(() => Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => t.getAttribute('data-tab-id')));
    logj('tabIds', tabIds);
    // switch to tab1 and open watermark with a slow-ish tile apply
    await win.click('[data-tab-id="' + tabIds[0] + '"]');
    await sleep(400);
    await openWatermark();
    await win.fill('[data-watermark-size]', '4');
    await win.check('[data-watermark-tile]');
    await win.click('[data-watermark-confirm]');
    // immediately switch tabs (mid-apply)
    await win.click('[data-tab-id="' + tabIds[1] + '"]').catch((e) => logj('switch-err', { e: String(e.message).slice(0, 120) }));
    await sleep(6000);
    logj('after-switch', await diag());
    const resp = await withTimeout(win.evaluate(() => 3 + 3), 5000, 'post-switch');
    logj('responsive', resp);
    // now close the tab mid-apply
    await win.click('[data-tab-id="' + tabIds[0] + '"]');
    await sleep(400);
    await openWatermark();
    await win.fill('[data-watermark-size]', '4');
    await win.check('[data-watermark-tile]');
    await win.click('[data-watermark-confirm]');
    await win.click('[data-tab-id="' + tabIds[0] + '"] .tab-close').catch((e) => logj('close-err', { e: String(e.message).slice(0, 120) }));
    await sleep(6000);
    logj('after-close-midapply', await diag());
    const resp2 = await withTimeout(win.evaluate(() => 4 + 4), 5000, 'post-close');
    logj('responsive2', resp2);
  }

  if (PART === 'crash') {
    await openWatermark();
    await win.fill('[data-watermark-size]', '0.25');
    await win.check('[data-watermark-tile]');
    await sleep(200);
    logj('pre-apply', await win.evaluate(() => ({
      size: document.querySelector('[data-watermark-size]') ? document.querySelector('[data-watermark-size]').value : null,
      tile: document.querySelector('[data-watermark-tile]') ? document.querySelector('[data-watermark-tile]').checked : null,
      preview: document.querySelector('[data-watermark-preview]') ? document.querySelector('[data-watermark-preview]').getAttribute('data-watermark-preview') : null,
    })));
    await win.screenshot({ path: path.join(SHOTS, 'adv-041-tile-size-025-before-apply.png') });
    await win.click('[data-watermark-confirm]');
    for (let i = 1; i <= 30; i++) {
      await sleep(2000);
      const r = await withTimeout(win.evaluate(() => ({ t: performance.now() })), 3000, 'poll' + i);
      logj('poll', { i, sec: i * 2, pageClosed: pageClosed.v, r });
      if (r && r.__timeout) break;
      if (pageClosed.v) break;
    }
  }

  if (PART === 'sweep') {
    await openWatermark();
    const snap = () => win.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const val = (s) => { const e = q(s); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
      return {
        preview: q('[data-watermark-preview]') ? q('[data-watermark-preview]').getAttribute('data-watermark-preview') : null,
        typeText: val('[data-watermark-type="text"]'),
        typeImage: val('[data-watermark-type="image"]'),
        text: val('[data-watermark-text]'),
        font: val('[data-watermark-font]'),
        size: val('[data-watermark-size]'),
        bold: val('[data-watermark-bold]'),
        italic: val('[data-watermark-italic]'),
        underline: val('[data-watermark-underline]'),
        opacity: val('[data-watermark-opacity]'),
        posCenter: q('[data-watermark-position="center"]') ? q('[data-watermark-position="center"]').getAttribute('aria-pressed') : null,
        tile: val('[data-watermark-tile]'),
        rangeAll: val('[data-watermark-range-all]'),
        rangeFrom: val('[data-watermark-range-from]'),
        rangeTo: val('[data-watermark-range-to]'),
        fromDisabled: q('[data-watermark-range-from]') ? q('[data-watermark-range-from]').disabled : null,
        imagePick: !!q('[data-watermark-image-pick]'),
        appliedRows: document.querySelectorAll('[data-watermark-applied]').length,
      };
    });
    logj('sweep-baseline', await snap());
    const steps = [];
    const step = async (name, fn) => { await fn(); await sleep(150); steps.push({ name, s: await snap() }); };
    await step('click top-left position', () => win.click('[data-watermark-position="top-left"]'));
    await step('click bold', () => win.check('[data-watermark-bold]'));
    await step('click italic', () => win.check('[data-watermark-italic]'));
    await step('click underline', () => win.check('[data-watermark-underline]'));
    await step('select Times', () => win.selectOption('[data-watermark-font]', 'Times'));
    await step('set size 72', () => win.fill('[data-watermark-size]', '72'));
    await step('set text', () => win.fill('[data-watermark-text]', 'HELLO'));
    await step('toggle tile', () => win.check('[data-watermark-tile]'));
    await step('uncheck range all', () => win.uncheck('[data-watermark-range-all]'));
    await step('type image', () => win.check('[data-watermark-type="image"]'));
    await step('type text', () => win.check('[data-watermark-type="text"]'));
    await step('confirm empty text', async () => { await win.fill('[data-watermark-text]', ''); await win.click('[data-watermark-confirm]'); });
    steps.push({ name: 'after-confirm-empty', s: await snap(), error: await win.evaluate(() => { const e = document.querySelector('[data-watermark-dialog] .optimize-error'); return e ? e.textContent : null; }) });
    for (const st of steps) logj('sweep', st);
  }

  logj('final', { part: PART, pageClosed: pageClosed.v });
  await Promise.race([app.close(), sleep(5000)]);
  process.exit(0);
})().catch((e) => {
  console.log('ADV041TOOL FATAL ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
  process.exit(1);
});
