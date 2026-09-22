// Phase 35 — QA regression guard for the adversary's three ACCEPTED findings
// (ADV-075/076/077), now FIXED as DEF-299/300/301.
//
// This file previously asserted the OBSERVED DEFECTIVE behaviour (green while
// the defects were OPEN). It is INVERTED here to assert the FIXED behaviour so
// it guards against regression. Launches go through the canonical launchApp.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const C = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

// ---------------------------------------------------------------------------
// DEF-299 (ADV-075): caption "+" (new tab) must NEVER crash the renderer.
// Fixed: the Phase 35 detach prop guards with `activeTab == null`, so an empty
// tab (id but no openTabs entry -> activeTab undefined) is safe.
// ---------------------------------------------------------------------------
test('DEF-299 regression: caption + (new tab) with a document open and with an empty tab keeps the renderer alive', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'def299-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    const snap = () => win.evaluate(() => ({
      tabs: document.querySelectorAll('.tab[data-tab-id]').length,
      titlebar: !!document.querySelector('.titlebar'),
      tabList: !!document.querySelector('.tab-list'),
      app: !!document.querySelector('.app'),
      // An empty tab shows the Welcome screen (showWelcome), not the document
      // workspace - so the document toolbar is legitimately absent there.
      welcome: !!document.querySelector('.sample-card'),
      rootHtmlLen: (document.getElementById('root') || { innerHTML: '' }).innerHTML.length,
    }));

    const before = await snap();
    // Click "+" with a document open -> a new empty tab becomes active.
    await win.locator('[data-new-tab]').first().click({ timeout: 8000 });
    await win.waitForTimeout(1200);
    const afterDoc = await snap();
    // Click "+" AGAIN while the empty tab is active (the exact crash path).
    await win.locator('[data-new-tab]').first().click({ timeout: 8000 });
    await win.waitForTimeout(1200);
    const afterEmpty = await snap();

    console.log(`[DEF-299] before=${JSON.stringify(before)}`);
    console.log(`[DEF-299] afterDoc=${JSON.stringify(afterDoc)}`);
    console.log(`[DEF-299] afterEmpty=${JSON.stringify(afterEmpty)}`);
    console.log(`[DEF-299] pageerrors=${JSON.stringify(errors)}`);

    // The renderer survived both clicks: no crash, chrome intact, root non-empty.
    expect(errors.some((m) => /reading 'session'/.test(m))).toBe(false);
    expect(errors).toEqual([]);
    expect(afterDoc.rootHtmlLen).toBeGreaterThan(0);
    expect(afterDoc.titlebar).toBe(true);
    expect(afterDoc.tabList).toBe(true);
    expect(afterDoc.app).toBe(true);
    expect(afterDoc.welcome).toBe(true);
    expect(afterEmpty.rootHtmlLen).toBeGreaterThan(0);
    expect(afterEmpty.titlebar).toBe(true);
    expect(afterEmpty.tabList).toBe(true);
    expect(afterEmpty.app).toBe(true);
    expect(afterEmpty.welcome).toBe(true);
    // The "+" actually opened a new empty tab each time.
    expect(afterDoc.tabs).toBe(before.tabs + 1);
    expect(afterEmpty.tabs).toBe(afterDoc.tabs + 1);
  } finally {
    await hardClose(app, 'def299');
  }
});

