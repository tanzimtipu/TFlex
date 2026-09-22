// ADV phase-35: resource leak across many print-window open/close cycles.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-leak] ${s}`); lines.push(`[adv35-leak] ${s}`); };

const metrics = (app) => app.evaluate(({ app: a, BrowserWindow }) => {
  const m = a.getAppMetrics();
  return {
    windows: BrowserWindow.getAllWindows().length,
    printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
    procCount: m.length,
    workingSetMB: Math.round(m.reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) / 1024),
    heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
});

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-leak-a.pdf'));
    await win.waitForTimeout(1500);
    const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    note(`baseline=${JSON.stringify(await metrics(app))}`);

    const samples = [];
    for (let i = 0; i < 15; i += 1) {
      const ctx = { docId: i % 2 === 0 ? docId : `ghost-${i}`, documentName: `leak-${i}.pdf`, pageCount: 34, settings: {} };
      await win.evaluate((c) => window.tflex.printWindow.open(c), ctx);
      await win.waitForTimeout(700);
      // close it via main (equivalent to the user closing the print window)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => { if (w.webContents.getURL().includes('tfWindow=print')) w.destroy(); });
      });
      await win.waitForTimeout(500);
      samples.push(await metrics(app));
    }
    note(`after 15 cycles: ${JSON.stringify(samples[samples.length - 1])}`);
    note(`trend workingSetMB=${JSON.stringify(samples.map((s) => s.workingSetMB))}`);
    note(`trend procCount=${JSON.stringify(samples.map((s) => s.procCount))}`);
    note(`trend printWindows=${JSON.stringify(samples.map((s) => s.printWindows))}`);
    note(`trend windows=${JSON.stringify(samples.map((s) => s.windows))}`);

    // Also: 20 sequential opens WITHOUT closing (singleton focus path).
    for (let i = 0; i < 20; i += 1) await win.evaluate((c) => window.tflex.printWindow.open(c), { docId, documentName: 'leak-focus.pdf', pageCount: 34, settings: {} });
    await win.waitForTimeout(800);
    note(`after 20 focus-opens: ${JSON.stringify(await metrics(app))}`);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach((w) => { if (w.webContents.getURL().includes('tfWindow=print')) w.destroy(); }); });
    await win.waitForTimeout(600);
    note(`final: ${JSON.stringify(await metrics(app))}`);

    fs.writeFileSync(path.join(OUT, 'leak.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'leak.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-leak');
  }
})();
