// ADV phase-35: verify the PRODUCED PDF's first-sheet page order matches the preview,
// and capture the exact composed image order from the hidden print window DOM.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-order] ${s}`); lines.push(`[adv35-order] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(path.join(__dirname, 'distinct6.pdf'), 'adv35-order-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    await app.evaluate(({ BrowserWindow, dialog }) => {
      globalThis.__advComposed = null;
      const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
      const orig = proto.printToPDF;
      proto.printToPDF = async function (opts) {
        try {
          globalThis.__advComposed = await this.executeJavaScript(
            '[...document.querySelectorAll(".sheet")].map(s => [...s.querySelectorAll(".page img")].map(i => i.src))',
          );
        } catch (e) { globalThis.__advComposed = { error: String(e) }; }
        return orig.call(this, opts);
      };
      globalThis.__advSave = { mode: 'ok', lastPath: null };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__advSave.lastPath });
    });

    const outPath = path.join(os.tmpdir(), `adv35-order-${Date.now()}.pdf`);
    await app.evaluate(({ }, p) => { globalThis.__advSave.lastPath = p; }, outPath);

    await win.click('[data-print]');
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await win.waitForFunction(() => { const s = document.querySelector('[data-print-printer]'); return s && [...s.querySelectorAll('option')].some((o) => o.value !== ''); }, null, { timeout: 20000 });
    await win.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-6');
    await win.locator('[data-print-reverse]').check();
    // Capture ALL six page rasters via a 6-up preview (the preview shows only the
    // first sheet, so 6-up exposes pages 6..1 in reverse order).
    await win.locator('[data-print-nup]').selectOption('6');
    await win.waitForTimeout(1800);
    const preview6 = await win.evaluate(() => ({
      meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent || null,
      cells: [...document.querySelectorAll('[data-print-preview-cell]')].map((c) => ({ page: c.getAttribute('data-print-preview-page'), src: c.querySelector('img') ? c.querySelector('img').src : null })),
    }));
    note(`preview6 meta=${JSON.stringify(preview6.meta)} cells=${JSON.stringify(preview6.cells.map((c) => c.page))}`);
    const allPageSrc = {};
    for (const c of preview6.cells) if (c.page && c.src) allPageSrc[c.page] = c.src;
    // Now the 2-up landscape print.
    await win.locator('[data-print-orientation-landscape]').check();
    await win.locator('[data-print-nup]').selectOption('2');
    await win.waitForTimeout(1500);
    const preview = await win.evaluate(() => ({
      meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent || null,
      cells: [...document.querySelectorAll('[data-print-preview-cell]')].map((c) => ({ page: c.getAttribute('data-print-preview-page'), src: c.querySelector('img') ? c.querySelector('img').src : null })),
    }));
    note(`preview meta=${JSON.stringify(preview.meta)} cells=${JSON.stringify(preview.cells.map((c) => c.page))}`);
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { timeout: 60000 });
    await win.waitForTimeout(1200);
    const composed = await app.evaluate(() => globalThis.__advComposed);
    note(`composed sheets=${Array.isArray(composed) ? composed.length : 'ERR'} imgsPerSheet=${Array.isArray(composed) ? JSON.stringify(composed.map((s) => s.length)) : JSON.stringify(composed)}`);
    note(`produced exists=${fs.existsSync(outPath)} bytes=${fs.existsSync(outPath) ? fs.readFileSync(outPath).length : 0}`);

    // Save the preview images so the Node matcher can compare.
    const prevByPage = {};
    for (const c of preview.cells) if (c.page && c.src) prevByPage[c.page] = c.src;
    fs.writeFileSync(path.join(OUT, 'order_data.json'), JSON.stringify({ outPath, previewCells: preview.cells.map((c) => c.page), previewSrc: prevByPage, allPageSrc, composed }, null, 0));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'order.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-order');
  }
})();


