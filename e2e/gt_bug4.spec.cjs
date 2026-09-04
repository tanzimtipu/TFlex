const { test } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 4 — OCR suspects top bar layout', () => {
  let electronApp, firstWindow;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    await firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'scanned.pdf' }) }).click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
  });

  test.afterAll(async () => { if (electronApp) await hardClose(electronApp); });

  test('run OCR and inspect suspects panel layout', async () => {
    test.setTimeout(240000);
    // Open tools palette
    await firstWindow.click('[data-tools-toggle]');
    await firstWindow.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await firstWindow.screenshot({ path: 'screenshots/gt_b4_palette.png' });
    // Click Recognize text (OCR)
    const ocrBtn = firstWindow.locator('[data-tool-id="recognizeText"]');
    console.log('OCR button count:', await ocrBtn.count());
    await ocrBtn.click();
    await firstWindow.waitForSelector('.modal-dialog', { timeout: 10000 });
    await firstWindow.screenshot({ path: 'screenshots/gt_b4_ocr_dialog.png' });
    // Scope to the CURRENT page only to keep the OCR run fast.
    await firstWindow.click('[data-ocr-scope="currentPage"]');
    await firstWindow.waitForTimeout(300);
    // Confirm (current page)
    await firstWindow.click('[data-ocr-confirm]');
    // Wait for the OCR dialog to close (running then done)
    await firstWindow.waitForTimeout(5000);
    // Wait for suspects panel
    try {
      await firstWindow.waitForSelector('[data-ocr-suspects-panel]', { timeout: 90000 });
      console.log('Suspects panel appeared.');
    } catch (e) {
      console.log('Suspects panel did NOT appear.');
    }
    await firstWindow.waitForTimeout(1000);
    await firstWindow.screenshot({ path: 'screenshots/gt_b4_ocr_full.png' });

    // Measure layout
    const layout = await firstWindow.evaluate(() => {
      const panel = document.querySelector('[data-ocr-suspects-panel]');
      const rail = document.querySelector('.side-rail');
      const palette = document.querySelector('[data-tools-palette]');
      const appMain = document.querySelector('.app-main');
      const toolbar = document.querySelector('.toolbar, [data-toolbar]');
      const annToolbar = document.querySelector('.ann-toolbar, [data-ann-toolbar]');
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
      return {
        panel: r(panel),
        rail: r(rail),
        palette: r(palette),
        appMain: r(appMain),
        toolbar: r(toolbar),
        annToolbar: r(annToolbar),
        panelStyle: panel ? { pos: getComputedStyle(panel).position, top: getComputedStyle(panel).top, left: getComputedStyle(panel).left, zIndex: getComputedStyle(panel).zIndex, bg: getComputedStyle(panel).backgroundColor } : null,
        otherSurfaces: [...document.querySelectorAll('.app-main > *')].map(e => ({ cls: e.className, y: r(e)?.y, h: r(e)?.h })),
      };
    });
    console.log('Layout:', JSON.stringify(layout, null, 2));
  });
});