// ---------------------------------------------------------------------------
// DEF-300 (ADV-076): with the standalone print window open (and focused), an
// OS file-open must reach the MAIN window, never the print window.
// Fixed: the main window is held by explicit reference and is the only target.
// ---------------------------------------------------------------------------
test('DEF-300 regression: OS file-open reaches the MAIN window while the print window is open and focused', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'def300-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    const tabs = () =>
      win.evaluate(() => [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()));
    const secondInstance = async (p) => {
      await app.evaluate(({ app: a }, av) => {
        a.emit('second-instance', {}, av);
      }, [process.execPath, '.', p]);
    };

    // CONTROL: no print window open -> the OS-open lands in the main window.
    const bPath = C.tmpCopy(C.LONG, 'def300-b.pdf');
    await secondInstance(bPath);
    await win.waitForTimeout(4000);
    const tabsAfterControl = await tabs();
    console.log(`[DEF-300] control (no print window) tabs=${JSON.stringify(tabsAfterControl)}`);

    // Open the standalone print window; record window order + focused window.
    const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    const p = app.waitForEvent('window');
    await win.evaluate((c) => window.tflex.printWindow.open(c), {
      docId,
      documentName: 'def300-a.pdf',
      pageCount: 34,
      settings: {},
    });
    const pw = await p;
    await pw.waitForSelector('[data-print-window]', { timeout: 25000 });
    await pw.waitForTimeout(1200);
    const windows = await app.evaluate(({ BrowserWindow }) => ({
      order: BrowserWindow.getAllWindows().map((w, i) => ({
        i,
        id: w.id,
        kind: w.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN',
      })),
      focused: (() => {
        const f = BrowserWindow.getFocusedWindow();
        return f ? (f.webContents.getURL().includes('tfWindow=print') ? 'PRINT' : 'MAIN') : null;
      })(),
    }));
    console.log(`[DEF-300] windows=${JSON.stringify(windows)}`);

    // OS-open (second launch) while the print window is open/focused: the
    // document must open in the MAIN window, not be dropped.
    const cPath = C.tmpCopy(C.REPORT, 'def300-c.pdf');
    await secondInstance(cPath);
    await win.waitForTimeout(4000);
    const tabsAfterOsOpen = await tabs();
    console.log(`[DEF-300] after OS-open with print window open tabs=${JSON.stringify(tabsAfterOsOpen)}`);

    // The print window is untouched: still print-only, no document opened there.
    const printState = await pw.evaluate(() => ({
      printWindow: !!document.querySelector('[data-print-window]'),
      tabs: document.querySelectorAll('.tab[data-tab-id]').length,
      toolbar: document.querySelectorAll('.toolbar').length,
    }));
    console.log(`[DEF-300] print window state=${JSON.stringify(printState)}`);

    // Direct push of app:openPathRequest to the MAIN window (the fixed routing
    // target) must also open the document.
    const dPath = C.tmpCopy(C.LONG, 'def300-d.pdf');
    await app.evaluate(({ BrowserWindow }, pth) => {
      const mainWin = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
      if (mainWin) mainWin.webContents.send('app:openPathRequest', pth);
    }, dPath);
    await win.waitForTimeout(4000);
    const tabsAfterPush = await tabs();
    console.log(`[DEF-300] after direct push to MAIN tabs=${JSON.stringify(tabsAfterPush)}`);

    // CONTROL 2: close the print window -> the OS-open still works.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().includes('tfWindow=print'),
      );
      if (w) w.destroy();
    });
    await win.waitForTimeout(1200);
    const ePath = C.tmpCopy(C.REPORT, 'def300-e.pdf');
    await secondInstance(ePath);
    await win.waitForTimeout(4000);
    const tabsAfterClose = await tabs();
    console.log(`[DEF-300] after closing print window tabs=${JSON.stringify(tabsAfterClose)}`);

    expect(windows.order[0].kind).toBe('PRINT');
    expect(windows.focused).toBe('PRINT');
    expect(tabsAfterControl.length).toBe(2);
    expect(tabsAfterOsOpen.length).toBe(3);
    expect(tabsAfterPush.length).toBe(4);
    expect(tabsAfterClose.length).toBe(5);
    expect(printState.printWindow).toBe(true);
    expect(printState.tabs).toBe(0);
    expect(printState.toolbar).toBe(0);
  } finally {
    await hardClose(app, 'def300');
  }
});

