// Phase-37 items 2,4,6,8,9,18,19 - arrow scroll, welcome rail, chevron, geometry.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage } = require('./lib.cjs');

(async () => {
  const { app, window } = await boot({ profile: 'p2-rail' });
  const out = {};
  try {
    // --- welcome: rail must be absent ---
    await window.waitForTimeout(600);
    out.welcome = await window.evaluate(() => ({
      rail: !!document.querySelector('[data-stage-rail]'),
      panel: !!document.querySelector('[data-context-panel]'),
      inspector: !!document.querySelector('[data-inspector]'),
      appRailHidden: document.querySelector('.app-main')?.getAttribute('data-stage-rail-hidden'),
      welcome: !!document.querySelector('.welcome, [data-welcome]'),
    }));
    await shot(window, 'p2-welcome.png');

    await openSample(app, window, 'report.pdf');
    out.afterOpen = await window.evaluate(() => ({
      rail: !!document.querySelector('[data-stage-rail]'),
      panel: !!document.querySelector('[data-context-panel]'),
      appRailHidden: document.querySelector('.app-main')?.getAttribute('data-stage-rail-hidden'),
    }));

    // --- panel collapse via chevron: must flip ---
    out.chevron = { stages: [] };
    for (const i of [0, 1, 2]) {
      const before = await window.evaluate(() => {
        const b = document.querySelector('[data-rail-collapse]');
        return b ? { dir: b.getAttribute('data-collapse-direction'), label: b.getAttribute('aria-label') } : null;
      });
      await window.locator('[data-rail-collapse]').first().click();
      await window.waitForTimeout(500);
      const after = await window.evaluate(() => {
        const b = document.querySelector('[data-rail-collapse]');
        const p = document.querySelector('[data-context-panel]');
        return {
          dir: b ? b.getAttribute('data-collapse-direction') : null,
          label: b ? b.getAttribute('aria-label') : null,
          collapsed: p ? p.getAttribute('data-context-panel-collapsed') === 'true' : null,
          ruler: !!document.querySelector('[data-context-panel-ruler]'),
        };
      });
      out.chevron.stages.push({ before, after });
    }
    // leave expanded
    const p = await window.evaluate(() => document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed'));
    if (p === 'true') { await window.locator('[data-rail-collapse]').first().click(); await window.waitForTimeout(400); }

    // --- panel geometry: width, header title, outline flush + separator ---
    await setContentSize(app, 1440, 900);
    await sleep(600);
    out.panelGeom = await window.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
      const panel = document.querySelector('[data-context-panel]');
      const body = document.querySelector('[data-context-panel] .context-panel-body');
      const outline = document.querySelector('[data-context-panel-outline]');
      const titleEls = Array.from(document.querySelectorAll('.context-panel-header .glass-sidebar-title, .context-panel-header [class*=title]'));
      return {
        panel: r('[data-context-panel]'),
        body: r('[data-context-panel] .context-panel-body'),
        outline: r('[data-context-panel-outline]'),
        panelBottom: panel ? Math.round(panel.getBoundingClientRect().bottom) : null,
        outlineBottom: outline ? Math.round(outline.getBoundingClientRect().bottom) : null,
        titleTexts: titleEls.map((e) => e.textContent.trim()).filter(Boolean),
        hasSeparator: !!document.querySelector('.context-panel-outline, [data-context-panel-outline]'),
      };
    });

    // --- arrows: functional scroll at 719 and no-op check at 640 ---
    await gotoStage(window, 4);
    out.arrows = {};
    for (const w of [719, 700, 640]) {
      await setContentSize(app, w, 900);
      await sleep(700);
      const info = await window.evaluate(() => {
        const sc = document.querySelector('[data-dock-scroll]');
        const al = document.querySelector('[data-dock-arrow="left"]');
        const ar = document.querySelector('[data-dock-arrow="right"]');
        return {
          scrollLeft: sc ? sc.scrollLeft : null,
          scrollWidth: sc ? sc.scrollWidth : null,
          clientWidth: sc ? sc.clientWidth : null,
          arrows: !!al && !!ar,
        };
      });
      if (info.arrows) {
        await window.locator('[data-dock-arrow="right"]').first().click();
        await window.waitForTimeout(700);
        const after = await window.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
        await window.locator('[data-dock-arrow="left"]').first().click();
        await window.waitForTimeout(700);
        const back = await window.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
        info.afterRight = after; info.afterLeft = back;
      }
      out.arrows[w] = info;
    }

    // --- placement audit: edge gaps ---
    await setContentSize(app, 1440, 900); await sleep(600);
    out.edges = await window.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
      const W = window.innerWidth, H = window.innerHeight;
      const items = {
        header: r('.app-header'), rail: r('[data-stage-rail]'), panel: r('[data-context-panel]'),
        inspector: r('[data-inspector]'), dock: r('[data-action-dock]'),
      };
      const gap = (x) => x ? { left: x.l, right: W - x.r, top: x.t, bottom: H - x.b } : null;
      return Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { rect: v, gap: gap(v) }]));
    });

    writeOut('p2.json', out);
    await shot(window, 'p2-panel.png');
    console.log('P2 done');
  } catch (e) {
    writeOut('p2.error.txt', String(e && e.stack || e));
    console.log('P2 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
  }
})();
