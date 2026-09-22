// ADV phase-35: OS file-drop path, clean run (no DOM mutation - toasts are read only).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-drop2] ${s}`); lines.push(`[adv35-drop2] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    win.on('pageerror', (e) => note(`PAGEERROR: ${e.message}`));
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-drop2-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    const toasts = () => win.evaluate(() => [...document.querySelectorAll('[data-toast], .toast')].map((t) => t.textContent.trim()));
    const tabs = () => win.evaluate(() => [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()));
    const drop = (spec) => win.evaluate((s) => {
      const dt = new DataTransfer();
      for (const f of s.files || []) {
        dt.items.add(new File([new Uint8Array(f.bytes || [1, 2, 3])], f.name, { type: f.type || '' }));
      }
      const target = s.selector ? document.querySelector(s.selector) : window;
      (target || window).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { types: [...dt.types], fileCount: dt.files.length };
    }, spec);

    const step = async (label, spec, waitMs = 4500) => {
      const dispatch = await drop(spec);
      await win.waitForTimeout(waitMs);
      note(`${label}: dispatch=${JSON.stringify(dispatch)} toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);
    };

    await step('non-pdf', { files: [{ name: 'note.txt', type: 'text/plain' }] });
    await step('pdf-synthetic', { files: [{ name: 'thing.pdf', type: 'application/pdf' }] });
    await step('multi-2pdf', { files: [{ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.pdf', type: 'application/pdf' }] });
    await step('zero-files', { files: [] });
    await step('text-plain', { files: [] });
    await step('drop-on-control', { selector: '[data-print]', files: [{ name: 'onbutton.pdf', type: 'application/pdf' }] });

    // drop while a modal is open
    await win.locator('[data-open-preferences]').first().click().catch(() => {});
    await win.waitForTimeout(700);
    const prefsBefore = await win.locator('[data-prefs-dialog]').count();
    await drop({ files: [{ name: 'modal.pdf', type: 'application/pdf' }] });
    await win.waitForTimeout(2500);
    note(`drop-while-modal: prefsBefore=${prefsBefore} prefsAfter=${await win.locator('[data-prefs-dialog]').count()} toasts=${JSON.stringify(await toasts())}`);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);

    // drop during an in-app page drag
    const during = await win.evaluate(async () => {
      const src = document.querySelector('.thumb-item');
      if (!src) return { skipped: 'no thumb-item' };
      const dt = new DataTransfer();
      dt.setData('text/plain', 'page:1');
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 150));
      const fdt = new DataTransfer();
      fdt.items.add(new File([new Uint8Array([1])], 'during-drag.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: fdt }));
      await new Promise((r) => setTimeout(r, 150));
      return { dragClass: document.body.className };
    });
    await win.waitForTimeout(2500);
    note(`drop-during-drag: ${JSON.stringify(during)} toasts=${JSON.stringify(await toasts())} tabs=${JSON.stringify(await tabs())}`);

    // drop onto the empty welcome screen (no document)
    const welcomeDrop = await win.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], 'welcome.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    });
    await win.waitForTimeout(2500);
    note(`drop-welcome: ${welcomeDrop} toasts=${JSON.stringify(await toasts())}`);

    const bridge = await win.evaluate(() => ({ hasWebUtils: !!(window.tflex && window.tflex.webUtils && typeof window.tflex.webUtils.getPathForFile === 'function'), hasOnOpenPath: typeof (window.tflex && window.tflex.onOpenPathRequest) === 'function' }));
    note(`bridge=${JSON.stringify(bridge)}`);

    fs.writeFileSync(path.join(OUT, 'drops2.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'drops2.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-drop2');
  }
})();
