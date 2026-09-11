// qa probe 6: About update row over 12s (stuck "Checking..."?); also re-inject
// update status WHILE the dialog is open.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

test.describe('QA redesign probe 6', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.app', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('About update row timeline', async () => {
    test.setTimeout(120000);
    // Inject BEFORE open (the DEF-077 suite's order)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:statusChanged', { kind: 'available', version: '1.6.0', releaseDate: '2026-08-31' });
    });
    await electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      const help = m.items.find(i => (i.label || '').replace('&', '').includes('Help'));
      help.submenu.items.find(i => (i.label || '').replace('&', '').includes('About')).click();
    });
    for (let t = 0; t <= 12; t += 3) {
      await window.waitForTimeout(3000);
      const s = await window.evaluate(() => {
        const el = document.querySelector('[data-about-update]');
        const ind = document.querySelector('[data-update-indicator]');
        return {
          row: el ? el.textContent : null,
          kind: el ? el.getAttribute('data-about-update-kind') : null,
          indicator: ind ? `${ind.getAttribute('data-update-indicator-kind')}:${(ind.textContent || '').trim().slice(0, 30)}` : null,
        };
      });
      console.log(`ABOUT t+${t + 3}s:`, JSON.stringify(s));
    }

    // Inject WHILE open
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:statusChanged', { kind: 'available', version: '1.6.1', releaseDate: '2026-08-31' });
    });
    await window.waitForTimeout(1500);
    const s2 = await window.evaluate(() => {
      const el = document.querySelector('[data-about-update]');
      return { row: el ? el.textContent : null, kind: el ? el.getAttribute('data-about-update-kind') : null };
    });
    console.log('ABOUT-INJECT-WHILE-OPEN:', JSON.stringify(s2));
  });
});