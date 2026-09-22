// ADV phase-35: pin the printer-selection revert race with a timeline.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-race] ${s}`); lines.push(`[adv35-race] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-race-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__advGetPrinters = 0;
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const orig = wc.getPrintersAsync.bind(wc);
      wc.getPrintersAsync = (...a) => { globalThis.__advGetPrinters += 1; return orig(...a); };
    });
    const getCount = () => app.evaluate(() => globalThis.__advGetPrinters);
    const readSel = () => win.evaluate(() => { const s = document.querySelector('[data-print-printer]'); return s ? s.value : null; });

    const timeline = async (label, selectPdf) => {
      await win.click('[data-print]');
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      const t0 = Date.now();
      // Wait until options exist (stale list counts), then immediately select PDF.
      await win.waitForFunction(() => { const s = document.querySelector('[data-print-printer]'); return s && [...s.querySelectorAll('option')].some((o) => o.value !== ''); }, null, { timeout: 20000 });
      const optsAt = Date.now() - t0;
      if (selectPdf) {
        await win.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
      }
      const seq = [];
      let last = null;
      for (let i = 0; i < 60; i += 1) {
        const v = await readSel();
        const g = await getCount();
        const cur = `${v}|${g}`;
        if (cur !== last) { seq.push({ t: Date.now() - t0, value: v, getPrinters: g }); last = cur; }
        await win.waitForTimeout(100);
      }
      note(`${label}: optionsAtMs=${optsAt} timeline=${JSON.stringify(seq)}`);
      // close
      if ((await win.locator('.modal-backdrop').count()) > 0) {
        await win.locator('[data-print-cancel]').click({ timeout: 5000 }).catch(() => {});
        await win.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 8000 }).catch(() => {});
      }
      await win.waitForTimeout(400);
    };

    await timeline('first-open-select-pdf', true);
    await timeline('second-open-select-pdf', true);
    await timeline('third-open-select-pdf', true);
    await timeline('fourth-open-no-select', false);

    // ---- standalone print window: does it share the race? ----
    const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    const p = app.waitForEvent('window');
    await win.evaluate((c) => window.tflex.printWindow.open(c), { docId, documentName: 'adv35-race-a.pdf', pageCount: 34, settings: {} });
    const pw = await p;
    await pw.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 25000 });
    const t1 = Date.now();
    await pw.waitForFunction(() => { const s = document.querySelector('[data-print-printer]'); return s && [...s.querySelectorAll('option')].some((o) => o.value !== ''); }, null, { timeout: 20000 });
    await pw.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    const seq2 = [];
    let last2 = null;
    for (let i = 0; i < 50; i += 1) {
      const v = await pw.evaluate(() => { const s = document.querySelector('[data-print-printer]'); return s ? s.value : null; });
      if (v !== last2) { seq2.push({ t: Date.now() - t1, value: v }); last2 = v; }
      await pw.waitForTimeout(100);
    }
    note(`standalone-window: timeline=${JSON.stringify(seq2)}`);

    fs.writeFileSync(path.join(OUT, 'race.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'race.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-race');
  }
})();
