// Confirm the empty-tab Print silent no-op (title-bar + File>Print).
'use strict';
const { boot, openSample, shot, writeOut, sleep, safeClose } = require('./lib.cjs');

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
const stateOf = () => ({
  toasts: Array.from(document.querySelectorAll('[data-toast], .toast, [class*=toast]')).map((e) => e.textContent.trim().slice(0, 80)),
  welcome: !!document.querySelector('.welcome, [data-welcome]'),
  workspace: !!document.querySelector('.workspace'),
  titlebarPrint: (() => { const b = document.querySelector('[data-print]'); return b ? { disabled: b.disabled } : null; })(),
  tabCount: document.querySelectorAll('[data-tab], .tab').length,
  windowsHint: !!document.querySelector('[data-print-window]'),
});

(async () => {
  const { app, window } = await boot({ profile: 'p11b-empty' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    await window.locator('[data-new-tab]').first().click();
    await window.waitForTimeout(900);
    out.before = await window.evaluate(stateOf);
    // title-bar click
    const pp = Promise.race([app.waitForEvent('window'), sleep(3000).then(() => null)]);
    await window.locator('[data-print]').first().click().catch(() => {});
    const p = await pp;
    out.titlebarOpenedWindow = !!p;
    if (p) await p.close().catch(() => {});
    await window.waitForTimeout(500);
    out.afterTitlebar = await window.evaluate(stateOf);
    // menu click
    const pp2 = Promise.race([app.waitForEvent('window'), sleep(3000).then(() => null)]);
    out.menuClick = await clickMenuPrint(app);
    const p2 = await pp2;
    out.menuOpenedWindow = !!p2;
    if (p2) await p2.close().catch(() => {});
    await window.waitForTimeout(500);
    out.afterMenu = await window.evaluate(stateOf);
    await shot(window, 'p11b-empty-tab.png');
    writeOut('p11b.json', out);
    console.log('P11b done');
  } catch (e) { writeOut('p11b.error.txt', String(e && e.stack || e)); console.log('P11b ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
