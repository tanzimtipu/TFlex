// Phase 30 chunk 1+2 focused verification (qa).
//
// Verifies, in the real launched Electron app:
//   1. the title-bar Print icon opens the Print dialog;
//   2. the printer dropdown is populated from the REAL system printer list
//      (this machine has "Microsoft Print to PDF");
//   3. the preview reflects a changed custom page range (1-2);
//   4. Cancel closes the dialog;
//   5. the Ctrl+P menu accelerator re-opens it (menu -> print:request ->
//      renderer path). Delivered via webContents.sendInputEvent because CDP
//      key injection cannot trigger Electron menu accelerators (see step 5).
//
// Fixture: test-fixtures/report.pdf (34 pages, text-rich) - a >= 3-page doc.
//
// NOT clicked: [data-print-confirm]. The real hand-off opens a Chromium print
// dialog inside a hidden window (or prints to a device) and can hang the run;
// the payload/print path is covered by the dialog unit tests and the backend
// printToPDF composition check.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIDDOT = '\u00b7'; // the preview meta separator

test('Phase 30 print dialog: icon + Ctrl+P + real printers + range preview', async () => {
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
    // --- open a >= 3-page fixture -----------------------------------------
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const fixture = getSamplePath('report.pdf');
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, fixture);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P30] fixture=report.pdf pageCount=${pageCount}`);
    expect(pageCount, 'fixture has >= 3 pages').toBeGreaterThanOrEqual(3);

    // --- 2. title-bar Print icon opens the dialog -------------------------
    await win.click('[data-print]');
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });

    // The printer list is fetched asynchronously on open; wait until it has
    // settled (a real option, or the empty/error state) before reading it.
    await win.waitForFunction(
      () => {
        const sel = document.querySelector('[data-print-printer]');
        if (sel === null) return false;
        const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
        const settled =
          document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
        return hasReal || settled;
      },
      null,
      { timeout: 20000 },
    );

    const options = await win.$$eval('[data-print-printer] option', (opts) =>
      opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })),
    );
    console.log(`[P30] printer options=${JSON.stringify(options)}`);
    expect(options.length, 'printer dropdown has at least one option').toBeGreaterThanOrEqual(1);
    const pdfOption = options.find(
      (o) => /pdf/i.test(o.text) || /pdf/i.test(o.value),
    );
    expect(pdfOption, 'at least one printer option mentions PDF').toBeTruthy();

    const previewVisible = await win.locator('[data-print-preview]').isVisible();
    expect(previewVisible, 'preview panel is visible').toBe(true);

    // --- 3. custom range 1-2 changes the preview page/sheet count ---------
    const metaBefore = (await win.textContent('[data-print-preview-meta]')).trim();
    console.log(`[P30] preview meta before=${JSON.stringify(metaBefore)}`);
    expect(metaBefore, 'preview starts at the full document count').toBe(
      `${pageCount} pages ${MIDDOT} ${pageCount} sheets`,
    );

    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-2');
    const expectedAfter = `2 pages ${MIDDOT} 2 sheets`;
    await win.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-print-preview-meta]');
        return el !== null && el.textContent.trim() === want;
      },
      expectedAfter,
      { timeout: 8000 },
    );
    const metaAfter = (await win.textContent('[data-print-preview-meta]')).trim();
    console.log(`[P30] preview meta after=${JSON.stringify(metaAfter)}`);
    expect(metaAfter, 'preview reflects the 1-2 custom range').toBe(expectedAfter);

    // --- 4. Cancel closes the dialog --------------------------------------
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
    expect(await win.locator('[data-print-printer]').count(), 'dialog closed by Cancel').toBe(0);

    // --- 5. Ctrl+P accelerator re-opens the dialog ------------------------
    // NOTE (qa diagnostic): Playwright's `page.keyboard.press('Control+P')`
    // injects the key through CDP, which reaches the renderer (observed
    // keydown, defaultPrevented=false) but does NOT trigger Electron's
    // browser-process menu accelerator. The accelerator itself is proven by
    // delivering the same Ctrl+P key event through
    // `webContents.sendInputEvent`, which is the native input path the OS
    // uses. The renderer has no Ctrl+P handler, so the only route to the
    // dialog is menu accelerator -> print:request -> renderer. Clicking the
    // File > Print menu item directly also opened the dialog (same path).
    await win.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
    });
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    console.log('[P30] Ctrl+P accelerator re-opened the dialog');

    // --- 6. DEF-268 containment: footer inside the viewport, no dialog scroll
    // Let the open animation settle so geometry is the steady state.
    await win.waitForSelector('.print-dialog', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(600);

    const m = await win.evaluate(() => {
      const dialog = document.querySelector('.print-dialog');
      const body = document.querySelector('.print-dialog .modal-body');
      const footer = document.querySelector('.print-dialog .modal-footer');
      const confirm = document.querySelector('[data-print-confirm]');
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      };
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        dialogScrollHeight: dialog.scrollHeight,
        dialogClientHeight: dialog.clientHeight,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        footer: r(footer),
        confirm: r(confirm),
      };
    });
    console.log(`[P30][DEF268] measurements=${JSON.stringify(m)}`);

    // 1. the dialog itself must not scroll as a whole, and the body must not
    //    hide horizontal overflow.
    expect(
      m.dialogScrollHeight,
      'dialog has no dialog-level vertical scroll',
    ).toBeLessThanOrEqual(m.dialogClientHeight + 1);
    expect(
      m.bodyScrollWidth,
      'dialog body has no hidden horizontal overflow',
    ).toBeLessThanOrEqual(m.bodyClientWidth + 1);

    // 2. the footer must sit inside the viewport (and inside the 900 px
    //    default window height).
    expect(m.footer.bottom, 'footer bottom inside viewport').toBeLessThanOrEqual(m.vh);
    expect(m.footer.bottom, 'footer bottom inside 900 px window').toBeLessThanOrEqual(900);

    // 3. the primary Print action must be visible and clickable without
    //    scrolling the dialog.
    expect(await win.locator('[data-print-confirm]').isVisible(), 'Print button visible').toBe(true);
    expect(m.confirm.bottom, 'Print button bottom inside viewport').toBeLessThanOrEqual(m.vh);

    // --- 7. one screenshot of the open dialog -----------------------------
    const dialogBeforeShot = await win.locator('.print-dialog').count();
    const shotPath = path.join(SHOTS, 'phase30-print-dialog.png');
    await win.screenshot({ path: shotPath });
    const dialogAfterShot = await win.locator('.print-dialog').count();
    console.log(
      `[P30] screenshot=${shotPath} dialogBefore=${dialogBeforeShot} dialogAfter=${dialogAfterShot}`,
    );

    console.log(`[P30] consoleErrors=${JSON.stringify(consoleErrors)}`);
    console.log(`[P30] pageErrors=${JSON.stringify(pageErrors)}`);
  } finally {
    await hardClose(app, 'p30-print');
  }
});