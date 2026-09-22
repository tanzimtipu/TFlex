// ADV phase-35 DIAGNOSTIC 2: reproduce pdf_out.cjs sequence with ONLY the physical
// print stubbed (printToPDF left real). Logs the selected printer before each confirm.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-route2] ${s}`); lines.push(`[adv35-route2] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-route2-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    await app.evaluate(({ BrowserWindow, dialog }) => {
      globalThis.__advPrint = [];
      const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
      proto.print = function (opts, cb) {
        globalThis.__advPrint.push({ kind: 'print', deviceName: opts && opts.deviceName, silent: opts && opts.silent });
        if (typeof cb === 'function') cb(true, '');
      };
      globalThis.__advSave = { calls: 0, mode: 'ok', lastPath: null };
      dialog.showSaveDialog = async () => {
        globalThis.__advSave.calls += 1;
        if (globalThis.__advSave.mode === 'cancel') return { canceled: true };
        return { canceled: false, filePath: globalThis.__advSave.lastPath };
      };
    });
    const setSave = (mode, p) => app.evaluate(({ }, a) => { globalThis.__advSave.mode = a.mode; globalThis.__advSave.lastPath = a.p; }, { mode, p });
    const drainPrint = () => app.evaluate(() => { const x = globalThis.__advPrint.slice(); globalThis.__advPrint.length = 0; return x; });
    const readSel = () => win.evaluate(() => { const s = document.querySelector('[data-print-printer]'); return s ? { value: s.value } : null; });

    const openPrintDialog = async () => {
      await win.click('[data-print]');
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      await win.waitForFunction(() => { const sel = document.querySelector('[data-print-printer]'); return sel && [...sel.querySelectorAll('option')].some((o) => o.value !== ''); }, null, { timeout: 20000 });
      const opts = await win.$$eval('[data-print-printer] option', (o) => o.map((x) => ({ t: x.textContent.trim(), v: x.value })));
      const pdf = opts.find((o) => /pdf/i.test(o.t) || /pdf/i.test(o.v));
      await win.selectOption('[data-print-printer]', pdf.v);
      await win.waitForTimeout(400);
      return pdf;
    };
    const closeDialog = async () => {
      if ((await win.locator('.modal-backdrop').count()) > 0) {
        await win.locator('[data-print-cancel]').click({ timeout: 5000 }).catch(() => {});
        await win.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 8000 }).catch(() => {});
      }
      await win.waitForTimeout(400);
    };
    const runCase = async (name, dest, range, opts = {}) => {
      if (dest && (name === 'dir' || name === 'unicode')) fs.mkdirSync(path.dirname(dest), { recursive: true });
      await openPrintDialog();
      await win.click('[data-print-range-custom]');
      await win.fill('[data-print-range-input]', range);
      if (opts.landscape) await win.locator('[data-print-orientation-landscape]').check();
      if (opts.nup) await win.locator('[data-print-nup]').selectOption(opts.nup);
      await win.waitForTimeout(700);
      const selBefore = await readSel();
      await setSave('ok', dest);
      await win.click('[data-print-confirm]');
      await win.waitForTimeout(opts.wait || 7000);
      const calls = await drainPrint();
      const state = await win.evaluate(() => ({ error: (document.querySelector('[data-print-error]') || {}).textContent || null, success: (document.querySelector('[data-print-success]') || {}).textContent || null }));
      note(`case=${name} selBefore=${JSON.stringify(selBefore)} printCalls=${JSON.stringify(calls)} state=${JSON.stringify(state)}`);
      await closeDialog();
    };

    await runCase('1up', path.join(os.tmpdir(), `adv35-r2-1up-${Date.now()}.pdf`), '1-5');
    await runCase('2up', path.join(os.tmpdir(), `adv35-r2-2up-${Date.now()}.pdf`), '1-6', { landscape: true, nup: '2' });
    await runCase('overwrite', (() => { const p = path.join(os.tmpdir(), `adv35-r2-ov-${Date.now()}.pdf`); fs.writeFileSync(p, 'ORIG'); return p; })(), '1-1');
    await runCase('dir', path.join(os.tmpdir(), `adv35-r2-dir-${Date.now()}`), '1-1');
    await runCase('removed-drive', 'Z:\\nope\\adv35-out.pdf', '1-1');
    await runCase('read-only', (() => { const p = path.join(os.tmpdir(), `adv35-r2-ro-${Date.now()}.pdf`); fs.writeFileSync(p, 'x'); try { fs.chmodSync(p, 0o444); } catch (_) {} return p; })(), '1-1');
    await runCase('unicode', path.join(os.tmpdir(), `adv35-r2-ünï-${Date.now()} 空`, 'out 文.pdf'), '1-2');

    fs.writeFileSync(path.join(OUT, 'routing_real.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'routing_real.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-route2');
  }
})();
