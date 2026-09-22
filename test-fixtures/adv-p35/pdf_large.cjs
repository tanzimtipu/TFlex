// ADV phase-35: large selection through the virtual-PDF path (bounded).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-large] ${s}`); lines.push(`[adv35-large] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.LONG, 'adv35-large-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 40000 });
    await win.waitForTimeout(2500);
    const diag = await win.evaluate(() => window.tflexDiagnostics());
    note(`doc pages=${diag.pageCount}`);

    const outPath = path.join(os.tmpdir(), `adv35-large-${Date.now()}.pdf`);
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, outPath);
    const before = await app.evaluate(({ app: a }) => Math.round(a.getAppMetrics().reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) / 1024));

    await win.click('[data-print]');
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await win.waitForFunction(() => { const s = document.querySelector('[data-print-printer]'); return s && [...s.querySelectorAll('option')].some((o) => o.value !== ''); }, null, { timeout: 20000 });
    await win.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-200');
    await win.waitForTimeout(1000);
    const t0 = Date.now();
    await win.click('[data-print-confirm]');
    let success = null, err = null;
    try {
      await win.waitForSelector('[data-print-success], [data-print-error]', { timeout: 230000 });
      success = await win.locator('[data-print-success]').innerText().catch(() => null);
      err = await win.locator('[data-print-error]').innerText().catch(() => null);
    } catch (e) { note(`timed out waiting for result: ${e.message}`); }
    const elapsed = Date.now() - t0;
    const after = await app.evaluate(({ app: a }) => Math.round(a.getAppMetrics().reduce((s, p) => s + (p.memory ? p.memory.workingSetSize : 0), 0) / 1024));
    note(`print 1-200: elapsedMs=${elapsed} success=${JSON.stringify(success)} err=${JSON.stringify(err)} workingSetMB ${before}->${after}`);
    if (fs.existsSync(outPath)) {
      const bytes = fs.readFileSync(outPath);
      const { PDFDocument } = require('pdf-lib');
      const pdf = await PDFDocument.load(bytes);
      note(`produced: bytes=${bytes.length} pages=${pdf.getPageCount()} magic=${bytes.subarray(0, 5).toString('latin1')}`);
    } else {
      note(`produced: MISSING at ${outPath}`);
    }

    fs.writeFileSync(path.join(OUT, 'large.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'large.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-large');
  }
})();
