// DEF-167 evidence: Extract("1") lands page 2 silently; Extract("34") errors.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'marker-3pages.pdf');

test('def167 evidence: extract wrong page + last-page error screenshots', async () => {
  test.setTimeout(150000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 10000 });
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, FIXTURE);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 15000 });
    await win.waitForTimeout(1500);

    const activeMarker = async () => win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const tl = pane ? pane.querySelector('.pdf-page .textLayer') : null;
      const m = (tl ? tl.textContent : '').match(/MARKER-PAGE-(\d)/);
      return m ? `MARKER-PAGE-${m[1]}` : '(no marker)';
    });

    console.log('[def167] source shows:', await activeMarker());

    // Extract page "1" (default Extract mode)
    await win.click('[data-tools-toggle]');
    await win.click('[data-tool-id="split"]');
    await win.waitForSelector('.dialog');
    await win.fill('.dialog .modal-input', '1');
    await win.click('.dialog button.btn-primary');
    await win.waitForTimeout(2500);
    console.log('[def167] extracted doc shows:', await activeMarker(), '(expected MARKER-PAGE-1)');
    await win.screenshot({ path: 'screenshots/def-167-extract-1-lands-page-2.png' });

    // Back to the source tab: extract "34" (last page of the 3-page fixture,
    // equivalent of "3") -> out-of-bounds error toast
    await win.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab, [role="tab"]'));
      tabs[0].click();
    });
    await win.waitForTimeout(900);
    await win.click('[data-tools-toggle]');
    const palOpen = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
    if (!palOpen) {
      await win.click('[data-tools-toggle]');
      await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    }
    await win.click('[data-tool-id="split"]');
    await win.waitForSelector('.dialog');
    await win.fill('.dialog .modal-input', '3');
    await win.click('.dialog button.btn-primary');
    await win.waitForTimeout(2000);
    const toast = await win.evaluate(() => document.querySelector('.toast')?.textContent || null);
    console.log('[def167] extract("3" = last page) toast:', JSON.stringify(toast));
    await win.screenshot({ path: 'screenshots/def-167-extract-last-page-error.png' });

    await hardClose(electronApp);
  } catch (err) {
    console.log('[def167] FAILED:', err.message);
    await hardClose(electronApp);
    throw err;
  }
});