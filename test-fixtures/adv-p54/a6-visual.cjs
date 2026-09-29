// Attack group 6: visual state for degenerate / absurd / silently-blank pages.
// Run: node a6-visual.cjs
'use strict';
const path = require('node:path');
const { launch, close, pageSizes, out } = require('./lib-adv.cjs');
const { runTool } = require('../../e2e/lib/helpers.cjs');

async function createViaDialog(win, files) {
  await runTool(win, 'createFromImages');
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  await win.waitForFunction((n) => document.querySelectorAll('[data-create-image-row]').length === n, files.length, { timeout: 20000 });
  await win.locator('[data-create-confirm]').click();
  // settle until a notice or error toast
  for (let i = 0; i < 120; i += 1) {
    const st = await win.evaluate(() => ({
      notice: document.querySelectorAll('[data-conversion-notice]').length,
      toast: document.querySelectorAll('.toast-text').length,
    }));
    if (st.notice > 0 || st.toast > 0) break;
    await win.waitForTimeout(250);
  }
  await win.waitForTimeout(1500);
}

async function openViaDialog(win, app, filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  for (let i = 0; i < 120; i += 1) {
    const st = await win.evaluate(() => ({
      notice: document.querySelectorAll('[data-conversion-notice]').length,
      toast: document.querySelectorAll('.toast-text').length,
      page: document.querySelectorAll('.pdf-page').length,
    }));
    if (st.notice > 0 || st.toast > 0) break;
    await win.waitForTimeout(250);
  }
  await win.waitForTimeout(1500);
}

async function observe(win, label) {
  const view = await win
    .evaluate(() => {
      const page = document.querySelector('.pdf-page');
      const canvas = page ? page.querySelector('canvas') : null;
      const note = document.querySelector('[data-conversion-notice]');
      return {
        pages: document.querySelectorAll('.pdf-page').length,
        pageBox: page ? { w: Math.round(page.getBoundingClientRect().width), h: Math.round(page.getBoundingClientRect().height) } : null,
        canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
        noticeFidelity: note ? note.getAttribute('data-conversion-fidelity') : null,
        warnings: note ? Array.from(note.querySelectorAll('[data-conversion-warning]')).map((e) => e.getAttribute('data-conversion-warning')) : [],
      };
    })
    .catch((e) => ({ error: e.message }));
  await win.screenshot({ path: path.join(__dirname, 'shots', label + '.png') }).catch(() => {});
  return view;
}

(async () => {
  const { app, win, logs } = await launch();
  try {
    for (const [name, label] of [
      ['png-phys-max.png', 'a6-phys-max'],
      ['png-1x1-100000dpi.png', 'a6-1x1-100k'],
      ['png-2000-1dpi.png', 'a6-2000-1dpi'],
    ]) {
      await createViaDialog(win, [path.join(__dirname, name)]);
      const d = await win.evaluate(() => window.tflexDiagnostics()).catch((e) => ({ error: e.message }));
      out({ label, name, diag: { openTabs: d.openTabs, pageCount: d.pageCount }, view: await observe(win, label) });
      // close the tab to free the renderer before the next heavy page
      const closeBtn = win.locator('[data-tab-id] .tab-close').first();
      if ((await closeBtn.count()) > 0) { await closeBtn.click(); await win.waitForTimeout(600); }
    }
    // svg silently-blank native import via Open
    await openViaDialog(win, app, path.join(__dirname, 'svg-numeric-hostile2.svg'));
    out({ label: 'a6-svg-numeric', view: await observe(win, 'a6-svg-numeric') });
    out({ phase: 'pageerrors', errors: logs.filter((l) => l.startsWith('[pageerror]')).slice(0, 5) });
    out({ phase: 'usable', u: await win.evaluate(() => true).catch((e) => 'dead: ' + e.message) });
  } catch (e) {
    out({ phase: 'a6-crash', error: String(e && e.stack ? e.stack : e).slice(0, 400) });
  } finally {
    await close({ app }, 'a6-visual');
  }
})();
