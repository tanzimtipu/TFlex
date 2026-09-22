// ADV phase-34: confirm the first-page canvas insertion line is clipped.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');
const OUT = path.join(os.tmpdir(), 'adv-p34');
const lines = [];
const note = (s) => { console.log(`[adv34-clip] ${s}`); lines.push(`[adv34-clip] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    const alpha = C.tmpCopy(C.REPORT, 'adv34-clip-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-clip-beta.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-clip-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-clip-beta' }).first().click();
    await win.waitForTimeout(1600);
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    // start drag
    await win.evaluate(() => {
      const src = document.querySelector('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]');
      const dt = new DataTransfer();
      window.__dt = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await win.waitForTimeout(200);
    // hover first page upper half
    await win.evaluate(() => {
      const tgt = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="1"]');
      const r = tgt.getBoundingClientRect();
      tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.25 }));
    });
    await win.waitForTimeout(500);
    const res = await win.evaluate(() => {
      const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
      const scRect = sc.getBoundingClientRect();
      const ind = document.querySelector('.tab-pane[data-pane="B"] [data-drop-indicator]');
      const ir = ind ? ind.getBoundingClientRect() : null;
      const cs = ind ? getComputedStyle(ind) : null;
      return {
        scrollerTop: Math.round(scRect.top), scrollerLeft: Math.round(scRect.left), scrollerRight: Math.round(scRect.right),
        overflow: getComputedStyle(sc).overflow,
        indicator: ir ? { top: Math.round(ir.top), bottom: Math.round(ir.bottom), left: Math.round(ir.left), right: Math.round(ir.right), h: Math.round(ir.height), bg: cs.backgroundColor } : null,
        indicatorClipped: ir ? ir.bottom <= scRect.top : null,
        slot1: (() => { const s = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="1"]'); const b = s.getBoundingClientRect(); return { top: Math.round(b.top) }; })(),
      };
    });
    note(JSON.stringify(res));
    // pixel sample at the expected line location
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-firstline-confirm.png') });
    // end drag
    await win.evaluate(() => { const src = document.querySelector('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]'); src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); });
  } catch (e) { note('THREW ' + e.message); }
  finally { if (app) await hardClose(app, 'p34-clip').catch(() => {}); }
  fs.writeFileSync(path.join(OUT, 'clip.log'), lines.join('\n') + '\n', 'utf8');
})().catch((e) => { console.error(e); process.exitCode = 2; });