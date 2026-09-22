// QA independent reproduction of ADV-070..074 (phase 34). Minimal probes through
// the canonical launchApp. Writes raw measurements to stdout and a log file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p34');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
function note(s) { const l = `[qa-p34] ${s}`; console.log(l); lines.push(l); }

async function geom(win) {
  return win.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const am = document.querySelector('.app-main');
    return {
      stage: r('.tab-stage'),
      divider: r('[data-multi-divider]'),
      panel: r('[data-tools-palette]'),
      A: r('.tab-pane[data-pane="A"] .workspace-main'),
      B: r('.tab-pane[data-pane="B"] .workspace-main'),
      scA: r('.tab-pane[data-pane="A"] .document-scroller'),
      scB: r('.tab-pane[data-pane="B"] .document-scroller'),
      inset: am ? getComputedStyle(am).getPropertyValue('--tf-tools-inset').trim() : null,
      frac: getComputedStyle(document.querySelector('.tab-stage')).getPropertyValue('--tf-split-frac').trim(),
    };
  });
}
async function openPanel(win) {
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(800);
}
async function closePanel(win) {
  await win.locator('.tools-palette-close').first().click();
  await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(800);
}
async function dragDividerTo(win, frac) {
  const box = await win.locator('[data-multi-divider]').boundingBox();
  const stage = await win.locator('.tab-stage').boundingBox();
  if (!box || !stage) return false;
  const usable = await win.evaluate(() => {
    const st = document.querySelector('.tab-stage');
    const am = document.querySelector('.app-main');
    const inset = parseFloat(getComputedStyle(am).getPropertyValue('--tf-tools-inset')) || 0;
    return st.getBoundingClientRect().width - inset;
  });
  const targetX = stage.x + usable * frac;
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  return true;
}
async function setup(app, win, tag) {
  const alpha = C.tmpCopy(C.REPORT, `qa34-${tag}-alpha.pdf`);
  const beta = C.tmpCopy(C.LONG, `qa34-${tag}-beta.pdf`);
  await C.openFile(app, win, alpha); await win.waitForTimeout(700);
  await C.openFile(app, win, beta); await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: `qa34-${tag}-alpha` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: `qa34-${tag}-beta` }).first().click();
  await win.waitForTimeout(1600);
}
async function withApp(name, fn) {
  let app = null, win = null;
  try {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    note(`=== ${name} ===`);
    await fn(app, win);
  } catch (e) { note(`${name} THREW: ${e.stack || e.message}`); }
  finally { if (app) await hardClose(app, `qa-p34-${name}`).catch(() => {}); }
}
(async () => {
  // ---- ADV-070: unequal panel shrink at an uneven split ----
  await withApp('ADV-070-uneven', async (app, win) => {
    await setup(app, win, 'a70');
    for (const fracTarget of [0.35, 0.5, 0.65]) {
      await dragDividerTo(win, fracTarget);
      const before = await geom(win);
      await openPanel(win);
      const after = await geom(win);
      const dA = before.A.w - after.A.w;
      const dB = before.B.w - after.B.w;
      note(`ADV-070 frac req=${fracTarget} actual=${after.frac} inset=${after.inset}`);
      note(`ADV-070   A ${before.A.w}->${after.A.w} (delta ${dA}); B ${before.B.w}->${after.B.w} (delta ${dB}); |dA-dB|=${Math.abs(dA - dB)}`);
      await closePanel(win);
    }
  });

  // ---- ADV-071: 640px minimum window with the panel open ----
  await withApp('ADV-071-minwidth', async (app, win) => {
    await setup(app, win, 'a71');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(640, 520); });
    await win.waitForTimeout(1000);
    const before = await geom(win);
    await openPanel(win);
    const after = await geom(win);
    note(`ADV-071 before A=${before.A && before.A.w} B=${before.B && before.B.w} scA=${before.scA && before.scA.w} scB=${before.scB && before.scB.w} inset=${before.inset}`);
    note(`ADV-071 after  A=${after.A && after.A.w} B=${after.B && after.B.w} scA=${after.scA && after.scA.w} scB=${after.scB && after.scB.w} inset=${after.inset}`);
    note(`ADV-071 divider=${JSON.stringify(after.divider)} panel=${JSON.stringify(after.panel)}`);
    await win.screenshot({ path: path.join(C.SHOTS, 'def287-minwidth-panel.png') });
    await closePanel(win);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(1280, 860); });
    await win.waitForTimeout(800);
  });

  // ---- ADV-072 / ADV-073: tab strip state ----
  await withApp('ADV-072-073-tabs', async (app, win) => {
    await setup(app, win, 'a72');
    const snap = () => win.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const tabs = Array.from(document.querySelectorAll('.tab[data-tab-id]')).map((t) => ({
        id: t.getAttribute('data-tab-id'), label: txt(t.querySelector('.tab-title')),
        sel: t.getAttribute('aria-selected'), vis: getComputedStyle(t).visibility,
        hasClose: !!t.querySelector('.tab-close'),
      }));
      const panes = Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => ({
        pane: p.getAttribute('data-pane'), empty: p.hasAttribute('data-pane-empty'),
      }));
      const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
      return { tabs, panes, multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
        diagOpenTabs: d ? d.openTabs : null, activeTabId: d ? d.activeTabId : null,
        welcome: !!document.querySelector('.sample-card') };
    });
    const before = await snap();
    note(`ADV-072 before: tabs=${before.tabs.length} ids=${JSON.stringify(before.tabs.map((t) => t.id))} diagOpenTabs=${before.diagOpenTabs} active=${before.activeTabId}`);
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    const after = await snap();
    note(`ADV-072 after +tab: tabs=${after.tabs.length} ids=${JSON.stringify(after.tabs.map((t) => t.id))} diagOpenTabs=${after.diagOpenTabs} active=${after.activeTabId}`);
    await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(700);
    const off = await snap();
    note(`ADV-072 mode off: tabs=${off.tabs.length} labels=${JSON.stringify(off.tabs.map((t) => t.label))} active=${off.activeTabId} welcome=${off.welcome}`);

    // ADV-073: clear both panes, click composite X
    await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(700);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    const s0 = await snap();
    const closeBtn = win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-close');
    const exists = await closeBtn.count();
    if (exists > 0) { await closeBtn.click(); await win.waitForTimeout(800); }
    const s1 = await snap();
    note(`ADV-073 composite X exists=${exists}; before tabs=${s0.tabs.length} multi=${s0.multi} panes=${JSON.stringify(s0.panes)}`);
    note(`ADV-073 after  tabs=${s1.tabs.length} multi=${s1.multi} panes=${JSON.stringify(s1.panes)} welcome=${s1.welcome}`);
  });

  // ---- ADV-074: first-page canvas insertion line clipped ----
  await withApp('ADV-074-firstline', async (app, win) => {
    await setup(app, win, 'a74');
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    await win.evaluate(() => {
      const src = document.querySelector('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]');
      const dt = new DataTransfer(); window.__dt = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await win.waitForTimeout(200);
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
      const slot = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="1"]');
      const sr = slot ? slot.getBoundingClientRect() : null;
      return { scrollerTop: Math.round(scRect.top), overflow: getComputedStyle(sc).overflow,
        indicator: ir ? { top: Math.round(ir.top), bottom: Math.round(ir.bottom), h: Math.round(ir.height) } : null,
        indicatorClipped: ir ? ir.bottom <= scRect.top : null,
        slot1Top: sr ? Math.round(sr.top) : null };
    });
    note(`ADV-074 ${JSON.stringify(res)}`);
    await win.screenshot({ path: path.join(C.SHOTS, 'def290-firstline.png') });
    await win.evaluate(() => { const src = document.querySelector('[data-pane-strip-pane="A"] .thumb-item[data-page="1"]'); src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); });
  });

  fs.writeFileSync(path.join(OUT, 'qa_repro_p34.log'), lines.join('\n') + '\n', 'utf8');
  console.log(`\nlog: ${path.join(OUT, 'qa_repro_p34.log')}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });
