// ADV phase-35: what the print window RENDERS for edge contexts + UI/silence sweep.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-pwui] ${s}`); lines.push(`[adv35-pwui] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-pwui-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);
    const docId = (await win.evaluate(() => window.tflexDiagnostics())).engineDocId;
    note(`docId=${docId}`);

    const openAndCapture = async (ctx, label) => {
      const p = app.waitForEvent('window');
      const res = await win.evaluate((c) => window.tflex.printWindow.open(c), ctx);
      let page = null;
      try { page = await Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('no window event')), 8000))]); } catch (e) { note(`${label}: no new page (${e.message}) res=${JSON.stringify(res)}`); }
      await win.waitForTimeout(1200);
      const state = await app.evaluate(({ BrowserWindow }) => {
        const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
        if (!pw) return null;
        return { visible: pw.isVisible(), title: pw.getTitle(), urlLen: pw.webContents.getURL().length, crashed: pw.webContents.isCrashed(), destroyed: pw.isDestroyed() };
      });
      let dom = null;
      if (page && !page.isClosed()) {
        dom = await page.evaluate(() => ({
          printWindow: !!document.querySelector('[data-print-window]'),
          errorState: !!document.querySelector('[data-print-window-error]'),
          errorText: (document.querySelector('[data-print-window-error] .print-window-error-text') || {}).textContent || null,
          loadError: !!document.querySelector('[data-print-window-load-error]'),
          loading: !!document.querySelector('[data-print-window-loading]'),
          docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
          printerCount: document.querySelectorAll('[data-print-printer] option').length,
          bodyText: (document.body.innerText || '').slice(0, 200),
        })).catch((e) => ({ evalError: e.message }));
      }
      note(`${label}: res=${JSON.stringify(res)} win=${JSON.stringify(state)} dom=${JSON.stringify(dom)}`);
      return { page, state, dom };
    };

    const closeAllPrint = async () => {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => { if (w.webContents.getURL().includes('tfWindow=print')) w.destroy(); });
      });
      await win.waitForTimeout(400);
    };

    // 1. huge 200k-char documentName
    const huge = await openAndCapture({ docId, documentName: 'A'.repeat(200000), pageCount: 34, settings: {} }, 'huge-name');
    if (huge.page && !huge.page.isClosed()) await huge.page.screenshot({ path: path.join(SHOTS, 'adv-p35-huge-context.png') }).catch(() => {});
    await closeAllPrint();

    // 2. ghost doc (never opened)
    await openAndCapture({ docId: 'ghost-never-opened', documentName: 'ghost.pdf', pageCount: 2, settings: {} }, 'ghost-doc');
    await closeAllPrint();

    // 3. valid doc, then doc change to a second REAL doc
    const pageA = await openAndCapture({ docId, documentName: 'adv35-pwui-a.pdf', pageCount: 34, settings: {} }, 'real-doc');
    // open a second doc in the app
    await C.openFile(app, win, C.tmpCopy(C.LONG, 'adv35-pwui-b.pdf'));
    await win.waitForTimeout(1500);
    const tabIds = await win.evaluate(() => [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent));
    note(`tabs after second open=${JSON.stringify(tabIds)}`);
    // switch back to A so its docId is active again? We just need a different docId.
    const docIdB = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    note(`docIdB=${docIdB}`);
    const resB = await win.evaluate((c) => window.tflex.printWindow.open(c), { docId: docIdB, documentName: 'adv35-pwui-b.pdf', pageCount: 520, settings: {} });
    await win.waitForTimeout(1800);
    const domB = await pageA.page.evaluate(() => ({
      docName: (document.querySelector('[data-print-window-doc]') || {}).textContent || null,
      pages: (document.querySelector('.print-window-pages') || {}).textContent || null,
      loadError: !!document.querySelector('[data-print-window-load-error]'),
      loading: !!document.querySelector('[data-print-window-loading]'),
    })).catch((e) => ({ evalError: e.message }));
    note(`doc-change: res=${JSON.stringify(resB)} domAfter=${JSON.stringify(domB)}`);
    await pageA.page.screenshot({ path: path.join(SHOTS, 'adv-p35-docchange.png') }).catch(() => {});

    // 4. document-gone path
    // close the print dialog in the main window first (Escape)
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
    // close the tab whose doc is currently in the print window (B)
    await win.locator('.tab-close').first().click();
    await win.waitForTimeout(2000);
    const gone = await pageA.page.evaluate(() => ({
      goneBanner: !!document.querySelector('[data-print-document-gone]'),
      confirmDisabled: (() => { const b = document.querySelector('[data-print-confirm]'); return b ? b.disabled : null; })(),
      printerDisabled: (() => { const s = document.querySelector('[data-print-printer]'); return s ? s.disabled : null; })(),
      body: (document.body.innerText || '').slice(0, 240),
    })).catch((e) => ({ evalError: e.message }));
    note(`gone: ${JSON.stringify(gone)}`);
    await pageA.page.screenshot({ path: path.join(SHOTS, 'adv-p35-gone.png') }).catch(() => {});
    await closeAllPrint();

    // 5. Silence sweep on a fresh valid print window: click every actionable control.
    const fresh = await openAndCapture({ docId, documentName: 'adv35-pwui-a.pdf', pageCount: 34, settings: {} }, 'sweep-open');
    const pw = fresh.page;
    if (pw && !pw.isClosed()) {
      await pw.waitForSelector('[data-print-printer]', { timeout: 20000 }).catch(() => {});
      await pw.waitForTimeout(2500);
      const controls = await pw.evaluate(() => {
        const sel = '[data-print-window] button, [data-print-window] select, [data-print-window] input';
        return [...document.querySelectorAll(sel)].map((el, i) => ({
          i, tag: el.tagName, type: el.type || null, disabled: el.disabled,
          attr: [...el.attributes].map((a) => `${a.name}=${a.value}`).filter((s) => s.startsWith('data-')).join(' ').slice(0, 90),
          text: (el.textContent || '').trim().slice(0, 30),
        }));
      });
      note(`sweep controls=${JSON.stringify(controls)}`);
      await pw.screenshot({ path: path.join(SHOTS, 'adv-p35-print-window-ui.png') }).catch(() => {});
    }
    fs.writeFileSync(path.join(OUT, 'pw_ui.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'pw_ui.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-pwui');
  }
})();
