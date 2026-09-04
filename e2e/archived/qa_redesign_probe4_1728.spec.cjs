// qa probe 4: About from welcome (no doc open) via native menu + via custom
// titlebar menu; Save button enablement after a direct engine form fill.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

test.describe('QA redesign probe 4', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('About from welcome screen', async () => {
    test.setTimeout(120000);
    await window.waitForSelector('.app', { timeout: 15000 });

    await electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      const help = m.items.find(i => (i.label || '').replace('&', '').includes('Help'));
      const about = help.submenu.items.find(i => (i.label || '').replace('&', '').includes('About'));
      about.click();
    });
    await window.waitForTimeout(1500);
    const s1 = await window.evaluate(() => ({
      dlg: !!document.querySelector('[data-about-dialog]'),
      visible: (() => { const el = document.querySelector('[data-about-dialog]'); return el ? !!el.offsetParent : false; })(),
    }));
    console.log('ABOUT-FROM-WELCOME-MENU:', JSON.stringify(s1));

    // close it if open, then try the custom titlebar menu button
    await window.keyboard.press('Escape');
    await window.waitForTimeout(400);
    await window.click('button:has-text("Application menu")');
    await window.waitForTimeout(700);
    const popup = await window.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('[role=menu], [class*=menu-popup], [class*=menu-], [class*=popover]'));
      return menus.slice(0, 10).map(el => ({ cls: (el.className || '').slice(0, 60), text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 150) }));
    });
    console.log('CUSTOM-MENU-POPUP:', JSON.stringify(popup, null, 1));
    const aboutItem = window.locator('[role=menuitem]:has-text("About")');
    if (await aboutItem.count()) {
      await aboutItem.first().click();
      await window.waitForTimeout(1000);
      const s2 = await window.evaluate(() => ({
        dlg: !!document.querySelector('[data-about-dialog]'),
        visible: (() => { const el = document.querySelector('[data-about-dialog]'); return el ? !!el.offsetParent : false; })(),
      }));
      console.log('ABOUT-VIA-CUSTOM-MENU:', JSON.stringify(s2 = s2 || null));
    } else {
      console.log('CUSTOM-MENU: no [role=menuitem] About item found');
    }
  });

  test('Save button state after direct engine fill', async () => {
    test.setTimeout(120000);
    const { getSamplePath } = require('../lib/launch.cjs');
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1200);

    const before = await window.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/.test(b.getAttribute('aria-label') || '') && !/As/.test(b.getAttribute('aria-label') || ''));
      return { saveDisabled: saveBtn ? saveBtn.disabled : null, diagModified: window.tflexDiagnostics().modified };
    });
    console.log('SAVE-BEFORE-FILL:', JSON.stringify(before));

    await window.evaluate(async () => {
      const diag = window.tflexDiagnostics();
      const id = diag.engineDocId;
      const fieldsRes = await window.tflex.engine.getFormFields(id);
      const fields = fieldsRes.value || fieldsRes;
      await window.tflex.engine.fillFormField(id, { id: fields[0].id, value: 'QA Value' });
    });
    await window.waitForTimeout(1500);

    const after = await window.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/.test(b.getAttribute('aria-label') || '') && !/As/.test(b.getAttribute('aria-label') || ''));
      return { saveDisabled: saveBtn ? saveBtn.disabled : null, diagModified: window.tflexDiagnostics().modified };
    });
    console.log('SAVE-AFTER-FILL:', JSON.stringify(after));
  });
});