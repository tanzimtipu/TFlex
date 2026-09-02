const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 7 — close unsaved sample tab', () => {
  let electronApp, firstWindow;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    await firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'report.pdf' }) }).click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
  });

  test.afterAll(async () => { if (electronApp) await electronApp.close(); });

  test('modify a sample tab then close it -> prompt Save behavior', async () => {
    // Make the doc modified: rotate a page
    await firstWindow.click('[data-toolbar-rotate-cw]');
    await firstWindow.waitForTimeout(800);
    const mod = await firstWindow.evaluate(() => (typeof tflexDiagnostics === 'function' ? tflexDiagnostics() : null));
    fs_write('screenshots/gt_b7_diag_modified.json', mod);
    console.log('modified?', mod?.engineState?.modified, 'pageCount', mod?.engineState?.pageCount);

    // Close the tab
    await firstWindow.click('.tab-close');
    await firstWindow.waitForTimeout(600);
    const promptState = await firstWindow.evaluate(() => {
      const dlg = document.querySelector('.close-tab-prompt, [data-close-prompt]');
      const backdrop = document.querySelector('.modal-backdrop');
      const bodyText = dlg ? dlg.textContent : (backdrop ? backdrop.textContent : '');
      return {
        promptPresent: !!dlg,
        bodyText: bodyText.slice(0, 300),
        buttons: [...document.querySelectorAll('[data-close-prompt-action]')].map(b => ({ action: b.getAttribute('data-close-prompt-action'), text: b.textContent })),
      };
    });
    console.log('Close tab prompt:', JSON.stringify(promptState, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b7_prompt.png' });

    // Click SAVE
    const saveBtn = firstWindow.locator('[data-close-prompt-action="save"]');
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await firstWindow.waitForTimeout(1500);
      const afterSave = await firstWindow.evaluate(() => ({
        promptStillOpen: !!document.querySelector('[data-close-prompt]'),
        toasts: [...document.querySelectorAll('.toast, .toast-error')].map(t => ({ cls: t.className, text: t.textContent })),
        modalOpen: !!document.querySelector('.modal-backdrop'),
      }));
      console.log('After clicking Save on unsaved sample:', JSON.stringify(afterSave, null, 2));
      await firstWindow.screenshot({ path: 'screenshots/gt_b7_after_save.png' });
    } else {
      console.log('No Save button found in prompt.');
    }
  });
});

function fs_write(p, data) {
  const fs = require('node:fs');
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}
