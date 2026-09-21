// ADV Phase 31 - hostile content + containment against the REAL app.
// Opens About via the real main-process menu:action payload, drives the real
// update:statusChanged channel with hostile notes, and checks for injection,
// crashes, layout blow-out and unreachable controls.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(ROOT, 'screenshots');
const IPC = { menuAction: 'menu:action', updateStatusChanged: 'update:statusChanged' };

const pageErrors = [];
const consoleErrors = [];

async function sendState(app, state) {
  await app.evaluate(({ BrowserWindow }, { channel, st }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, st);
  }, { channel: IPC.updateStatusChanged, st: state });
}

async function dismissPrompt(win) {
  const prompt = win.locator('[data-update-prompt], .sheet-update-prompt').first();
  if (await prompt.isVisible().catch(() => false)) {
    await win.locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]')
      .first().click().catch(() => {});
    await prompt.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
}

async function geometry(win) {
  return win.evaluate(() => {
    const sheet = document.querySelector('[data-about-dialog]');
    const body = document.querySelector('.sheet-about .sheet-body');
    const footer = document.querySelector('[data-about-check-update]');
    const inc = document.querySelector('[data-whats-new-incoming]');
    if (!sheet || !body) return null;
    const r = sheet.getBoundingClientRect();
    const fr = footer ? footer.getBoundingClientRect() : null;
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      sheetScroll: sheet.scrollHeight,
      sheetClient: sheet.clientHeight,
      sheetW: Math.round(r.width),
      sheetLeft: Math.round(r.left),
      sheetRight: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      bodyScroll: body.scrollHeight,
      bodyClient: body.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyOverflowX: getComputedStyle(body).overflowX,
      docScrollW: document.documentElement.scrollWidth,
      footer: fr ? { top: Math.round(fr.top), bottom: Math.round(fr.bottom), w: Math.round(fr.width), visible: fr.top >= 0 && fr.bottom <= window.innerHeight } : null,
      inc: inc ? { scrollW: inc.scrollWidth, clientW: inc.clientWidth } : null,
      incomingItems: document.querySelectorAll('[data-whats-new-incoming-highlight]').length,
      installedItems: document.querySelectorAll('[data-whats-new-highlight]').length,
      emptyShown: document.querySelector('[data-whats-new-empty]') !== null,
      incomingEmptyShown: document.querySelector('[data-whats-new-incoming-empty]') !== null,
    };
  });
}

async function injectionScan(win) {
  return win.evaluate(() => ({
    injectedScript: document.querySelector('[data-whats-new-incoming] script') !== null,
    injectedImg: document.querySelector('[data-whats-new-incoming] img') !== null,
    injectedStyle: document.querySelector('[data-whats-new-incoming] style') !== null,
    injectedB: document.querySelector('[data-whats-new-incoming] b') !== null,
    anyBoldElement: document.querySelectorAll('[data-whats-new-incoming] *').length,
    marker1: window.__adv_p31_xss1 === true,
    marker2: window.__adv_p31_xss2 === true,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyDisplay: getComputedStyle(document.body).display,
  }));
}

const HOSTILE = {
  'html-script': ['<script>window.__adv_p31_xss1=true</script>', '<img src=x onerror="window.__adv_p31_xss2=true">', '<b>bold</b>', '<style>body{display:none}</style>'],
  'entities': ['&lt;b&gt;literal&lt;/b&gt;', '&nbsp;&amp;&quot;'],
  'javascript-url': ['javascript:window.__adv_p31_xss1=true', 'data:text/html,<script>1</script>'],
  'rtl': ['\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645', '\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd'],
  'astral': ['emoji \uD83D\uDE00 \uD83E\uDD16 \uD83C\uDF89', 'astral \uD834\uDD1E \uD835\uDD6C'],
  'control-chars': ['nul:\u0000 end', 'bell:\u0007 esc:\u001b[31m backspace:\u0008', 'zero-width:\u200b\u200e\u200f end'],
  'whitespace': ['   ', '\t\t', '\u00a0\u00a0'],
  'huge-single-line': ['X'.repeat(100000)],
  'many-lines': Array.from({ length: 5000 }, (_, i) => `note line ${i}`),
};