// ---------------------------------------------------------------------------
// DEF-301 (ADV-077): the printer pick must survive the async printer-list
// resolution on reopen (it used to silently revert to the system default).
// ---------------------------------------------------------------------------
test('DEF-301 regression: the printer pick survives reopen (no silent revert to the system default)', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'def301-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__def301 = 0;
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const orig = wc.getPrintersAsync.bind(wc);
      wc.getPrintersAsync = (...a) => {
        globalThis.__def301 += 1;
        return orig(...a);
      };
    });
    const getCount = () => app.evaluate(() => globalThis.__def301);
    const readSel = () =>
      win.evaluate(() => {
        const s = document.querySelector('[data-print-printer]');
        return s ? s.value : null;
      });
    const readDefault = () =>
      win.evaluate(() => {
        const s = document.querySelector('[data-print-printer]');
        if (!s) return null;
        const o = [...s.querySelectorAll('option')].find((x) => x.textContent.includes('(default)'));
        return o ? o.value : null;
      });

    const openAndSelect = async (label) => {
      await win.locator('[data-print]').first().click();
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      const t0 = Date.now();
      await win.waitForFunction(
        () => {
          const s = document.querySelector('[data-print-printer]');
          return s && [...s.querySelectorAll('option')].some((o) => o.value !== '');
        },
        null,
        { timeout: 20000 },
      );
      const optionsAtMs = Date.now() - t0;
      await win.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
      const selectedAtMs = Date.now() - t0;
      const seq = [];
      let last = null;
      for (let i = 0; i < 40; i += 1) {
        const v = await readSel();
        const g = await getCount();
        const cur = `${v}|${g}`;
        if (cur !== last) {
          seq.push({ t: Date.now() - t0, value: v, getPrinters: g });
          last = cur;
        }
        await win.waitForTimeout(75);
      }
      const def = await readDefault();
      console.log(
        `[DEF-301] ${label} optionsAtMs=${optionsAtMs} selectedAtMs=${selectedAtMs} default=${def} timeline=${JSON.stringify(seq)}`,
      );
      await win.locator('[data-print-cancel]').click({ timeout: 5000 }).catch(() => {});
      await win.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 8000 }).catch(() => {});
      await win.waitForTimeout(400);
      return { seq, def };
    };

    const first = await openAndSelect('first-open');
    const second = await openAndSelect('second-open');
    const third = await openAndSelect('third-open');

    const revertedIn = (r) =>
      r.seq.some((s) => s.value === 'Microsoft Print to PDF') &&
      r.seq.some((s) => s.value !== null && s.value !== '' && s.value !== 'Microsoft Print to PDF');
    console.log(`[DEF-301] firstReverted=${revertedIn(first)} secondReverted=${revertedIn(second)} thirdReverted=${revertedIn(third)}`);
    // The pick must STAY selected on every reopen.
    expect(revertedIn(first)).toBe(false);
    expect(revertedIn(second)).toBe(false);
    expect(revertedIn(third)).toBe(false);
    // And the final observed value is the pick.
    expect(second.seq[second.seq.length - 1].value).toBe('Microsoft Print to PDF');
    expect(third.seq[third.seq.length - 1].value).toBe('Microsoft Print to PDF');
  } finally {
    await hardClose(app, 'def301');
  }
});

// ---------------------------------------------------------------------------
// DEF-301 (ADV-077): a selected device that disappears from the fresh list
// falls back deterministically AND the routing change is observable; a user
// pick clears the notice.
// ---------------------------------------------------------------------------
test('DEF-301 regression: a vanished selected device falls back with an observable notice that a user pick clears', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'def301-b.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Stub the printer list on the main window's webContents. The first
    // resolve offers the real list; after the pick we swap in a list where the
    // selected device is GONE.
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const orig = wc.getPrintersAsync.bind(wc);
      globalThis.__def301b = { mode: 'real', orig };
      wc.getPrintersAsync = (...a) => {
        if (globalThis.__def301b.mode === 'vanished') {
          return Promise.resolve([
            { name: 'Canon TS3100 series', displayName: 'Canon TS3100 series', isDefault: true },
            { name: 'HP Fake 9000', displayName: 'HP Fake 9000', isDefault: false },
          ]);
        }
        return orig(...a);
      };
    });

    // Open, pick Microsoft Print to PDF, close.
    await win.locator('[data-print]').first().click();
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await win.waitForFunction(() => {
      const s = document.querySelector('[data-print-printer]');
      return s && [...s.querySelectorAll('option')].some((o) => o.value !== '');
    }, null, { timeout: 20000 });
    await win.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await win.waitForTimeout(300);
    await win.locator('[data-print-cancel]').click();
    await win.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(400);

    // The selected device disappears from the fresh list.
    await app.evaluate(() => { globalThis.__def301b.mode = 'vanished'; });

    // Reopen: the resolve must fall back AND surface the notice.
    await win.locator('[data-print]').first().click();
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    await win.waitForSelector('[data-print-printer-notice]', { state: 'visible', timeout: 15000 });
    const notice = await win.locator('[data-print-printer-notice]').innerText();
    const selAfterFallback = await win.evaluate(() => document.querySelector('[data-print-printer]').value);
    console.log(`[DEF-301b] notice=${JSON.stringify(notice)} selected=${JSON.stringify(selAfterFallback)}`);
    expect(notice).toContain('Microsoft Print to PDF');
    expect(notice).toContain('Canon TS3100 series');
    expect(selAfterFallback).toBe('Canon TS3100 series');

    // A user pick clears the notice.
    await win.selectOption('[data-print-printer]', 'HP Fake 9000');
    await win.waitForTimeout(300);
    const noticeAfterPick = await win.locator('[data-print-printer-notice]').count();
    const selAfterPick = await win.evaluate(() => document.querySelector('[data-print-printer]').value);
    console.log(`[DEF-301b] after pick noticeCount=${noticeAfterPick} selected=${JSON.stringify(selAfterPick)}`);
    expect(noticeAfterPick).toBe(0);
    expect(selAfterPick).toBe('HP Fake 9000');
  } finally {
    await hardClose(app, 'def301');
  }
});
