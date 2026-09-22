// ADV phase-33: per-pane strips at the wrapped toolbar height — cross-strip
// drag, strip header click during a drag, divider extremes.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-strips] ${s}`);
const findings = [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await C.twoPaneSetup(app, win);

    // shrink to the 640px minimum so the shared toolbar wraps
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.unmaximize();
      w.setSize(640, 520);
    });
    await win.waitForTimeout(1000);
    const wrapped = await win.evaluate(() => {
      const t = document.querySelector('[data-shared-toolbar]').getBoundingClientRect();
      const stripA = document.querySelector('.tab-pane[data-pane="A"] [data-pane-strip]');
      const stripB = document.querySelector('.tab-pane[data-pane="B"] [data-pane-strip]');
      const headerA = document.querySelector('.tab-pane[data-pane="A"] [data-pane-header]');
      return {
        toolbarH: Math.round(t.height), toolbarBottom: Math.round(t.bottom),
        headerTop: Math.round(headerA.getBoundingClientRect().top),
        stripA: stripA ? stripA.getBoundingClientRect().width : null,
        stripB: stripB ? stripB.getBoundingClientRect().width : null,
        vw: innerWidth, vh: innerHeight,
      };
    });
    note(`wrapped toolbar=${JSON.stringify(wrapped)}`);
    if (wrapped.toolbarBottom > wrapped.headerTop + 1) findings.push(`wrapped toolbar overlaps pane headers: toolbar.bottom ${wrapped.toolbarBottom} > header.top ${wrapped.headerTop}`);

    const countA0 = await C.paneCount(win, 'A');
    const countB0 = await C.paneCount(win, 'B');
    note(`counts before drag A=${countA0} B=${countB0}`);

    // ---- cross-strip drag: pane A strip thumb -> pane B strip ------------
    const srcThumb = win.locator('.tab-pane[data-pane="A"] [data-pane-strip] .thumb-item').first();
    const dst = win.locator('.tab-pane[data-pane="B"] [data-pane-strip] .pane-thumb-strip-body').first();
    let dragged = false;
    try {
      await srcThumb.dragTo(dst, { timeout: 8000 });
      dragged = true;
    } catch (e) {
      note(`cross-strip dragTo failed: ${e.message.split('\n')[0]}`);
    }
    await win.waitForTimeout(1500);
    const countA1 = await C.paneCount(win, 'A');
    const countB1 = await C.paneCount(win, 'B');
    note(`after cross-strip drag: dragged=${dragged} A=${countA1} B=${countB1}`);
    if (dragged && !(countA1 === countA0 - 1 && countB1 === countB0 + 1)) {
      findings.push(`cross-strip drag did not move exactly one page: A ${countA0}->${countA1}, B ${countB0}->${countB1}`);
    }
    await win.screenshot({ path: path.join(SHOTS, 'adv-p33-strips-wrapped.png') });

    // ---- strip header click while a drag is in flight --------------------
    const thumb2 = win.locator('.tab-pane[data-pane="A"] [data-pane-strip] .thumb-item').nth(1);
    const tb = await thumb2.boundingBox();
    if (tb) {
      await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await win.mouse.down();
      await win.mouse.move(tb.x + 30, tb.y + 30, { steps: 4 });
      // click the pane B strip header mid-drag
      const hdr = await win.locator('.tab-pane[data-pane="B"] [data-pane-strip-header]').first().boundingBox();
      if (hdr) { await win.mouse.move(hdr.x + hdr.width / 2, hdr.y + hdr.height / 2); await win.mouse.up(); }
      else { await win.mouse.up(); }
      await win.waitForTimeout(800);
      const focusB = await win.evaluate(() => document.querySelector('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused'));
      const countA2 = await C.paneCount(win, 'A');
      const countB2 = await C.paneCount(win, 'B');
      note(`strip header mid-drag: B focused=${focusB} A=${countA2} B=${countB2}`);
      if (countA2 !== countA1 || countB2 !== countB1) findings.push(`strip header click mid-drag changed page counts unexpectedly: A ${countA1}->${countA2}, B ${countB1}->${countB2}`);
    }

    // ---- divider hard drag both extremes ---------------------------------
    for (const target of [0, 639, 320, 0]) {
      const d = await win.locator('[data-multi-divider]').boundingBox();
      if (!d) break;
      await win.mouse.move(d.x + d.width / 2, d.y + 30);
      await win.mouse.down();
      await win.mouse.move(target, d.y + 30, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(250);
    }
    const geom = await win.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
      return { mainA: r('.tab-pane[data-pane="A"] .workspace-main'), stripA: r('.tab-pane[data-pane="A"] [data-pane-strip]'), stripB: r('.tab-pane[data-pane="B"] [data-pane-strip]'), mainB: r('.tab-pane[data-pane="B"] .workspace-main') };
    });
    note(`after divider extremes: ${JSON.stringify(geom)}`);
    if (geom.mainA && geom.mainA.w <= 0) findings.push('divider extreme collapsed pane A main to zero width');
    if (geom.mainB && geom.mainB.w <= 0) findings.push('divider extreme collapsed pane B main to zero width');

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'strips-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'strips-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-strips');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });