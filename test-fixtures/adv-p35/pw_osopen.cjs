// ADV phase-35: OS-open targeting while the standalone print window is open.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-target] ${s}`); lines.push(`[adv35-target] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-target-a.pdf'));
    await win.waitForTimeout(1500);
    const docIdA = await win.evaluate(() => window.tflexDiagnostics().engineDocId);

    const p = app.waitForEvent('window');
    await win.evaluate((c) => window.tflex.printWindow.open(c), { docId: docIdA, documentName: 'adv35-target-a.pdf', pageCount: 34, settings: {} });
    const pw = await p;
    await pw.waitForSelector('[data-print-window]', { timeout: 25000 });
    await pw.waitForTimeout(1500);

    const windowsBefore = await app.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      return {
        order: BrowserWindow.getAllWindows().map((w, i) => ({ i, id: w.id, url: w.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN' })),
        index0: BrowserWindow.getAllWindows()[0] ? (BrowserWindow.getAllWindows()[0].webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN') : null,
        focused: focused ? (focused.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN') : null,
      };
    });
    note(`windows before=${JSON.stringify(windowsBefore)}`);

    const pathB = C.tmpCopy(C.LONG, 'adv35-target-b.pdf');
    await app.evaluate(({ app: a }, av) => { a.emit('second-instance', {}, av); }, [process.execPath, '.', pathB]);
    await win.waitForTimeout(4000);

    const mainState = await win.evaluate(() => ({
      tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()),
      activeDocName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
    }));
    const printState = await pw.evaluate(() => ({ docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null })).catch((e) => ({ err: e.message }));
    const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w, i) => ({ i, id: w.id, url: w.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN' })));
    note(`after second-instance: mainTabs=${JSON.stringify(mainState.tabs)} printWindowDoc=${JSON.stringify(printState)} windows=${JSON.stringify(windowsAfter)}`);

    // Directly push an openPathRequest to the PRINT window (simulating a mis-target): the print
    // window's preload has onOpenPathRequest but PrintWindowApp never subscribes -> silently ignored?
    const beforeMis = await pw.evaluate(() => ({ docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null }));
    await app.evaluate(({ BrowserWindow }, pth) => {
      const printWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
      if (printWin) printWin.webContents.send('app:openPathRequest', pth);
    }, pathB);
    await pw.waitForTimeout(2500);
    const afterMis = await pw.evaluate(() => ({ docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null, tabs: document.querySelectorAll('.tab[data-tab-id]').length }));
    const mainAfterMis = await win.evaluate(() => ({ tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()) }));
    note(`mis-target push to print window: before=${JSON.stringify(beforeMis)} after=${JSON.stringify(afterMis)} mainTabs=${JSON.stringify(mainAfterMis.tabs)}`);

    fs.writeFileSync(path.join(OUT, 'target.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'target.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-target');
  }
})();
