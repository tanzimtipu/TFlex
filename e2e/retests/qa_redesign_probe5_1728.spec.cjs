// qa probe 5: REAL UI paths — form widget fill and Sign tool placement — and
// whether they converge the diagnostics mirror (modified) + enable Save.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

test.describe('QA redesign probe 5', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('UI form fill converges mirror', async () => {
    test.setTimeout(120000);
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForSelector('[data-form-field]', { timeout: 15000 });

    const fieldInfo = await window.evaluate(() => {
      const f = document.querySelector('[data-form-field]');
      return { id: f.getAttribute('data-form-field'), tag: f.tagName, cls: f.className };
    });
    console.log('FIELD:', JSON.stringify(fieldInfo));

    await window.fill(`[data-form-field="${fieldInfo.id}"]`, 'QA UI VALUE');
    await window.waitForTimeout(2000); // 500ms debounce + getState sync

    const after = await window.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => /Save/.test(b.getAttribute('aria-label') || '') && !/As/.test(b.getAttribute('aria-label') || ''));
      return {
        saveDisabled: saveBtn ? saveBtn.disabled : null,
        diagModified: window.tflexDiagnostics().modified,
      };
    });
    console.log('AFTER-UI-FILL:', JSON.stringify(after));
  });

  test('Sign tool UI flow', async () => {
    test.setTimeout(120000);
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(800);

    await window.click('button[aria-label="Sign tool"]');
    await window.waitForTimeout(700);
    const modal = await window.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => /signature|draw|type|saved|use this/i.test(t)).slice(0, 12);
      const dlg = document.querySelector('[class*=sign]');
      return { btns: btns.map(t => t.slice(0, 40)), dlgClass: dlg ? dlg.className : null };
    });
    console.log('SIGN-MODAL:', JSON.stringify(modal, null, 1));
  });
});