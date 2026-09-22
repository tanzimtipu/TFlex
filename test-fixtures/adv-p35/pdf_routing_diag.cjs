// ADV phase-35 DIAGNOSTIC: why did some virtual-PDF saves route to the physical printer?
// webContents.print / printToPDF are STUBBED in main so nothing physical can print.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-route] ${s}`); lines.push(`[adv35-route] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-route-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Stub the print pipeline in main: record every call, never touch a device.
    await app.evaluate(({ BrowserWindow, dialog }) => {
      globalThis.__advPrint = [];
      const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
      proto.print = function (opts, cb) {
        globalThis.__advPrint.push({ kind: 'print', deviceName: opts && opts.deviceName, silent: opts && opts.silent, pagesPerSheet: opts && opts.pagesPerSheet, landscape: opts && opts.landscape });
        if (typeof cb === 'function') cb(true, '');
      };
      proto.printToPDF = async function (opts) {
        globalThis.__advPrint.push({ kind: 'printToPDF', landscape: opts && opts.landscape, preferCSSPageSize: opts && opts.preferCSSPageSize });
        return Buffer.from('%PDF-1.4\n%adv35\n%%EOF\n');
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
    const saveCalls = () => app.evaluate(() => globalThis.__advSave.calls);

    const readSel = () => win.evaluate(() => {
      const s = document.querySelector('[data-print-printer]');
      return s ? { value: s.value, text: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent.trim() : null } : null;
    });

    const openPrintDialog = async () => {
      await win.click('[data-print]');
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      await win.waitForFunction(() => {
        const sel = document.querySelector('[data-print-printer]');
        return sel && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      }, null, { timeout: 20000 });
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

    const cases = [
      ['dir', path.join(os.tmpdir(), `adv35-rdir-${Date.now()}`), '1-1'],
      ['removed-drive', 'Z:\\nope\\adv35-out.pdf', '1-1'],
      ['read-only', (() => { const p = path.join(os.tmpdir(), `adv35-rro-${Date.now()}.pdf`); fs.writeFileSync(p, 'x'); return p; })(), '1-1'],
      ['unicode', path.join(os.tmpdir(), `adv35-rünï-${Date.now()} 空`, 'out 文.pdf'), '1-2'],
      ['plain-temp', path.join(os.tmpdir(), `adv35-rplain-${Date.now()}.pdf`), '1-1'],
    ];

    for (const [name, dest, range] of cases) {
      if (name === 'dir' || name === 'unicode') fs.mkdirSync(path.dirname(dest), { recursive: true });
      await openPrintDialog();
      const selAfterOpen = await readSel();
      await win.click('[data-print-range-custom]');
      await win.fill('[data-print-range-input]', range);
      await win.waitForTimeout(700);
      const selBeforeConfirm = await readSel();
      await setSave('ok', dest);
      const callsBefore = await saveCalls();
      await win.click('[data-print-confirm]');
      await win.waitForTimeout(5000);
      const calls = await drainPrint();
      const state = await win.evaluate(() => ({
        error: (document.querySelector('[data-print-error]') || {}).textContent || null,
        success: (document.querySelector('[data-print-success]') || {}).textContent || null,
      }));
      note(`case=${name} dest=${dest}`);
      note(`  selAfterOpen=${JSON.stringify(selAfterOpen)} selBeforeConfirm=${JSON.stringify(selBeforeConfirm)} saveCalls=${(await saveCalls()) - callsBefore}`);
      note(`  printCalls=${JSON.stringify(calls)} state=${JSON.stringify(state)}`);
      await closeDialog();
    }

    fs.writeFileSync(path.join(OUT, 'routing_diag.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'routing_diag.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-route');
  }
})();
