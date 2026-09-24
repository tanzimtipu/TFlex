// Phase-37 items 5,6,11,15,16,18,19 - flyout, themes, strips, placement audit.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

const dockStyle = () => {
  const d = document.querySelector('[data-action-dock]');
  if (!d) return null;
  const cs = getComputedStyle(d);
  const r = d.getBoundingClientRect();
  const first = d.querySelector('.action-dock-verb');
  const fcs = first ? getComputedStyle(first) : null;
  return {
    bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius,
    border: cs.borderTopWidth + ' ' + cs.borderTopColor, boxShadow: cs.boxShadow.slice(0, 40),
    height: Math.round(r.height), gap: cs.gap, padding: cs.padding,
    verbPadding: fcs ? fcs.padding : null, verbFont: fcs ? fcs.fontSize : null, verbHeight: first ? Math.round(first.getBoundingClientRect().height) : null,
  };
};

(async () => {
  const { app, window } = await boot({ profile: 'p9-surfaces' });
  const out = {};
  window.on('pageerror', (e) => { (out.pageErrors = out.pageErrors || []).push(String(e && e.message || e)); });
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 4); await window.waitForTimeout(400);

    // ---- theme consistency (item 6/11) ----
    out.themes = {};
    for (const t of ['light', 'dark', 'frosted']) {
      await window.locator('[data-theme-toggle]').first().click();
      await window.waitForTimeout(300);
      await window.locator(`[data-theme-option="${t}"]`).first().click();
      await window.waitForTimeout(700);
      out.themes[t] = await window.evaluate(dockStyle);
      await shot(window, `p9-theme-${t}.png`);
    }
    // back to light
    await window.locator('[data-theme-toggle]').first().click(); await window.waitForTimeout(300);
    await window.locator('[data-theme-option="light"]').first().click(); await window.waitForTimeout(600);

    // ---- placement audit (item 18) ----
    await setContentSize(app, 1440, 900); await sleep(600);
    out.edges = await window.evaluate(() => {
      const W = window.innerWidth, H = window.innerHeight;
      const controls = Array.from(document.querySelectorAll('button, a, [role=button], input, select')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      });
      let worst = null;
      const touching = [];
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        const gap = Math.min(r.left, r.top, W - r.right, H - r.bottom);
        const info = { label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30), gap: Math.round(gap), rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } };
        if (worst === null || gap < worst.gap) worst = info;
        if (gap < 4) touching.push(info);
      }
      const gear = document.querySelector('[data-stage-rail-gear]');
      const gearRect = gear ? gear.getBoundingClientRect() : null;
      const gearLabel = gear ? gear.querySelector('.stage-rail-label') : null;
      const glr = gearLabel ? gearLabel.getBoundingClientRect() : null;
      return {
        controlCount: controls.length,
        worst, touchingCount: touching.length, touching: touching.slice(0, 10),
        gear: gearRect ? { l: Math.round(gearRect.left), b: Math.round(gearRect.bottom), r: Math.round(gearRect.right) } : null,
        gearLabel: glr ? { l: Math.round(glr.left), b: Math.round(glr.bottom), r: Math.round(glr.right), text: gearLabel.textContent } : null,
        W, H,
      };
    });

    // ---- annotation flyout: one row, no header (item 5) ----
    await gotoStage(window, 3); await window.waitForTimeout(400);
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    out.flyout = await window.evaluate(() => {
      const f = document.querySelector('[data-annotation-flyout]');
      if (!f) return null;
      const cs = getComputedStyle(f);
      const kids = Array.from(f.children).map((c) => ({ cls: c.className, tag: c.tagName, h: Math.round(c.getBoundingClientRect().height), w: Math.round(c.getBoundingClientRect().width) }));
      const rows = new Set(Array.from(f.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top)));
      return { rect: (() => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(), rows: rows.size, childCount: f.children.length, children: kids, textHeadings: Array.from(f.querySelectorAll('h1,h2,h3,[class*=title],[class*=header]')).map((e) => e.textContent.trim().slice(0, 30)) };
    });
    await shot(window, 'p9-flyout.png');
    // narrow: flyout must follow the ladder
    await setContentSize(app, 640, 900); await sleep(700);
    out.flyout640 = await window.evaluate(() => {
      const f = document.querySelector('[data-annotation-flyout]');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), rows: new Set(Array.from(f.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top))).size, labelsVisible: Array.from(f.querySelectorAll('.edit-toolbar-font-label, .annotation-toolbar-label, [class*=label]')).filter((e) => e.getBoundingClientRect().width > 0).length };
    });
    await setContentSize(app, 1440, 900); await sleep(500);

    // ---- multi mode strips (items 16,19) ----
    const mm = window.locator('[data-header-multi-mode]');
    out.mmButton = await mm.count();
    if (await mm.count()) {
      await mm.first().click(); await window.waitForTimeout(1000);
      out.multi = await window.evaluate(() => {
        const strips = Array.from(document.querySelectorAll('[data-pane-strip], .pane-thumb-strip, .thumb-strip'));
        const strip = document.querySelector('[data-pane-strip]') || strips[0];
        const r = strip ? strip.getBoundingClientRect() : null;
        return {
          stripCount: strips.length,
          strip: r ? { x: Math.round(r.x), w: Math.round(r.width) } : null,
          hasThumbs: !!document.querySelector('.thumb-canvas'),
          paneHeaders: Array.from(document.querySelectorAll('[data-pane-header]')).map((e) => e.textContent.trim().slice(0, 30)),
        };
      });
      await shot(window, 'p9-multi.png');
      // right-click a thumb near the right edge to test menu clamp
      const thumb = window.locator('.pane-thumb-strip .thumb, [data-pane-strip] .thumb, .thumb').first();
      if (await thumb.count()) {
        const tb = await thumb.boundingBox();
        if (tb) {
          await window.mouse.click(tb.x + tb.width - 3, tb.y + tb.height - 3, { button: 'right' });
          await window.waitForTimeout(500);
          out.stripMenu = await window.evaluate(() => {
            const m = document.querySelector('[data-page-menu], .page-thumb-menu, [role=menu]');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), W: window.innerWidth, H: window.innerHeight, items: Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()) };
          });
          await shot(window, 'p9-strip-menu.png');
          await window.keyboard.press('Escape');
        }
      }
      await mm.first().click(); await window.waitForTimeout(800);
    }

    writeOut('p9.json', out);
    console.log('P9 done');
  } catch (e) {
    writeOut('p9.error.txt', String(e && e.stack || e));
    console.log('P9 ERROR', e && e.message);
  } finally { await safeClose(app); process.exit(0); }
})();
