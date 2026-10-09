// TFL-1260 (Phase 120 F, phase-close QA) - live retest of DEF-650 (duplicate-page
// merge disclosure in the consequence summary) and confirmation of DEF-649
// (dark-theme preview cell is paper white) on the final build, in the real
// standalone "Print - Jovrel" window via the canonical e2e/lib/launch.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const {
  openSamplePath,
  openStandalonePrintWindow,
  hardClose,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const REPORT = path.resolve(__dirname, '..', 'test-fixtures', 'report.pdf');
const DISCLOSURE = '(duplicate page numbers merged)';

async function openFixture(win, app) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

test('TFL-1260 DEF-650/DEF-649 live retest: disclosure copy + paper-white dark cell', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app);
    const printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await printPage.waitForTimeout(400);

    // --- DEF-650: repeated page number is disclosed. ---
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1,1,3');
    await printPage.waitForTimeout(250);
    const merged = (await printPage.textContent('[data-print-summary-pages]')).trim();
    console.log(`[TFL1260] summary for "1,1,3" = ${JSON.stringify(merged)}`);
    expect(merged, 'repeated page discloses the merge').toContain(DISCLOSURE);
    expect(merged, 'merged copy names the resolved set').toContain('1, 3 of 34');

    // --- DEF-650: a distinct set carries no disclosure. ---
    await printPage.fill('[data-print-range-input]', '1,3');
    await printPage.waitForTimeout(250);
    const plain = (await printPage.textContent('[data-print-summary-pages]')).trim();
    console.log(`[TFL1260] summary for "1,3" = ${JSON.stringify(plain)}`);
    expect(plain, 'distinct pages carry no disclosure').not.toContain(DISCLOSURE);

    await printPage.fill('[data-print-range-input]', '1,1,3');
    await printPage.waitForTimeout(250);
    await printPage.screenshot({ path: path.join(SHOTS, 'tfl1260-def650-disclosure.png') });

    // --- DEF-649: the preview cell is paper white in the dark theme. ---
    await printPage.click('[data-print-range-all]');
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await printPage.waitForTimeout(300);
    const cellBg = await printPage.evaluate(() => {
      const el = document.querySelector('[data-print-preview-cell]');
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    console.log(`[TFL1260] dark preview cell background = ${JSON.stringify(cellBg)}`);
    expect(cellBg, 'dark-theme preview cell is paper white').toBe('rgb(255, 255, 255)');
    await printPage.screenshot({ path: path.join(SHOTS, 'tfl1260-def649-dark-preview.png') });
  } finally {
    await hardClose(app, 'tfl1260-def650');
  }
});
