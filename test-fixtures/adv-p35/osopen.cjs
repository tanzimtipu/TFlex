// ADV phase-35: OS-open path — hostile app:openPathRequest payloads, second-instance argv,
// dedupe, Multi Mode routing, modal-open interleaving.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-osopen] ${s}`); lines.push(`[adv35-osopen] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    // stub the modal error box so a non-PDF path never blocks the run
    await app.evaluate(({ dialog }) => {
      globalThis.__advErrBoxes = [];
      dialog.showErrorBox = (title, content) => { globalThis.__advErrBoxes.push({ title, content }); };
    });
    const errBoxes = () => app.evaluate(() => globalThis.__advErrBoxes.slice());
    const clearErrBoxes = () => app.evaluate(() => { globalThis.__advErrBoxes = []; });
    const send = (payload) => app.evaluate(({ BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0].webContents.send('app:openPathRequest', p);
    }, payload);
    const state = () => win.evaluate(() => ({
      tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()),
      toast: (document.querySelector('[data-toast], .toast') || {}).textContent || null,
      diag: (() => { try { return window.tflexDiagnostics(); } catch (e) { return { err: e.message }; } })(),
    }));

    // ---- 1. hostile renderer payloads ----
    const goodPath = C.tmpCopy(C.REPORT, 'adv35-osopen-good.pdf');
    const dirPath = path.join(os.tmpdir(), 'adv35-osopen-dir');
    fs.mkdirSync(dirPath, { recursive: true });
    const payloads = [
      ['array', [goodPath]],
      ['object', { path: goodPath }],
      ['number', 12345],
      ['null', null],
      ['empty-string', ''],
      ['whitespace', '   '],
      ['huge-string', 'A'.repeat(100000) + '.pdf'],
      ['non-pdf', 'C:\\Windows\\notepad.exe'],
      ['directory', dirPath],
      ['missing', path.join(os.tmpdir(), 'adv35-does-not-exist.pdf')],
      ['unicode-quotes', path.join(os.tmpdir(), 'adv35 "quoted" ünï.pdf')],
      ['dotdot', path.join(os.tmpdir(), 'adv35-osopen-dir', '..', 'adv35-dotdot.pdf')],
    ];
    for (const [name, p] of payloads) {
      await clearErrBoxes();
      let threw = null;
      try { await send(p); } catch (e) { threw = e.message; }
      await win.waitForTimeout(1800);
      const st = await state();
      note(`payload=${name}: threw=${threw} tabs=${JSON.stringify(st.tabs)} toast=${JSON.stringify(st.toast)} errBoxes=${JSON.stringify(await errBoxes())}`);
    }
    // reset tabs: close everything to a clean slate
    await win.evaluate(() => { document.querySelectorAll('.tab-close').forEach((b) => b.click()); });
    await win.waitForTimeout(1500);

    // ---- 2. second-instance argv (main-side handleOsOpenPath) ----
    const argvCases = [
      ['valid-pdf', [process.execPath, '.', goodPath]],
      ['non-pdf', [process.execPath, '.', 'C:\\Windows\\notepad.exe']],
      ['no-file', [process.execPath, '.']],
      ['switch-then-file', [process.execPath, '.', '--foo', goodPath]],
      ['numbers', [process.execPath, '.', 123, goodPath]],
      ['null-argv', null],
      ['string-argv', 'not-an-array'],
    ];
    for (const [name, argv] of argvCases) {
      await clearErrBoxes();
      let threw = null;
      try {
        await app.evaluate(({ app: a }, av) => { a.emit('second-instance', {}, av); }, argv);
      } catch (e) { threw = e.message; }
      await win.waitForTimeout(2200);
      const st = await state();
      const boxes = await errBoxes();
      note(`second-instance=${name}: threw=${threw} tabs=${JSON.stringify(st.tabs)} errBoxes=${JSON.stringify(boxes)}`);
      if (st.tabs.length > 0) { await win.evaluate(() => { document.querySelectorAll('.tab-close').forEach((b) => b.click()); }); await win.waitForTimeout(1200); }
    }

    // ---- 3. dedupe: same path twice via the OS-open push ----
    await send(goodPath);
    await win.waitForTimeout(2500);
    const after1 = await state();
    await send(goodPath);
    await win.waitForTimeout(2500);
    const after2 = await state();
    note(`dedupe: after1 tabs=${JSON.stringify(after1.tabs)} after2 tabs=${JSON.stringify(after2.tabs)}`);

    // ---- 4. Multi Mode routing: OS-open with an empty focused pane ----
    // open a second doc so Multi Mode has something to put in pane A
    await C.openFile(app, win, C.tmpCopy(C.LONG, 'adv35-osopen-b.pdf'));
    await win.waitForTimeout(1500);
    const multiBtn = await win.locator('[data-toolbar-multi-mode]').first().isVisible().catch(() => false);
    note(`multi-mode button visible=${multiBtn}`);
    if (multiBtn) {
      // activate the first doc then toggle multi mode (pane A gets it, pane B empty)
      await win.evaluate(() => { const t = [...document.querySelectorAll('.tab[data-tab-id]')].find((x) => x.textContent.includes('adv35-osopen-good')); if (t) t.click(); });
      await win.waitForTimeout(600);
      await win.locator('[data-toolbar-multi-mode]').first().click();
      await win.waitForTimeout(800);
      const paneEmpty = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
      note(`multi mode: paneB empty=${paneEmpty}`);
      await clearErrBoxes();
      await send(goodPath); // already in pane A -> should be refused (same as other pane)
      await win.waitForTimeout(2500);
      const stRefuse = await state();
      note(`multi OS-open same-as-pane-A: tabs=${JSON.stringify(stRefuse.tabs)} toast=${JSON.stringify(stRefuse.toast)} errBoxes=${JSON.stringify(await errBoxes())}`);
      // Now send a DIFFERENT file -> should land in the focused (empty) pane
      const thirdPath = C.tmpCopy(C.REPORT, 'adv35-osopen-c.pdf');
      await send(thirdPath);
      await win.waitForTimeout(3000);
      const paneText = await win.evaluate(() => ({
        paneA: (document.querySelector('.multi-pane-header[data-pane="A"]') || {}).textContent || null,
        paneB: (document.querySelector('.multi-pane-header[data-pane="B"]') || {}).textContent || null,
        tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()),
        hiddenTabs: document.querySelectorAll('.tab[data-tab-id]').length,
      }));
      note(`multi OS-open different file: ${JSON.stringify(paneText)}`);
    }

    fs.writeFileSync(path.join(OUT, 'osopen.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'osopen.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-osopen');
  }
})();
