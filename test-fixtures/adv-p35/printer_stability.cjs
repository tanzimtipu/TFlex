// ADV phase-35: is the in-app print dialog's printer selection stable across option changes?
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-stab] ${s}`); lines.push(`[adv35-stab] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-stab-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Instrument getPrintersAsync call count in main.
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      globalThis.__advGetPrinters = 0;
      const orig = wc.getPrintersAsync.bind(wc);
      wc.getPrintersAsync = (...a) => { globalThis.__advGetPrinters += 1; return orig(...a); };
    });
    const getCount = () => app.evaluate(() => globalThis.__advGetPrinters);

    await win.click('[data-print]');
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await win.waitForFunction(() => {
      const sel = document.querySelector('[data-print-printer]');
      return sel && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
    }, null, { timeout: 20000 });
    await win.waitForTimeout(800);
    const opts = await win.$$eval('[data-print-printer] option', (o) => o.map((x) => ({ t: x.textContent.trim(), v: x.value })));
    const pdf = opts.find((o) => /pdf/i.test(o.t) || /pdf/i.test(o.v));
    note(`options=${JSON.stringify(opts)} pdf=${JSON.stringify(pdf)} getPrintersCalls=${await getCount()}`);

    const readSel = () => win.evaluate(() => {
      const s = document.querySelector('[data-print-printer]');
      return s ? { value: s.value, selectedText: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent.trim() : null } : null;
    });

    note(`before select=${JSON.stringify(await readSel())}`);
    await win.selectOption('[data-print-printer]', pdf.v);
    await win.waitForTimeout(1200);
    note(`after select=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    // Change unrelated options one at a time and re-read the selection.
    await win.locator('[data-print-orientation-landscape]').check();
    await win.waitForTimeout(1000);
    note(`after landscape=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-3');
    await win.waitForTimeout(1200);
    note(`after range=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    await win.locator('[data-print-nup]').selectOption('2');
    await win.waitForTimeout(1000);
    note(`after nup=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    await win.locator('[data-print-odd-even]').selectOption('odd');
    await win.waitForTimeout(1000);
    note(`after odd=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    await win.locator('[data-print-copies]').fill('3');
    await win.waitForTimeout(1000);
    note(`after copies=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    await win.locator('[data-print-annotations]').uncheck();
    await win.waitForTimeout(1000);
    note(`after annotations=${JSON.stringify(await readSel())} getPrintersCalls=${await getCount()}`);

    // Also read the state right before confirm and confirm the outcome.
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    const beforeConfirm = await readSel();
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(4000);
    const state = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
    }));
    note(`beforeConfirm=${JSON.stringify(beforeConfirm)} confirmState=${JSON.stringify(state)}`);

    fs.writeFileSync(path.join(OUT, 'printer_stability.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'printer_stability.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-stab');
  }
})();