(async () => {
  let app = null;
  try {
    app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
    const win = await app.firstWindow();
    win.on('pageerror', (e) => pageErrors.push(e.message));
    win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // Open About through the real main-process menu:action payload.
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, IPC.menuAction);
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
    await win.waitForSelector('[data-whats-new]', { timeout: 5000 });

    console.log('A baseline geometry=', JSON.stringify(await geometry(win)));

    for (const [name, notes] of Object.entries(HOSTILE)) {
      pageErrors.length = 0; consoleErrors.length = 0;
      const t0 = Date.now();
      try {
        await sendState(app, { kind: 'available', version: '99.0.0-adv', notes });
        await dismissPrompt(win);
        await win.waitForTimeout(name === 'many-lines' ? 1500 : 400);
        const g = await geometry(win);
        const inj = await injectionScan(win);
        const dt = Date.now() - t0;
        console.log(`B ${name}: dt=${dt}ms items=${g && g.incomingItems} inj=${JSON.stringify(inj)}`);
        console.log(`   geo=${JSON.stringify(g)}`);
        if (pageErrors.length || consoleErrors.length) {
          console.log(`   !! pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`);
        }
      } catch (e) {
        console.log(`B ${name}: THREW ${e.message}`);
      }
      await dismissPrompt(win);
    }

    // C. containment at default size with the 5000-line payload still present.
    await sendState(app, { kind: 'downloaded', version: '99.0.1-adv', notes: Array.from({ length: 5000 }, (_, i) => `line ${i}`) });
    await dismissPrompt(win);
    await win.waitForTimeout(800);
    const defGeo = await geometry(win);
    console.log('C default-with-5000-lines geo=', JSON.stringify(defGeo));
    await win.evaluate(() => {
      const b = document.querySelector('.sheet-about .sheet-body');
      if (b) b.scrollTop = 0;
    });
    await win.screenshot({ path: path.join(SHOTS, 'adv-p31-many-lines-default.png') });

    // footer reachability: scroll body to bottom, measure, click.
    const footerReach = await win.evaluate(async () => {
      const b = document.querySelector('.sheet-about .sheet-body');
      b.scrollTop = b.scrollHeight;
      await new Promise((r) => setTimeout(r, 200));
      const f = document.querySelector('[data-about-check-update]');
      if (!f) return { found: false };
      const r = f.getBoundingClientRect();
      return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), innerH: window.innerHeight, visible: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 };
    });
    console.log('C footer-reach=', JSON.stringify(footerReach));

    // D. 640px minimum width.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setBounds({ width: 640, height: 700 });
    });
    await win.waitForTimeout(700);
    const narrowGeo = await geometry(win);
    console.log('D narrow-640 geo=', JSON.stringify(narrowGeo));
    await win.screenshot({ path: path.join(SHOTS, 'adv-p31-many-lines-640.png') });

    // E. 100k single line at narrow width.
    await sendState(app, { kind: 'available', version: '99.0.2-adv', notes: ['Y'.repeat(100000)] });
    await dismissPrompt(win);
    await win.waitForTimeout(600);
    const longGeo = await geometry(win);
    console.log('E narrow-100k-line geo=', JSON.stringify(longGeo));
    await win.screenshot({ path: path.join(SHOTS, 'adv-p31-huge-line-640.png') });
    // horizontal overflow check
    const overflow = await win.evaluate(() => ({
      docScrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      sheetScrollW: document.querySelector('[data-about-dialog]').scrollWidth,
      sheetClientW: document.querySelector('[data-about-dialog]').clientWidth,
    }));
    console.log('E overflow=', JSON.stringify(overflow));

    // F. no notes (empty states).
    for (const [label, notes] of [['empty-array', []], ['undefined', undefined]]) {
      await sendState(app, { kind: 'available', version: '99.0.3-adv', notes });
      await dismissPrompt(win);
      await win.waitForTimeout(300);
      const g = await geometry(win);
      console.log(`F ${label}: incomingEmpty=${g && g.incomingEmptyShown} items=${g && g.incomingItems}`);
    }

    // G. hostile version string.
    await sendState(app, { kind: 'available', version: 'V'.repeat(4000), notes: ['one'] });
    await dismissPrompt(win);
    await win.waitForTimeout(300);
    const vGeo = await geometry(win);
    console.log('G huge-version geo=', JSON.stringify(vGeo));

    // H. exact-match / empty state at the UI level by overriding app:getInfo.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('app:getInfo');
      ipcMain.handle('app:getInfo', () => ({
        version: '1.2', electronVersion: 'x', nodeVersion: 'y',
        storagePaths: { userData: 'u', settings: 's', signatures: 'g', cache: 'c' },
      }));
    });
    // close and reopen About to refetch.
    await win.click('.sheet-about .sheet-close').catch(() => {});
    await win.waitForSelector('[data-about-dialog]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, IPC.menuAction);
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 10000 });
    await win.waitForSelector('[data-whats-new]', { timeout: 5000 });
    const emptyGeo = await geometry(win);
    console.log('I version=1.2 empty-state geo=', JSON.stringify(emptyGeo));
    await win.screenshot({ path: path.join(SHOTS, 'adv-p31-empty-state.png') });

    console.log('Z pageErrors(all)=' + JSON.stringify(pageErrors));
    console.log('Z consoleErrors(all)=' + JSON.stringify(consoleErrors));
  } catch (e) {
    console.log('HARNESS FAILED: ' + e.stack);
  } finally {
    await hardClose(app, 'adv-p31');
  }
})();