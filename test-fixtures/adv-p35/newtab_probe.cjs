// ADV phase-35: focused new-tab probe — does clicking the caption "+" break the chrome?
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
const note = (s) => { console.log(`[adv35-newtab] ${s}`); lines.push(`[adv35-newtab] ${s}`); };

const snap = (win) => win.evaluate(() => ({
  tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => t.textContent),
  titlebar: !!document.querySelector('.titlebar'),
  toolbar: !!document.querySelector('.toolbar'),
  header: !!document.querySelector('.app-header'),
  printBtn: !!document.querySelector('[data-print]'),
  openBtn: !!document.querySelector('[data-toolbar-open]'),
  newTabBtn: !!document.querySelector('[data-new-tab]'),
  welcome: !!document.querySelector('.welcome, .sample-card'),
  appRoot: !!document.querySelector('.app'),
  diag: (() => { try { return !!window.tflexDiagnostics(); } catch (e) { return 'ERR:' + e.message; } })(),
  bodyChildren: document.body.children.length,
  rootHtmlLen: (document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1),
}));

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    win.on('pageerror', (e) => note(`PAGEERROR: ${e.message}\nSTACK: ${e.stack || '(no stack)'}`));
    win.on('console', (m) => { if (m.type() === 'error') note(`CONSOLE-ERROR: ${m.text()}`); });
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-newtab-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);
    note(`before new-tab: ${JSON.stringify(await snap(win))}`);

    await win.locator('[data-new-tab]').first().click({ timeout: 8000 }).catch((e) => note(`new-tab click failed: ${String(e.message).split('\n')[0]}`));
    await win.waitForTimeout(1200);
    note(`after new-tab: ${JSON.stringify(await snap(win))}`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p35-newtab.png') }).catch(() => {});

    // Click the original document tab back and re-check.
    const back = await win.evaluate(() => {
      const t = [...document.querySelectorAll('.tab[data-tab-id]')].find((x) => x.textContent.includes('adv35-newtab-a'));
      if (t) { t.click(); return t.textContent; }
      return null;
    });
    await win.waitForTimeout(1200);
    note(`after activating doc tab (${JSON.stringify(back)}): ${JSON.stringify(await snap(win))}`);

    // Close the empty tab and re-check.
    const closed = await win.evaluate(() => {
      const t = [...document.querySelectorAll('.tab[data-tab-id]')].find((x) => x.textContent.includes('Empty'));
      if (t) { const b = t.querySelector('.tab-close'); if (b) { b.click(); return t.textContent; } }
      return null;
    });
    await win.waitForTimeout(1200);
    note(`after closing empty tab (${JSON.stringify(closed)}): ${JSON.stringify(await snap(win))}`);

    fs.writeFileSync(path.join(OUT, 'newtab.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'newtab.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-newtab');
  }
})();

