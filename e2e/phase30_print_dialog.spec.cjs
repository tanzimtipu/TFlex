// Phase 30 print entry points — MIGRATED for Phase 37 item 17.
//
// Phase 37 removed the in-app print modal: the title-bar Print icon, File >
// Print and Ctrl+P now open the STANDALONE print window (`?tfWindow=print`, a
// separate top-level BrowserWindow). This spec now verifies the SAME
// behaviours against that surface:
//   1. the title-bar Print icon opens the standalone print window;
//   2. the printer dropdown is populated from the REAL system printer list;
//   3. the preview reflects a changed custom page range (1-2);
//   4. Cancel closes the print window;
//   5. Ctrl+P (native input path) re-opens/focuses it;
//   6. the shared PrintPanel fits the print window's viewport (no clipping).
//
// Fixture: test-fixtures/report.pdf (34 pages, text-rich).
// NOT clicked: [data-print-confirm] (a real print can hang the run; the
// payload path is covered by the dialog unit tests + the backend check).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose,
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIDDOT = '\u00b7'; // the preview meta separator

test('Phase 37 print entry points: title-bar icon + Ctrl+P + real printers + range preview (standalone window)', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();

  const consoleErrors = [];
  const pageErrors = [];
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  win.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P37-P30] fixture=report.pdf pageCount=${pageCount}`);
    expect(pageCount, 'fixture has >= 3 pages').toBeGreaterThanOrEqual(3);

    // --- 1. the in-app modal is gone; the title-bar icon opens the window. ---
    const modal = await win.evaluate(() => ({
      dialog: document.querySelectorAll('[data-print-dialog]').length,
      shell: document.querySelectorAll('[data-print-dialog-shell]').length,
      klass: document.querySelectorAll('.print-dialog').length,
    }));
    console.log(`[P37-P30] in-app modal selectors=${JSON.stringify(modal)}`);
    for (const [k, v] of Object.entries(modal)) expect(v, `no in-app ${k}`).toBe(0);

    const printPage = await openStandalonePrintWindow(app, win);
    const info = await app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
      return { count: all.length, title: pw?.getTitle() };
    });
    console.log(`[P37-P30] standalone window=${JSON.stringify(info)}`);
    expect(info.count).toBe(2);
    expect(info.title).toBe('Print - TFlex');

    // --- 2. the printer dropdown is populated. ---
    const options = await printPage.$$eval('[data-print-printer] option', (opts) =>
      opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })));
    console.log(`[P37-P30] printer options=${JSON.stringify(options)}`);
    expect(options.length, 'printer dropdown has at least one option').toBeGreaterThanOrEqual(1);
    const pdfOption = options.find((o) => /pdf/i.test(o.text) || /pdf/i.test(o.value));
    expect(pdfOption, 'at least one printer option mentions PDF').toBeTruthy();
    expect(await printPage.locator('[data-print-preview]').isVisible(), 'preview panel visible').toBe(true);

    // --- 3. custom range 1-2 changes the preview page/sheet count. ---
    const metaBefore = (await printPage.textContent('[data-print-preview-meta]')).trim();
    console.log(`[P37-P30] preview meta before=${JSON.stringify(metaBefore)}`);
    expect(metaBefore, 'preview starts at the full document count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-2');
    const expectedAfter = `2 pages ${MIDDOT} 2 sheets`;
    await printPage.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-print-preview-meta]');
        return el !== null && el.textContent.trim() === want;
      },
      expectedAfter,
      { timeout: 8000 },
    );
    const metaAfter = (await printPage.textContent('[data-print-preview-meta]')).trim();
    console.log(`[P37-P30] preview meta after=${JSON.stringify(metaAfter)}`);
    expect(metaAfter, 'preview reflects the 1-2 custom range').toBe(expectedAfter);

    // --- 4. Cancel closes the print window. ---
    await printPage.click('[data-print-cancel]');
    await printPage.waitForEvent('close', { timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(600);
    const afterCancel = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length);
    console.log(`[P37-P30] print windows after Cancel=${afterCancel}`);
    expect(afterCancel, 'Cancel closed the print window').toBe(0);

    // --- 5. Ctrl+P (native sendInputEvent) re-opens it. ---
    const p2 = app.waitForEvent('window');
    await win.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
    });
    const printPage2 = await p2;
    await printPage2.waitForSelector('[data-print-window]', { timeout: 30000 });
    console.log('[P37-P30] Ctrl+P re-opened the standalone print window');

    // --- 6. the shared PrintPanel fits the print window's viewport. ---
    await printPage2.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await printPage2.waitForTimeout(600);
    const m = await printPage2.evaluate(() => {
      const root = document.querySelector('[data-print-window]');
      const confirm = document.querySelector('[data-print-confirm]');
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      };
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        rootScrollHeight: root.scrollHeight, rootClientHeight: root.clientHeight,
        confirm: r(confirm),
      };
    });
    console.log(`[P37-P30] containment=${JSON.stringify(m)}`);
    expect(m.rootScrollHeight, 'no window-level vertical overflow').toBeLessThanOrEqual(m.rootClientHeight + 1);
    expect(m.confirm.bottom, 'the Print action is inside the print window viewport').toBeLessThanOrEqual(m.vh);
    expect(m.confirm.left, 'the Print action is inside the print window viewport').toBeGreaterThanOrEqual(0);

    await printPage2.screenshot({ path: path.join(SHOTS, 'phase30-print-dialog.png') });
    console.log(`[P37-P30] screenshot ${path.join(SHOTS, 'phase30-print-dialog.png')}`);
    await closeStandalonePrintWindow(app, printPage2);

    console.log(`[P37-P30] consoleErrors=${JSON.stringify(consoleErrors)}`);
    console.log(`[P37-P30] pageErrors=${JSON.stringify(pageErrors)}`);
  } finally {
    await hardClose(app, 'p37-p30-print');
  }
});
