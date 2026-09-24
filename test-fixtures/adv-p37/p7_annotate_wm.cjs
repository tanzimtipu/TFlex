// Phase-37 items 1,20 + dock availability / fail-loud table.
'use strict';
const { boot, openSample, shot, writeOut, sleep, gotoStage } = require('./lib.cjs');

async function scrollToPage(window, n) {
  for (let i = 0; i < 60; i++) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      const slot = document.querySelector(`.page-slot[data-page="${want}"], .pdf-page[data-page="${want}"]`);
      if (!sc) return true;
      if (slot) { sc.scrollTop = slot.offsetTop - 80; return true; }
      sc.scrollTop += 1200; return false;
    }, n);
    await window.waitForTimeout(200); if (done) break;
  }
  await window.waitForTimeout(900);
}
function dockTable(window) {
  return window.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (!dock) return { dock: false };
    const btns = Array.from(dock.querySelectorAll('[data-dock-verb]'));
    return {
      dock: true,
      state: dock.getAttribute('data-dock-state'),
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      verbs: btns.map((b) => ({
        id: b.getAttribute('data-dock-verb'),
        disabled: b.disabled === true,
        title: b.getAttribute('title'),
        visible: b.getBoundingClientRect().width > 0,
      })),
    };
  });
}
function inspSnap(window) {
  return window.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    if (!insp) return { present: false };
    const body = document.querySelector('.inspector-body');
    const tp = document.querySelector('[data-inspector-text-panel]');
    return {
      present: true,
      selection: insp.getAttribute('data-inspector-selection'),
      collapsed: insp.getAttribute('data-inspector-collapsed'),
      textPanelPresent: !!tp,
      textPanelIsFirst: body ? (body.firstElementChild && body.firstElementChild.matches('[data-inspector-text-panel]')) : false,
      divider: !!document.querySelector('[data-inspector-divider]'),
      slots: Array.from(document.querySelectorAll('[data-inspector-slot]')).map((e) => e.getAttribute('data-inspector-slot')),
      headerText: (document.querySelector('.inspector-header') || {}).textContent || null,
    };
  });
}

(async () => {
  const { app, window } = await boot({ profile: 'p7-wm' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    // availability table per stage
    out.tables = {};
    for (const n of [1, 2, 3, 4]) {
      await gotoStage(window, n);
      await window.waitForTimeout(400);
      out.tables[n] = await dockTable(window);
    }
    // item 20: watermark with doc
    await gotoStage(window, 3); await window.waitForTimeout(400);
    out.watermarkWithDoc = (out.tables[3].verbs || []).find((v) => v.id === 'watermark');

    // annotate flow: flyout + textbox (dropdown fallback) + select + inspector
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    await window.waitForTimeout(400);
    out.flyout = await window.evaluate(() => ({ present: !!document.querySelector('[data-annotation-flyout]'), visibleTools: Array.from(document.querySelectorAll('[data-ann-tools-visible] button[data-tool]')).map((b) => b.getAttribute('data-tool')), hasDropdown: !!document.querySelector('[data-ann-dropdown-toggle]') }));
    let armed = false;
    const visTb = window.locator('[data-ann-tools-visible] button[data-tool="textbox"]');
    if (await visTb.count()) { await visTb.first().click(); armed = true; }
    else if (await window.locator('[data-ann-dropdown-toggle]').count()) {
      await window.click('[data-ann-dropdown-toggle]');
      await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 }).catch(() => {});
      const item = window.locator('[data-ann-dropdown-menu] button[data-tool="textbox"]');
      if (await item.count()) { await item.first().click(); armed = true; await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 5000 }).catch(() => {}); }
    }
    out.armedTextbox = armed;
    if (armed) {
      await window.waitForTimeout(300);
      await scrollToPage(window, 1);
      const geo = await window.evaluate(() => { const s = document.querySelector('.page-slot[data-page="1"], .pdf-page[data-page="1"]'); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await window.mouse.move(geo.x + 120, geo.y + 220);
      await window.mouse.down();
      await window.mouse.move(geo.x + 380, geo.y + 270, { steps: 12 });
      await window.mouse.up();
      await window.waitForTimeout(900);
      out.placeBar = await window.evaluate(() => {
        const bar = document.querySelector('.ann-content-action, [data-content-action-bar^="ann-"]');
        if (!bar) return null;
        return { dataBar: bar.getAttribute('data-content-action-bar'), actions: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => b.getAttribute('data-content-action')), hasColor: !!bar.querySelector('.ann-color-box, [data-ann-color-box], [data-color-box], [class*=color]') };
      });
      out.inspAfterPlace = await inspSnap(window);
      await shot(window, 'p7-annotate-place.png');
      const confirm = window.locator('[data-content-action$="-confirm"]');
      if (await confirm.count()) { await confirm.first().click(); await window.waitForTimeout(800); }
      // click the annotation to select
      await window.mouse.click(geo.x + 220, geo.y + 245);
      await window.waitForTimeout(700);
      out.inspAfterSelect = await inspSnap(window);
      out.selBar = await window.evaluate(() => {
        const bar = document.querySelector('.ann-content-action, [data-content-action-bar^="ann-"]');
        if (!bar) return null;
        return { dataBar: bar.getAttribute('data-content-action-bar'), actions: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => b.getAttribute('data-content-action')), hasColor: !!bar.querySelector('.ann-color-box, [data-ann-color-box], [data-color-box], [class*=color]') };
      });
      await shot(window, 'p7-annotate-select.png');
    }
    writeOut('p7.json', out);
    console.log('P7 done');
  } catch (e) {
    writeOut('p7.error.txt', String(e && e.stack || e));
    console.log('P7 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
    process.exit(0);
  }
})();
