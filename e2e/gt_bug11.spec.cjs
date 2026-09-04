const { test } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 11 — crop "per page" crops every page', () => {
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

  test('per-page crop should affect ONLY the selected page', async () => {
    await firstWindow.click('[data-tools-toggle]');
    await firstWindow.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await firstWindow.click('[data-tool-id="cropPages"]');
    await firstWindow.waitForSelector('[data-crop-mode="perPage"]', { timeout: 10000 });
    await firstWindow.waitForTimeout(1000);
    // BASELINE: measure main page sizes BEFORE cropping
    const beforePages = await firstWindow.evaluate(() => {
      const els = [...document.querySelectorAll('.pdf-page[data-page]')];
      return els.slice(0, 3).map(e => {
        const r = e.getBoundingClientRect();
        return { dataPage: e.getAttribute('data-page'), w: Math.round(r.width), h: Math.round(r.height), sf: e.style.getPropertyValue('--scale-factor') };
      });
    });
    console.log('MAIN page sizes BEFORE crop:', JSON.stringify(beforePages, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b11_dialog_allpages.png' });

    // Switch to per-page
    await firstWindow.click('[data-crop-mode="perPage"]');
    await firstWindow.waitForTimeout(1000);
    await firstWindow.screenshot({ path: 'screenshots/gt_b11_dialog_perpage.png' });

    // Find the crop-editor preview + SE handle
    const se = firstWindow.locator('[data-crop-handle="se"]');
    const seBox = await se.boundingBox();
    console.log('SE crop handle box:', JSON.stringify(seBox));
    if (seBox) {
      // Drag SE handle inward (shrink the crop box) by 120px x, 120px y
      await firstWindow.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
      await firstWindow.mouse.down();
      await firstWindow.mouse.move(seBox.x + seBox.width / 2 - 120, seBox.y + seBox.height / 2 - 120, { steps: 12 });
      await firstWindow.mouse.up();
      await firstWindow.waitForTimeout(500);
      await firstWindow.screenshot({ path: 'screenshots/gt_b11_crop_rect.png' });
    }

    // Read the crop summary box
    const summary = await firstWindow.evaluate(() => {
      const rows = [...document.querySelectorAll('.crop-summary-row')];
      const obj = {};
      rows.forEach(r => { const label = r.querySelector('.crop-summary-label')?.textContent; const val = r.querySelector('.crop-summary-value')?.textContent; if (label) obj[label] = val; });
      const label = document.querySelector('.crop-editor-label, [class*=crop] h3, .crop-editor *')?.textContent;
      return { rect: obj, labelOverlay: document.querySelector('.crop-editor, .crop-editor-wrap')?.textContent?.slice(0,40) };
    });
    console.log('Crop summary:', JSON.stringify(summary));

    // Apply
    await firstWindow.click('[data-crop-confirm]');
    await firstWindow.waitForTimeout(2500);
    const after = await firstWindow.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast, .toast-info, .toast-error')].map(t => ({ cls: t.className, text: t.textContent })),
    }));
    console.log('After applying per-page crop:', JSON.stringify(after, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b11_after_crop.png' });

    // Measure the rendered MAIN page sizes for page 1 vs page 2/3. If per-page
    // crop worked, page 1 renders at a different (taller, smaller) size than
    // unadjusted pages. If the bug is present, ALL pages render at the cropped size.
    const pages = await firstWindow.evaluate(() => {
      const els = [...document.querySelectorAll('.pdf-page[data-page]')];
      return els.slice(0, 6).map(e => {
        const r = e.getBoundingClientRect();
        return { dataPage: e.getAttribute('data-page'), w: Math.round(r.width), h: Math.round(r.height), style: e.getAttribute('style') };
      });
    });
    console.log('MAIN page sizes after per-page crop:', JSON.stringify(pages, null, 2));
    // Re-open the crop dialog to inspect per-page editor sizes (activePageSizes cache)
    let palette = await firstWindow.$('[data-tools-palette]');
    if (!palette) { await firstWindow.click('[data-tools-toggle]'); await firstWindow.waitForSelector('[data-tools-palette]', { timeout: 10000 }); }
    await firstWindow.click('[data-tool-id="cropPages"]');
    await firstWindow.waitForSelector('[data-crop-mode="perPage"]', { timeout: 10000 });
    await firstWindow.waitForTimeout(800);
    // The crop editor label + crop summary for the currently-suggested page
    const editorInfo = await firstWindow.evaluate(() => {
      const label = document.querySelector('.crop-editor-label, .crop-editor h3, .crop-editor-wrap [class*=page]')?.textContent;
      const summaryText = document.querySelector('[aria-label="Crop summary"]')?.textContent;
      const editorPage = document.querySelector('[data-crop-editor-page], [data-page="1"]')?.getAttribute('data-crop-editor-page');
      return { label, summaryText: summaryText?.slice(0, 120) };
    });
    console.log('Reopened crop dialog editor info:', JSON.stringify(editorInfo));
    await firstWindow.screenshot({ path: 'screenshots/gt_b11_reopen.png' });
  });
});
