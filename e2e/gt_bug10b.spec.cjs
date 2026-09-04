const { test } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 10 thorough — full rail after blank insert', () => {
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

  test.afterAll(async () => { if (electronApp) await hardClose(electronApp); });

  test('insert blank after page 1 -> dump FULL rail', async () => {
    const before = await firstWindow.evaluate(() => tflexDiagnostics()?.engineState?.pageCount);
    console.log('pageCount before:', before);
    // open insert dialog
    let palette = await firstWindow.$('[data-tools-palette]');
    if (!palette) { await firstWindow.click('[data-tools-toggle]'); await firstWindow.waitForSelector('[data-tools-palette]', { timeout: 10000 }); }
    await firstWindow.click('[data-tool-id="insertPages"]');
    await firstWindow.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
    await firstWindow.click('[data-insert-mode="blank"]');
    await firstWindow.waitForTimeout(200);
    await firstWindow.fill('[data-insert-position]', '2');
    await firstWindow.waitForTimeout(200);
    await firstWindow.click('[data-insert-confirm]');
    await firstWindow.waitForTimeout(3000);
    const after = await firstWindow.evaluate(() => tflexDiagnostics()?.engineState?.pageCount);
    console.log('pageCount after:', after);

    // Dump ALL thumbs: data-page, source-page, label
    const thumbs = await firstWindow.evaluate(() => {
      const els = [...document.querySelectorAll('.side-rail .thumb-item, .side-rail [data-source-page]')];
      return els.map(e => ({
        cls: e.className,
        dataPage: e.getAttribute('data-page'),
        sourcePage: e.getAttribute('data-source-page'),
        label: e.querySelector('[class*=label]')?.textContent ?? e.getAttribute('data-source-page'),
      }));
    });
    // de-dup sourcePages
    const sourcePages = thumbs.map(t => t.sourcePage);
    const uniq = [...new Set(sourcePages)];
    console.log('total thumbs:', thumbs.length, 'unique sourcePages:', uniq.length);
    console.log('duplicate sourcePages?', sourcePages.length !== uniq.length ? JSON.stringify(sourcePages.filter((v,i,a)=>a.indexOf(v)!==i)) : 'NONE');
    // Look for any label "Page 17" or label containing "17"
    const page17 = thumbs.filter(t => (t.label||'').includes('17'));
    console.log('thumbs with label containing "17":', JSON.stringify(page17));
    console.log('first 8 thumbs:', JSON.stringify(thumbs.slice(0,8), null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b10_full_rail.png' });
  });
});
