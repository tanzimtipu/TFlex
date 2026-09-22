// QA independent reproduction of ADV-073 only: composite tab X no-ops with both panes empty.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');
const OUT = path.join(os.tmpdir(), 'adv-p34');
const lines = [];
const note = (s) => { console.log(`[qa-p34-073] ${s}`); lines.push(`[qa-p34-073] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    const alpha = C.tmpCopy(C.REPORT, 'qa34-a73-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'qa34-a73-beta.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'qa34-a73-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'qa34-a73-beta' }).first().click();
    await win.waitForTimeout(1600);
    const snap = () => win.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const tabs = Array.from(document.querySelectorAll('.tab[data-tab-id]')).map((t) => ({
        id: t.getAttribute('data-tab-id'), label: txt(t.querySelector('.tab-title')),
        sel: t.getAttribute('aria-selected'), hasClose: !!t.querySelector('.tab-close'),
      }));
      const panes = Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => ({
        pane: p.getAttribute('data-pane'), empty: p.hasAttribute('data-pane-empty'),
      }));
      return { tabs, panes, multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
        welcome: !!document.querySelector('.sample-card') };
    });
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    const s0 = await snap();
    note(`before X: tabs=${s0.tabs.length} label=${JSON.stringify(s0.tabs.map((t) => t.label))} multi=${s0.multi} panes=${JSON.stringify(s0.panes)}`);
    const closeBtn = win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-close');
    const exists = await closeBtn.count();
    if (exists > 0) { await closeBtn.click(); await win.waitForTimeout(800); }
    const s1 = await snap();
    note(`after X: exists=${exists} tabs=${s1.tabs.length} multi=${s1.multi} panes=${JSON.stringify(s1.panes)} welcome=${s1.welcome}`);
  } catch (e) { note('THREW ' + (e.stack || e.message)); }
  finally { if (app) await hardClose(app, 'qa-p34-073').catch(() => {}); }
  fs.writeFileSync(path.join(OUT, 'qa_repro_073.log'), lines.join('\n') + '\n', 'utf8');
})().catch((e) => { console.error(e); process.exitCode = 2; });