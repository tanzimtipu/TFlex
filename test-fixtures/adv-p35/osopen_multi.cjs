// ADV phase-35: OS-open routing in Multi Mode + while a modal is open.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-osmulti] ${s}`); lines.push(`[adv35-osmulti] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await app.evaluate(({ dialog }) => {
      globalThis.__advErrBoxes = [];
      dialog.showErrorBox = (t, c) => globalThis.__advErrBoxes.push({ t, c });
    });
    const send = (p) => app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows()[0].webContents.send('app:openPathRequest', x), p);
    const paneState = () => win.evaluate(() => ({
      paneA: (document.querySelector('.multi-pane-header[data-pane="A"]') || {}).textContent || null,
      paneB: (document.querySelector('.multi-pane-header[data-pane="B"]') || {}).textContent || null,
      paneBEmpty: !!document.querySelector('.tab-pane[data-pane="B"][data-pane-empty]'),
      tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent.trim()),
      toast: (document.querySelector('[data-toast], .toast') || {}).textContent || null,
    }));

    const alpha = C.tmpCopy(C.REPORT, 'adv35-osm-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv35-osm-beta.pdf');
    const gamma = C.tmpCopy(C.REPORT, 'adv35-osm-gamma.pdf');
    await C.openFile(app, win, alpha);
    await win.waitForTimeout(1200);
    await C.openFile(app, win, beta);
    await win.waitForTimeout(1800);
    note(`two tabs: ${JSON.stringify((await paneState()).tabs)}`);

    // Enter Multi Mode with alpha active -> pane A, pane B empty.
    await win.evaluate(() => { const t = [...document.querySelectorAll('.tab[data-tab-id]')].find((x) => x.textContent.includes('adv35-osm-alpha')); if (t) t.click(); });
    await win.waitForTimeout(600);
    const multiBtnCount = await win.locator('[data-toolbar-multi-mode]').count();
    note(`multi-mode button count=${multiBtnCount}`);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(1200);
    note(`after toggle: ${JSON.stringify(await paneState())}`);

    // OS-open a brand-new file while pane B is empty -> must land in the focused pane.
    await send(gamma);
    await win.waitForTimeout(3500);
    note(`after OS-open gamma: ${JSON.stringify(await paneState())}`);

    // OS-open a file already shown in a pane -> refused with a message, no crash.
    await send(alpha);
    await win.waitForTimeout(2500);
    note(`after OS-open alpha (already a pane): ${JSON.stringify(await paneState())}`);

    // OS-open while the Preferences modal is up.
    await win.locator('[data-open-preferences]').first().click();
    await win.waitForTimeout(800);
    const prefsOpen = await win.locator('[data-prefs-dialog]').count();
    const beforeModal = await paneState();
    await send(gamma);
    await win.waitForTimeout(3000);
    const afterModal = await paneState();
    note(`prefsOpen=${prefsOpen} beforeModal=${JSON.stringify(beforeModal)} afterModal=${JSON.stringify(afterModal)}`);
    const errs = await app.evaluate(() => globalThis.__advErrBoxes.slice());
    note(`errorBoxes=${JSON.stringify(errs)}`);
    // close prefs
    await win.keyboard.press('Escape').catch(() => {});
    await win.waitForTimeout(500);

    fs.writeFileSync(path.join(OUT, 'osopen_multi.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'osopen_multi.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-osmulti');
  }
})();

