// ADV phase-35: hostile print-window context matrix + lifecycle.
// Drives the REAL main handler (window.tflex.printWindow.open -> IPC -> openPrintWindow).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-pw] ${s}`); lines.push(`[adv35-pw] ${s}`); };

const printWindows = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()
    .filter((w) => w.webContents.getURL().includes('tfWindow=print'))
    .map((w) => ({ id: w.id, url: w.webContents.getURL().slice(0, 120), title: w.getTitle() })));

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);

    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-pw-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);
    const diag = await win.evaluate(() => window.tflexDiagnostics());
    const docId = diag.engineDocId;
    note(`active engineDocId=${docId} pageCount=${diag.pageCount}`);

    const open = (ctx) => win.evaluate((c) => window.tflex.printWindow.open(c), ctx);
    const closeAllPrint = async () => {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => {
          if (w.webContents.getURL().includes('tfWindow=print')) w.destroy();
        });
      });
      await win.waitForTimeout(500);
    };

    const hostile = [
      ['null', null],
      ['array', []],
      ['string', 'x'],
      ['empty-object', {}],
      ['missing-docId', { documentName: 'n', pageCount: 1, settings: {} }],
      ['blank-docId', { docId: '   ', documentName: 'n', pageCount: 1, settings: {} }],
      ['numeric-docId', { docId: 123, documentName: 'n', pageCount: 1, settings: {} }],
      ['missing-name', { docId: 'd', pageCount: 1, settings: {} }],
      ['negative-pages', { docId: 'd', documentName: 'n', pageCount: -1, settings: {} }],
      ['billion-pages', { docId: 'd', documentName: 'n', pageCount: 1000000000, settings: {} }],
      ['over-cap', { docId: 'd', documentName: 'n', pageCount: 50001, settings: {} }],
      ['fraction-pages', { docId: 'd', documentName: 'n', pageCount: 3.5, settings: {} }],
      ['nan-pages', { docId: 'd', documentName: 'n', pageCount: NaN, settings: {} }],
      ['inf-pages', { docId: 'd', documentName: 'n', pageCount: Infinity, settings: {} }],
      ['string-pages', { docId: 'd', documentName: 'n', pageCount: '3', settings: {} }],
      ['null-settings', { docId: 'd', documentName: 'n', pageCount: 1, settings: null }],
      ['array-settings', { docId: 'd', documentName: 'n', pageCount: 1, settings: [] }],
      ['string-settings', { docId: 'd', documentName: 'n', pageCount: 1, settings: 'x' }],
      ['zero-pages', { docId: 'd', documentName: 'n', pageCount: 0, settings: {} }],
      ['hostile-settings', {
        docId: 'nonexistent-doc-hostile', documentName: 'hostile.pdf', pageCount: 7,
        settings: { deviceName: 123, copies: -5, pagesPerSheet: 3, scaling: 'nope', landscape: 'yes', pageRanges: 'no', orientation: 'weird' },
      }],
      ['ghost-doc', { docId: 'ghost-doc-never-opened', documentName: 'ghost.pdf', pageCount: 2, settings: {} }],
      ['huge-name', { docId: 'ghost-huge', documentName: 'A'.repeat(200000), pageCount: 1, settings: {} }],
      ['nested-settings', { docId: 'ghost-nested', documentName: 'n.pdf', pageCount: 1, settings: { a: { b: [1, 2, 3] } } }],
    ];

    const results = [];
    for (const [name, ctx] of hostile) {
      let res;
      try {
        res = await open(ctx);
      } catch (e) {
        res = { threw: e.message };
      }
      await win.waitForTimeout(400);
      const wins = await printWindows(app);
      results.push({ name, res, printWindowCount: wins.length });
      note(`ctx=${name} result=${JSON.stringify(res)} printWindows=${wins.length}`);
      if (wins.length > 0) await closeAllPrint();
    }

    // ---- lifecycle: 20 repeated opens of the SAME valid context ----
    const valid = { docId, documentName: 'adv35-pw-a.pdf', pageCount: 34, settings: {} };
    const created = [];
    let maxWindows = 0;
    for (let i = 0; i < 20; i += 1) {
      const res = await open(valid);
      created.push(res);
      const wins = await printWindows(app);
      maxWindows = Math.max(maxWindows, wins.length);
      await win.waitForTimeout(80);
    }
    note(`20x same-doc opens: first=${JSON.stringify(created[0])} rest=${JSON.stringify(created.slice(1, 4))} distinctCreated=${new Set(created.map((c) => c.created)).size} maxPrintWindows=${maxWindows}`);

    // ---- lifecycle: doc change reloads ----
    const before = await printWindows(app);
    const resB = await open({ ...valid, docId: 'a-different-doc-id', documentName: 'b.pdf' });
    await win.waitForTimeout(800);
    const after = await printWindows(app);
    note(`doc-change: before=${JSON.stringify(before)} res=${JSON.stringify(resB)} after=${JSON.stringify(after)}`);

    // ---- lifecycle: resize min + absurd ----
    const sized = await app.evaluate(({ BrowserWindow }) => {
      const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
      if (!pw) return null;
      pw.setBounds({ x: 50, y: 50, width: 1, height: 1 });
      const min = pw.getBounds();
      pw.setBounds({ x: 50, y: 50, width: 100000, height: 100000 });
      const huge = pw.getBounds();
      pw.setBounds({ x: 50, y: 50, width: 820, height: 860 });
      return { min, huge, minSize: pw.getMinimumSize(), resizable: pw.isResizable(), maximizable: pw.isMaximizable(), minimizable: pw.isMinimizable() };
    });
    note(`resize: ${JSON.stringify(sized)}`);

    // ---- lifecycle: close leaves app usable ----
    await closeAllPrint();
    const usable = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    const afterClose = await printWindows(app);
    note(`after close: printWindows=${afterClose.length} appTabs=${usable}`);

    fs.writeFileSync(path.join(OUT, 'pw_context.log'), lines.join('\n'));
    note(`DONE; matrix=${JSON.stringify(results)}`);
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'pw_context.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-pw');
  }
})();
