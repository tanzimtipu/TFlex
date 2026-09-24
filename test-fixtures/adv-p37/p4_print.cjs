// Phase-37 item 17 - print removal: standalone window via every entry point.
'use strict';
const { boot, openSample, shot, writeOut, sleep } = require('./lib.cjs');

async function winCount(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}
async function printWindowCount(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('tfWindow=print')).length);
}

(async () => {
  const { app, window } = await boot({ profile: 'p4-print' });
  const out = {};
  try {
    // A. welcome - no document
    out.a_titlebarDisabled = await window.evaluate(() => {
      const b = document.querySelector('[data-print]');
      return b ? { disabled: b.disabled, aria: b.getAttribute('aria-label') } : null;
    });
    // File menu print entry
    await window.locator('[data-menu-button]').first().click();
    await window.waitForTimeout(300);
    out.a_menu = await window.evaluate(() => {
      const el = document.querySelector('[data-menu-action="print"]');
      if (!el) return { present: false };
      return { present: true, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', text: el.textContent.trim() };
    });
    await shot(window, 'p4-welcome-menu.png');
    await window.keyboard.press('Escape');

    // B. open doc, title-bar print -> standalone
    await openSample(app, window, 'report.pdf');
    out.noDialogBefore = await window.evaluate(() => !!document.querySelector('[data-print-dialog], [data-print-dialog-shell]'));
    const pagePromise = app.waitForEvent('window');
    await window.click('[data-print]');
    const printPage = await pagePromise;
    await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
    out.b = {
      windows: await winCount(app),
      printWindows: await printWindowCount(app),
      printWindowPresent: await printPage.evaluate(() => !!document.querySelector('[data-print-window]')),
      noDialogInMain: await window.evaluate(() => !document.querySelector('[data-print-dialog], [data-print-dialog-shell]')),
      noDialogInPrint: await printPage.evaluate(() => !document.querySelector('[data-print-dialog], [data-print-dialog-shell]')),
    };
    await shot(printPage, 'p4-standalone.png');

    // C. click print again -> singleton focus (still one print window)
    const pagePromise2 = Promise.race([app.waitForEvent('window'), sleep(2500).then(() => null)]);
    await window.click('[data-print]');
    const second = await pagePromise2;
    out.c = {
      secondWindowOpened: !!second,
      windows: await winCount(app),
      printWindows: await printWindowCount(app),
    };

    // D. close the document while the print window is open
    await window.keyboard.press('Control+w');
    await window.waitForTimeout(1500);
    out.d = {
      printGone: await printPage.evaluate(() => !!document.querySelector('[data-print-document-gone]')).catch(() => 'page-closed'),
      titlebarPrintDisabled: await window.evaluate(() => {
        const b = document.querySelector('[data-print]');
        return b ? b.disabled : 'no-button';
      }),
      welcome: await window.evaluate(() => !!document.querySelector('.welcome, [data-welcome]')),
    };
    // printing again with no doc: button disabled; File>Print disabled
    await window.locator('[data-menu-button]').first().click();
    await window.waitForTimeout(300);
    out.d.menuPrintDisabled = await window.evaluate(() => {
      const el = document.querySelector('[data-menu-action="print"]');
      return el ? (el.disabled === true || el.getAttribute('aria-disabled') === 'true') : 'absent';
    });
    await window.keyboard.press('Escape');

    // close the standalone window
    await printPage.close().catch(() => {});
    await sleep(500);

    // E. print while another dialog (Preferences) is up, via the File menu
    await openSample(app, window, 'report.pdf');
    await window.keyboard.press('Control+,');
    await window.waitForTimeout(700);
    out.e = { prefsOpen: await window.evaluate(() => !!document.querySelector('[data-preferences], [data-prefs], .sheet-backdrop')) };
    // menu may be under the sheet; try the native menu accelerator path instead
    let winFired = false;
    const pp3 = Promise.race([app.waitForEvent('window'), sleep(3000).then(() => null)]);
    try {
      await app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        const walk = (items) => {
          for (const it of items) {
            if (it.accelerator && /CmdOrCtrl\+P$/i.test(it.accelerator)) { it.click(); return true; }
            if (it.submenu) { if (walk(it.submenu.items)) return true; }
          }
          return false;
        };
        walk(menu.items);
      });
    } catch (err) { out.e.menuError = String(err && err.message || err); }
    const p3 = await pp3;
    winFired = !!p3;
    out.e.acceleratorOpened = winFired;
    if (p3) { await p3.waitForSelector('[data-print-window]', { timeout: 20000 }).catch(() => {}); out.e.printWindowPresent = await p3.evaluate(() => !!document.querySelector('[data-print-window]')).catch(() => false); await p3.close().catch(() => {}); }
    await window.keyboard.press('Escape');

    writeOut('p4.json', out);
    console.log('P4 done');
  } catch (e) {
    writeOut('p4.error.txt', String(e && e.stack || e));
    console.log('P4 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
  }
})();
