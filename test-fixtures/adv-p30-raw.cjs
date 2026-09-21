// ADV P30 attack 4b: raw degenerate MediaBox pages through the print preview.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  for (const f of ['adv-zero-mediabox.pdf', 'adv-negative-mediabox.pdf', 'adv-huge-mediabox.pdf']) {
    const t0 = Date.now();
    try {
      await openSamplePath(win, app, path.join(ROOT, 'test-fixtures', f));
      await win.waitForSelector('.pdf-page canvas', { timeout: 40000 });
      await win.waitForTimeout(600);
      const diag = await win.evaluate(() => window.tflexDiagnostics());
      await win.click('[data-print]');
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      const seen = await win.waitForSelector('[data-print-preview] img', { timeout: 40000 }).then(() => true).catch(() => false);
      await win.waitForTimeout(1000);
      const info = await win.evaluate(() => {
        const img = document.querySelector('[data-print-preview] img');
        const sheet = document.querySelector('[data-print-preview-sheet]');
        return {
          nw: img ? img.naturalWidth : null,
          nh: img ? img.naturalHeight : null,
          landscape: sheet ? sheet.getAttribute('data-landscape') : null,
          meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent,
        };
      });
      console.log(`RAW ${f}: ms=${Date.now() - t0} pageCount=${diag.pageCount} previewSeen=${seen} ${JSON.stringify(info)} errors=${JSON.stringify(pageErrors.slice(-3))}`);
      await win.click('[data-print-cancel]');
      await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      await win.locator('[data-tab-id] button.tab-close').first().click({ timeout: 8000 }).catch(() => {});
      await win.waitForTimeout(400);
    } catch (e) {
      console.log(`RAW ${f}: THREW ${e.message}`);
      await win.click('[data-print-cancel]').catch(() => {});
      await win.waitForTimeout(300);
    }
  }
  console.log('PAGE_ERRORS', JSON.stringify(pageErrors));
  await hardClose(app, 'adv-p30-raw');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });