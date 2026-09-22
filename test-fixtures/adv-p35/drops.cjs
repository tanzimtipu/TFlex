// ADV phase-35: OS file-drop path (synthetic DataTransfer) + preferences silence check.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-drop] ${s}`); lines.push(`[adv35-drop] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    win.on('pageerror', (e) => note(`PAGEERROR: ${e.message}`));
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-drop-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    const toasts = () => win.evaluate(() => [...document.querySelectorAll('[data-toast], .toast')].map((t) => t.textContent.trim()));
    const clearToasts = () => win.evaluate(() => { document.querySelectorAll('[data-toast], .toast').forEach((t) => t.remove()); });
    const tabs = () => win.evaluate(() => [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()));

    // Build a synthetic drop in-page. `files` are synthetic (no on-disk path), so the
    // app's webUtils.getPathForFile cannot resolve them - the error/notice branches
    // are what we can exercise without a real Explorer drag.
    const drop = (spec) => win.evaluate((s) => {
      const dt = new DataTransfer();
      if (s.setFilesType) dt.setData('Files', 'x');
      for (const f of s.files || []) {
        const file = new File([new Uint8Array(f.bytes || [1, 2, 3])], f.name, { type: f.type || '' });
        dt.items.add(file);
      }
      const target = s.selector ? document.querySelector(s.selector) : window;
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      (target || window).dispatchEvent(ev);
      return { types: [...dt.types], fileCount: dt.files.length };
    }, spec);

    // preferences gear silence check
    await win.locator('[data-open-preferences]').first().click({ timeout: 6000 }).catch((e) => note(`prefs click failed: ${String(e.message).split('\n')[0]}`));
    await win.waitForTimeout(900);
    const prefs = await win.locator('[data-prefs-dialog]').count();
    note(`preferences gear: dialogCount=${prefs}`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);

    // 1. non-PDF drop
    await clearToasts();
    note(`drop non-pdf dispatch=${JSON.stringify(await drop({ files: [{ name: 'note.txt', type: 'text/plain' }] }))}`);
    await win.waitForTimeout(900);
    note(`drop non-pdf toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);

    // 2. PDF drop (synthetic -> cannot resolve a path)
    await clearToasts();
    await drop({ files: [{ name: 'thing.pdf', type: 'application/pdf' }] });
    await win.waitForTimeout(1200);
    note(`drop pdf-synthetic toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);

    // 3. multi-file drop (2 PDFs)
    await clearToasts();
    await drop({ files: [{ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.pdf', type: 'application/pdf' }] });
    await win.waitForTimeout(1200);
    note(`drop multi toasts=${JSON.stringify(await toasts())}`);

    // 4. Files-typed but zero files
    await clearToasts();
    await drop({ setFilesType: true, files: [] });
    await win.waitForTimeout(900);
    note(`drop empty-files toasts=${JSON.stringify(await toasts())}`);

    // 5. text/plain drop (in-app page-drag channel) -> must be ignored by the OS drop handler
    await clearToasts();
    await drop({ files: [], setFilesType: false });
    await win.waitForTimeout(700);
    const afterPlain = await toasts();
    await win.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'page:1');
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await win.waitForTimeout(700);
    note(`drop text/plain toasts=${JSON.stringify(afterPlain)}`);

    // 6. Files drop onto a control (the Print button)
    await clearToasts();
    await drop({ selector: '[data-print]', files: [{ name: 'onbutton.pdf', type: 'application/pdf' }] });
    await win.waitForTimeout(1000);
    note(`drop-on-control toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);

    // 7. Files drop while a modal is open (Preferences)
    await win.locator('[data-open-preferences]').first().click().catch(() => {});
    await win.waitForTimeout(700);
    await clearToasts();
    await drop({ files: [{ name: 'modal.pdf', type: 'application/pdf' }] });
    await win.waitForTimeout(1000);
    const modalDrop = { toasts: await toasts(), prefsStillOpen: await win.locator('[data-prefs-dialog]').count() };
    note(`drop-while-modal toasts=${JSON.stringify(modalDrop.toasts)} prefsStillOpen=${modalDrop.prefsStillOpen}`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);

    // 8. Files drop during an in-app page drag
    const dragRes = await win.evaluate(async () => {
      const src = document.querySelector('.thumb-item[data-page="1"]');
      if (!src) return { skipped: 'no thumb' };
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 150));
      const fdt = new DataTransfer();
      fdt.items.add(new File([new Uint8Array([1])], 'during-drag.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: fdt }));
      await new Promise((r) => setTimeout(r, 150));
      const dragActive = !!document.querySelector('.drag-active, [data-dragging]');
      return { dragActive };
    });
    await win.waitForTimeout(900);
    note(`drop-during-drag: ${JSON.stringify(dragRes)} toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);

    // 9. no-webUtils-bridge: check the preload actually exposes it (the hook's guard path)
    const bridge = await win.evaluate(() => ({
      hasWebUtils: !!(window.tflex && window.tflex.webUtils),
      hasGetPath: !!(window.tflex && window.tflex.webUtils && typeof window.tflex.webUtils.getPathForFile === 'function'),
      hasOnOpenPath: typeof (window.tflex && window.tflex.onOpenPathRequest) === 'function',
    }));
    note(`bridge=${JSON.stringify(bridge)}`);

    fs.writeFileSync(path.join(OUT, 'drops.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'drops.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-drop');
  }
})();
