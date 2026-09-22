// ADV phase-34: final checks - single-mode panel at 640 (comparison), the
// first-page canvas line clipping, and the composite tab at the 640 minimum.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p34');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const findings = [];
function note(s) { const l = `[adv34-final] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

async function openPanel(win) { await win.locator('[data-tools-badge]').first().click(); await win.waitForSelector('[data-tools-palette]', { timeout: 10000 }); await win.waitForTimeout(800); }
async function withApp(name, fn) {
  let app = null, win = null;
  try { app = await launchApp(); win = await app.firstWindow(); await win.waitForSelector('.sample-card', { timeout: 30000 }); await win.waitForTimeout(300); note(`=== ${name} ===`); await fn(app, win); }
  catch (e) { note(`${name} THREW: ${e.message}`); }
  finally { if (app) await hardClose(app, `p34-${name}`).catch(() => {}); }
}

(async () => {
  // Single mode at 640 with the panel open (comparison baseline)
  await withApp('F1-single-640', async (app, win) => {
    const beta = C.tmpCopy(C.LONG, 'adv34-f1-beta.pdf');
    await C.openFile(app, win, beta); await win.waitForTimeout(900);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(640, 520); });
    await win.waitForTimeout(1000);
    const before = await win.evaluate(() => { const s = document.querySelector('.document-scroller'); const b = s.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) }; });
    await openPanel(win);
    const after = await win.evaluate(() => { const s = document.querySelector('.document-scroller'); const b = s.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) }; });
    note(`single 640: scroller ${before.w} -> ${after.w} (left ${after.left} right ${after.right})`);
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-single-640-panel.png') });
  });

  // First-page canvas line clipping check
  await withApp('F2-firstline-clip', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-f2-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-f2-beta.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-f2-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-f2-beta' }).first().click();
    await win.waitForTimeout(1600);
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    const res = await win.evaluate(() => {
      const KEY = '__p34dt';
      const src = document.querySelector('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]');
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const tgt = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="1"]');
      const r = tgt.getBoundingClientRect();
      tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.25 }));
      const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
      const scRect = sc.getBoundingClientRect();
      const scStyle = getComputedStyle(sc);
      const ind = document.querySelector('.tab-pane[data-pane="B"] [data-drop-indicator]');
      const ir = ind ? ind.getBoundingClientRect() : null;
      return {
        scroller: { top: Math.round(scRect.top), bottom: Math.round(scRect.bottom), overflow: scStyle.overflow },
        indicator: ir ? { top: Math.round(ir.top), bottom: Math.round(ir.bottom), h: Math.round(ir.height) } : null,
        visible: ir ? (ir.bottom > scRect.top && ir.top < scRect.bottom) : false,
        content: (() => { const c = document.querySelector('.tab-pane[data-pane="B"] .document-content'); const b = c.getBoundingClientRect(); return { top: Math.round(b.top) }; })(),
      };
    });
    note(`first-line clip: ${JSON.stringify(res)}`);
    if (res.indicator && !res.visible) finding('The insertion line for the FIRST page is clipped by the scroller and NOT visible', 'MEDIUM', { res });
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-firstline-clip.png') });
  });

  // Composite tab at the 640 minimum: strip overflow / title
  await withApp('F3-composite-640', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-f3-' + 'a'.repeat(70) + '.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-f3-' + 'b'.repeat(70) + '.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-f3-a' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-f3-b' }).first().click();
    await win.waitForTimeout(1600);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(640, 520); });
    await win.waitForTimeout(1000);
    const info = await win.evaluate(() => {
      const t = document.querySelector('.tab[data-tab-id="tf-multi-workspace"]');
      if (!t) return null;
      const b = t.getBoundingClientRect();
      const title = t.querySelector('.tab-title');
      const tb = title.getBoundingClientRect();
      const list = document.querySelector('.tab-list');
      const lb = list.getBoundingClientRect();
      return { tab: { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }, titleW: Math.round(tb.width), titleText: title.textContent.slice(0, 40), listW: Math.round(lb.width), listScrollW: list.scrollWidth, titleAttr: title.getAttribute('title') };
    });
    note(`composite 640: ${JSON.stringify(info)}`);
    if (info && info.tab.right > info.listW + 2) finding('Composite tab overflows the tab strip at 640px', 'LOW', { info });
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-composite-640.png') });
  });

  fs.writeFileSync(path.join(OUT, 'final.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });