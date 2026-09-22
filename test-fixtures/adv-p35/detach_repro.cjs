// ADV phase-35: ADV-076 repro via the REAL detach button (UI-driven), not a direct IPC call.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-detach] ${s}`); lines.push(`[adv35-detach] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-detach-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Open the standalone print window through the REAL detach control.
    await win.click('[data-print]');
    await win.waitForSelector('[data-print-detach]', { state: 'visible', timeout: 15000 });
    const pagePromise = app.waitForEvent('window');
    await win.click('[data-print-detach]');
    const pw = await pagePromise;
    await pw.waitForSelector('[data-print-window]', { timeout: 30000 });
    await pw.waitForTimeout(1200);

    const order = await app.evaluate(({ BrowserWindow }) => ({
      order: BrowserWindow.getAllWindows().map((w, i) => ({ i, id: w.id, kind: w.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN' })),
      focused: (() => { const f = BrowserWindow.getFocusedWindow(); return f ? (f.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN') : null; })(),
    }));
    note(`after REAL detach button: ${JSON.stringify(order)}`);

    const pathB = C.tmpCopy(C.LONG, 'adv35-detach-b.pdf');
    await app.evaluate(({ app: a }, av) => { a.emit('second-instance', {}, av); }, [process.execPath, '.', pathB]);
    await win.waitForTimeout(4500);
    const mainTabs = await win.evaluate(() => [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()));
    note(`after second-instance with ${path.basename(pathB)}: mainTabs=${JSON.stringify(mainTabs)} openedB=${mainTabs.some((t) => t.includes('adv35-detach-b'))}`);

    fs.writeFileSync(path.join(OUT, 'detach_repro.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'detach_repro.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-detach');
  }
})();
