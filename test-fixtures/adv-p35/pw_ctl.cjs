// ADV phase-35: print-window real interactions, gone variants, save-cancel quiet path.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const lines = [];
const note = (s) => { console.log(`[adv35-pwctl] ${s}`); lines.push(`[adv35-pwctl] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-pwctl-a.pdf'));
    await win.waitForTimeout(1200);
    await C.openFile(app, win, C.tmpCopy(C.LONG, 'adv35-pwctl-b.pdf'));
    await win.waitForTimeout(1800);
    const diag = await win.evaluate(() => window.tflexDiagnostics());
    const docIdB = diag.engineDocId;
    note(`docIdB=${docIdB} pageCount=${diag.pageCount}`);

    const p = app.waitForEvent('window');
    const res = await win.evaluate((c) => window.tflex.printWindow.open(c), { docId: docIdB, documentName: 'adv35-pwctl-b.pdf', pageCount: 520, settings: {} });
    const pw = await p;
    await pw.waitForSelector('[data-print-printer]', { timeout: 25000 });
    await pw.waitForTimeout(2500);
    note(`opened res=${JSON.stringify(res)}`);

    // Close the OTHER tab (A). The print window must be untouched (no gone).
    const activeBefore = await win.evaluate(() => document.querySelector('.tab[data-tab-id][aria-selected="true"]')?.textContent || null);
    note(`active tab before close=${activeBefore}`);
    const otherClose = await win.evaluate(() => {
      const tabs = [...document.querySelectorAll('.tab[data-tab-id]')];
      const t = tabs.find((x) => !x.getAttribute('aria-selected') || x.getAttribute('aria-selected') !== 'true');
      if (!t) return null;
      const b = t.querySelector('.tab-close');
      if (b) b.click();
      return t.textContent;
    });
    await win.waitForTimeout(1500);
    const afterOther = await pw.evaluate(() => ({
      goneBanner: !!document.querySelector('[data-print-document-gone]'),
      docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
    })).catch((e) => ({ evalError: e.message }));
    note(`closed other tab=${JSON.stringify(otherClose)} printWindow=${JSON.stringify(afterOther)}`);

    // Now close the print window's OWN document (B, the active tab).
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    const ownClose = await win.evaluate(() => {
      const t = document.querySelector('.tab[data-tab-id][aria-selected="true"]');
      if (!t) return null;
      const b = t.querySelector('.tab-close');
      if (b) b.click();
      return t.textContent;
    });
    await win.waitForTimeout(2000);
    const gone = await pw.evaluate(() => ({
      goneBanner: !!document.querySelector('[data-print-document-gone]'),
      confirmDisabled: (() => { const b = document.querySelector('[data-print-confirm]'); return b ? b.disabled : null; })(),
      cancelText: (document.querySelector('[data-print-cancel]') || {}).textContent || null,
      loading: !!document.querySelector('[data-print-window-loading]'),
      loadError: !!document.querySelector('[data-print-window-load-error]'),
      pages: (document.querySelector('.print-window-pages') || {}).textContent || null,
    })).catch((e) => ({ evalError: e.message }));
    note(`closed own tab=${JSON.stringify(ownClose)} gone=${JSON.stringify(gone)}`);
    await pw.screenshot({ path: path.join(SHOTS, 'adv-p35-gone-correct.png') }).catch(() => {});

    // Close the print window via its own Close button; app stays usable.
    await pw.locator('[data-print-cancel]').click({ noWaitAfter: true }).catch(() => {});
    await win.waitForTimeout(1200);
    const afterOwnClose = await app.evaluate(({ BrowserWindow }) => ({
      printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
      all: BrowserWindow.getAllWindows().length,
    }));
    note(`after print-window Close button: ${JSON.stringify(afterOwnClose)}`);

    // ---- save-cancel quiet path: open for a live doc, choose Microsoft Print to PDF, cancel save ----
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-pwctl-c.pdf'));
    await win.waitForTimeout(1500);
    const docIdC = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    const p2 = app.waitForEvent('window');
    await win.evaluate((c) => window.tflex.printWindow.open(c), { docId: docIdC, documentName: 'adv35-pwctl-c.pdf', pageCount: 34, settings: {} });
    const pw2 = await p2;
    await pw2.waitForSelector('[data-print-printer]', { timeout: 25000 });
    await pw2.waitForTimeout(2500);
    // count hidden windows BEFORE the print attempt (cancel must not create one)
    const hiddenBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), url: w.webContents.getURL().slice(0, 50) })));
    await pw2.selectOption('[data-print-printer]', { label: /pdf/i }).catch(async () => {
      const opts = await pw2.$$eval('[data-print-printer] option', (o) => o.map((x) => ({ t: x.textContent, v: x.value })));
      const pdf = opts.find((o) => /pdf/i.test(o.t) || /pdf/i.test(o.v));
      if (pdf) await pw2.selectOption('[data-print-printer]', pdf.v);
    });
    await pw2.waitForTimeout(600);
    // stub the app save dialog to CANCEL
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    const confirmDisabled = await pw2.evaluate(() => document.querySelector('[data-print-confirm]').disabled);
    await pw2.locator('[data-print-confirm]').click();
    await pw2.waitForTimeout(6000);
    const cancelState = await pw2.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
      confirmDisabled: document.querySelector('[data-print-confirm]').disabled,
      running: !!document.querySelector('[data-print-progress]'),
    })).catch((e) => ({ evalError: e.message }));
    const hiddenAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), url: w.webContents.getURL().slice(0, 50) })));
    note(`save-cancel: confirmDisabledBefore=${confirmDisabled} state=${JSON.stringify(cancelState)}`);
    note(`save-cancel windows before=${JSON.stringify(hiddenBefore)} after=${JSON.stringify(hiddenAfter)}`);
    await pw2.screenshot({ path: path.join(SHOTS, 'adv-p35-save-cancel.png') }).catch(() => {});

    // ---- real control interaction: change orientation + nup, check preview state changes ----
    const before = await pw2.evaluate(() => ({
      meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent || null,
      orientation: (document.querySelector('[data-print-orientation-landscape]') || {}).checked,
    }));
    await pw2.locator('[data-print-orientation-landscape]').check();
    await pw2.locator('[data-print-nup]').selectOption('2');
    await pw2.waitForTimeout(1200);
    const after = await pw2.evaluate(() => ({
      meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent || null,
      orientation: (document.querySelector('[data-print-orientation-landscape]') || {}).checked,
      nup: document.querySelector('[data-print-nup]').value,
      sheets: document.querySelectorAll('[data-print-preview-sheet]').length,
    }));
    note(`control interaction: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

    fs.writeFileSync(path.join(OUT, 'pw_ctl.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'pw_ctl.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-pwctl');
  }
})();
