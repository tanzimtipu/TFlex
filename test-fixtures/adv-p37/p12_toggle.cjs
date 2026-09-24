// Ladder vs manual toggle; unpin-all persistence; PAGES arrows reachability.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

const inspState = () => ({
  collapsed: document.querySelector('[data-inspector]') ? document.querySelector('[data-inspector]').getAttribute('data-inspector-collapsed') : null,
  appCollapsed: document.querySelector('.app-main') ? document.querySelector('.app-main').getAttribute('data-inspector-collapsed') : null,
  strip: !!document.querySelector('[data-inspector-collapsed-strip]'),
});
const panelState = () => ({
  collapsed: document.querySelector('[data-context-panel]') ? document.querySelector('[data-context-panel]').getAttribute('data-context-panel-collapsed') === 'true' : null,
  ruler: !!document.querySelector('[data-context-panel-ruler]'),
  chevronDir: document.querySelector('[data-rail-collapse]') ? document.querySelector('[data-rail-collapse]').getAttribute('data-collapse-direction') : null,
});

(async () => {
  const { app, window } = await boot({ profile: 'p12-toggle' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 1); await window.waitForTimeout(400);

    // --- inspector: manual expand while ladder engaged ---
    await setContentSize(app, 1100, 900); await sleep(700);
    out.insp1100 = await window.evaluate(inspState);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(600);
    out.insp1100AfterExpandClick = await window.evaluate(inspState);
    await setContentSize(app, 1300, 900); await sleep(700);
    out.insp1300AfterGrow = await window.evaluate(inspState);

    // --- inspector: manual collapse at wide, then shrink and grow ---
    await setContentSize(app, 1400, 900); await sleep(600);
    if (!(await window.evaluate(() => document.querySelector('[data-inspector]').getAttribute('data-inspector-collapsed') === 'true'))) {
      await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);
    }
    out.insp1400UserCollapsed = await window.evaluate(inspState);
    await setContentSize(app, 1100, 900); await sleep(600);
    out.insp1100Still = await window.evaluate(inspState);
    await setContentSize(app, 1400, 900); await sleep(600);
    out.insp1400Regrown = await window.evaluate(inspState);
    // restore expanded
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);

    // --- panel: manual expand while ladder engaged ---
    await setContentSize(app, 900, 900); await sleep(700);
    out.panel900 = await window.evaluate(panelState);
    await window.locator('[data-rail-collapse]').first().click(); await window.waitForTimeout(600);
    out.panel900AfterExpandClick = await window.evaluate(panelState);
    await setContentSize(app, 1300, 900); await sleep(700);
    out.panel1300AfterGrow = await window.evaluate(panelState);

    // --- PAGES arrows reachability at 719 ---
    await setContentSize(app, 719, 900); await sleep(700);
    await gotoStage(window, 1); await window.waitForTimeout(400);
    out.pages719 = await window.evaluate(() => {
      const sc = document.querySelector('[data-dock-scroll]');
      return { verbs: Array.from(document.querySelectorAll('[data-action-dock] [data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')), arrows: !!document.querySelector('[data-dock-arrow="right"]'), scroll: sc ? { left: sc.scrollLeft, w: sc.scrollWidth, c: sc.clientWidth } : null };
    });
    if (out.pages719.arrows) {
      await window.locator('[data-dock-arrow="right"]').first().click(); await window.waitForTimeout(600);
      out.pages719.afterRight = await window.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
      await window.locator('[data-dock-arrow="right"]').first().click(); await window.waitForTimeout(600);
      out.pages719.afterRight2 = await window.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
    }
    await shot(window, 'p12-pages-719.png');

    // --- unpin ALL pages verbs, restart ---
    await setContentSize(app, 1440, 900); await sleep(600);
    const ids = out.pages719.verbs;
    let unpinned = [];
    for (const id of ids) {
      const v = window.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first();
      if ((await v.count()) === 0) continue;
      await v.click({ button: 'right' });
      await window.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 4000 }).catch(() => {});
      const item = window.locator('[data-dock-menu] [data-dock-menu-item="unpin"]');
      if (await item.count()) { await item.first().click(); await window.waitForTimeout(350); unpinned.push(id); }
    }
    out.unpinnedAll = { tried: ids, unpinned, dock: await window.evaluate(() => ({ verbs: Array.from(document.querySelectorAll('[data-action-dock] [data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')), hasDock: !!document.querySelector('[data-action-dock]'), hint: !!document.querySelector('[data-dock-hint]'), text: (document.querySelector('[data-action-dock]') || {}).textContent })) };
    await shot(window, 'p12-unpinned-all.png');
    writeOut('p12.json', out);
    console.log('P12 done');
  } catch (e) { writeOut('p12.error.txt', String(e && e.stack || e)); console.log('P12 ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
