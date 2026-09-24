// Phase-37 item 17 follow-ups: menu gate, dialog coexistence, empty-tab edge, hint.
'use strict';
const { boot, openSample, shot, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

async function menuPrintEnabled(app) {
  return app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const it = m ? m.getMenuItemById('menu.print') : null;
    return it ? { enabled: it.enabled, label: it.label, accelerator: it.accelerator } : null;
  });
}
async function clickMenuPrint(app) {
  return app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const it = m ? m.getMenuItemById('menu.print') : null;
    if (!it) return 'no-item';
    if (!it.enabled) return 'disabled';
    it.click();
    return 'clicked';
  });
}

(async () => {
  const { app, window } = await boot({ profile: 'p11-print2' });
  const out = {};
  try {
    // menu gate with no doc
    out.menuNoDoc = await menuPrintEnabled(app);
    // open doc
    await openSample(app, window, 'report.pdf');
    out.menuWithDoc = await menuPrintEnabled(app);
    // hint
    await gotoStage(window, 4); await window.waitForTimeout(400);
    out.hint = await window.evaluate(() => {
      const h = document.querySelector('[data-dock-hint]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const d = document.querySelector('[data-action-dock]').getBoundingClientRect();
      return { text: h.textContent.replace(/\s+/g, ' ').trim(), above: r.bottom <= d.top + 1, x: Math.round(r.x), y: Math.round(r.y) };
    });

    // open an in-app dialog (Merge) then fire the native print menu item
    const merge = window.locator('[data-context-panel-combine], [data-dock-verb="merge"]');
    if (await merge.count()) { await merge.first().click(); await window.waitForTimeout(900); }
    out.dialogUp = await window.evaluate(() => !!document.querySelector('.modal-dialog, [role=dialog][aria-modal=true], .sheet-backdrop'));
    const pp = Promise.race([app.waitForEvent('window'), sleep(4000).then(() => null)]);
    out.menuClickResult = await clickMenuPrint(app);
    const p = await pp;
    out.printOpenedOverDialog = !!p;
    if (p) {
      await p.waitForSelector('[data-print-window]', { timeout: 20000 }).catch(() => {});
      out.printWindowPresent = await p.evaluate(() => !!document.querySelector('[data-print-window]')).catch(() => false);
      out.dialogStillUp = await window.evaluate(() => !!document.querySelector('.modal-dialog, [role=dialog][aria-modal=true], .sheet-backdrop'));
      await shot(p, 'p11-print-over-dialog.png');
      await p.close().catch(() => {});
      await sleep(500);
    }
    await window.keyboard.press('Escape'); await window.waitForTimeout(500);

    // empty placeholder tab active while a doc is open
    await window.locator('[data-new-tab]').first().click();
    await window.waitForTimeout(900);
    out.emptyTab = await window.evaluate(() => ({
      activeIsEmpty: !document.querySelector('.workspace') || !!document.querySelector('.empty-tab, [data-empty-tab]'),
      welcome: !!document.querySelector('.welcome, [data-welcome]'),
      titlebarPrintDisabled: (() => { const b = document.querySelector('[data-print]'); return b ? b.disabled : 'no-button'; })(),
    }));
    out.menuOnEmptyTab = await menuPrintEnabled(app);
    const pp2 = Promise.race([app.waitForEvent('window'), sleep(3500).then(() => null)]);
    out.menuClickOnEmptyTab = await clickMenuPrint(app);
    const p2 = await pp2;
    out.emptyTabPrintOpened = !!p2;
    if (p2) { await p2.close().catch(() => {}); }

    writeOut('p11.json', out);
    console.log('P11 done');
  } catch (e) { writeOut('p11.error.txt', String(e && e.stack || e)); console.log('P11 ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
