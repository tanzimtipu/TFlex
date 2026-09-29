// Attack group 6b: one visual case per fresh app. Run: node a6b-one.cjs <create|open> <file> <label>
'use strict';
const path = require('node:path');
const { launch, close, out } = require('./lib-adv.cjs');
const { runTool } = require('../../e2e/lib/helpers.cjs');

(async () => {
  const mode = process.argv[2];
  const file = process.argv[3];
  const label = process.argv[4] || 'a6b';
  const { app, win, logs } = await launch();
  try {
    if (mode === 'create') {
      await runTool(win, 'createFromImages');
      await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
      const chooserPromise = win.waitForEvent('filechooser');
      await win.locator('[data-create-pick]').click();
      const chooser = await chooserPromise;
      await chooser.setFiles([path.join(__dirname, file)]);
      await win.waitForFunction(() => document.querySelectorAll('[data-create-image-row]').length === 1, null, { timeout: 20000 });
      await win.locator('[data-create-confirm]').click();
    } else {
      await app.evaluate(async ({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, path.join(__dirname, file));
      await win.locator('[aria-label="Open PDF document"]').first().click();
    }
    for (let i = 0; i < 160; i += 1) {
      const st = await win.evaluate(() => ({
        notice: document.querySelectorAll('[data-conversion-notice]').length,
        toast: document.querySelectorAll('.toast-text').length,
      }));
      if (st.notice > 0 || st.toast > 0) break;
      await win.waitForTimeout(250);
    }
    await win.waitForTimeout(2000);
    const view = await win.evaluate(() => {
      const page = document.querySelector('.pdf-page');
      const canvas = page ? page.querySelector('canvas') : null;
      const zoom = document.querySelector('.zoom-percent');
      const note = document.querySelector('[data-conversion-notice]');
      return {
        pages: document.querySelectorAll('.pdf-page').length,
        pageBox: page ? { w: Math.round(page.getBoundingClientRect().width), h: Math.round(page.getBoundingClientRect().height) } : null,
        canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
        zoom: zoom ? zoom.textContent.trim() : null,
        noticeFidelity: note ? note.getAttribute('data-conversion-fidelity') : null,
        warnings: note ? Array.from(note.querySelectorAll('[data-conversion-warning]')).map((e) => e.getAttribute('data-conversion-warning')) : [],
      };
    }).catch((e) => ({ error: e.message }));
    await win.screenshot({ path: path.join(__dirname, 'shots', label + '.png') }).catch(() => {});
    out({ label, file, mode, view, pageerrors: logs.filter((l) => l.startsWith('[pageerror]')).slice(0, 4) });
  } catch (e) {
    out({ phase: 'a6b-crash', label, error: String(e && e.stack ? e.stack : e).slice(0, 300) });
  } finally {
    await close({ app }, 'a6b-' + label);
  }
})();
