// Adversarial Phase-58 probe: tab detach / drag-back hostile sequences.
// Standalone harness (NOT an e2e spec): requires the canonical launch helper by
// absolute path. Prints structured JSON per scenario. Adversary probe artifact,
// mirrors the existing test-fixtures/adv-p30-*.cjs harnesses.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath, runTool } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUserData(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv-p58-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function tabState(win) {
  return win.evaluate(() => ({
    count: document.querySelectorAll('[data-tab-id]').length,
    titles: Array.from(document.querySelectorAll('[data-tab-id] .tab-title')).map((e) => e.textContent.trim()),
    active: document.querySelector('[data-tab-id][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null,
    toasts: Array.from(document.querySelectorAll('[data-toast], .toast')).map((e) => e.textContent.trim()),
    dialogs: document.querySelectorAll('[role="dialog"], .sheet-backdrop').length,
  })).catch((e) => ({ err: String(e.message) }));
}

async function tearOut(win, which) {
  // DEF-439 repoint: .tab-colour-chip was deleted by Phase 72 item 3. Grab the
  // tab by its .tab-title instead (same gesture as e2e/phase58_tab_reorder.spec.cjs
  // and e2e/phase58_def414_417.spec.cjs); keep the which === 'last' branch by
  // counting the title locator exactly as the retired chip locator did.
  const titles = win.locator('[data-tab-id] .tab-title');
  const idx = which === 'last' ? (await titles.count()) - 1 : 0;
  const title = titles.nth(Math.max(0, idx));
  const tb = await title.boundingBox();
  const strip = await win.locator('.tab-list').boundingBox();
  if (!tb || !strip) return { error: 'no chip/strip' };
  const sx = tb.x + Math.min(6, tb.width / 2), sy = tb.y + tb.height / 2;
  const ty = strip.y + strip.height + 60;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(sx, sy + 10, { steps: 4 });
  await win.mouse.move(sx, ty, { steps: 12 });
  await win.mouse.up();
  return { sx, sy, ty };
}

async function main() {
  const scenario = process.argv[2] || 'all';

  // ---------------- S1: detach only tab, close origin, return back --------
  if (scenario === 's1' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s1'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(800);
      const before = await tabState(origin);

      const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
      const g = await tearOut(origin);
      const second = await secondP;
      let adopted = null;
      if (second) {
        await second.waitForLoadState('domcontentloaded').catch(() => {});
        await second.waitForSelector('[data-tab-id]', { timeout: 30000 }).catch(() => {});
        await second.waitForTimeout(900);
        adopted = await tabState(second);
      }
      await origin.waitForTimeout(1200);
      const after = await tabState(origin);

      let originClosed = false;
      try { await origin.close({ runBeforeUnload: false }); originClosed = true; } catch (e) { originClosed = 'err:' + e.message; }
      await sleep(2000);

      const detachedAlive = second && !second.isClosed();
      let returnResult = null;
      if (detachedAlive) {
        const closeP = second.waitForEvent('close', { timeout: 15000 }).catch(() => null);
        await tearOut(second).catch((e) => ({ error: String(e.message) }));
        await sleep(2500);
        returnResult = {
          closed: (await closeP) !== null,
          tabsAfter: second.isClosed() ? 'closed' : JSON.stringify(await tabState(second)),
          windows: app.windows().filter((w) => !w.isClosed()).length,
        };
      }
      rec({ scenario: 's1', before, adopted, after, originClosed, detachedAlive, returnResult, tearGesture: g });
    } catch (e) {
      rec({ scenario: 's1', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's1').catch(() => {}); }
  }

  // ---------------- S2: close the detached window directly ----------------
  if (scenario === 's2' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s2'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(800);

      const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
      await tearOut(origin);
      const second = await secondP;
      if (!second) { rec({ scenario: 's2', error: 'no detached window' }); return; }
      await second.waitForSelector('[data-tab-id]', { timeout: 30000 }).catch(() => {});
      await second.waitForTimeout(900);
      const originAfter = await tabState(origin);

      let closeErr = null;
      try { await second.close({ runBeforeUnload: false }); } catch (e) { closeErr = String(e.message); }
      await origin.waitForTimeout(2000);
      const windows = app.windows().filter((w) => !w.isClosed());
      rec({ scenario: 's2', originAfter, closeErr, survivingWindows: windows.length, originNow: await tabState(origin) });
    } catch (e) {
      rec({ scenario: 's2', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's2').catch(() => {}); }
  }

  // ---------------- S3: double-detach the same tab rapidly ----------------
  if (scenario === 's3' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s3'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(800);

      const seenWindows = [];
      app.on('window', (w) => { seenWindows.push(w); });
      const w1P = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await tearOut(origin);
      const w2P = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await tearOut(origin);
      const w1 = await w1P;
      const w2 = await w2P;
      const snapWindows = async (label) => app.evaluate(({ BrowserWindow }, l) => ({
        label: l,
        wins: BrowserWindow.getAllWindows().map((w) => ({ id: w.id, url: w.webContents.getURL(), destroyed: w.isDestroyed(), tabs: undefined })),
      }), label).catch((e) => ({ err: String(e.message) }));
      const t500 = await snapWindows('t500');
      await sleep(1500);
      const t2000 = await snapWindows('t2000');
      await origin.waitForTimeout(1500).catch(() => {});
      const t3500 = await snapWindows('t3500');
      const wins = app.windows().filter((w) => !w.isClosed());
      const states = [];
      for (const w of wins) {
        states.push({ url: w.url(), tabs: await tabState(w) });
      }
      rec({ scenario: 's3', windowsAfter: wins.length, gotW1: w1 !== null, gotW2: w2 !== null, seenCount: seenWindows.length, seen: seenWindows.map((w) => ({ url: w.url(), closed: w.isClosed() })), t500, t2000, t3500, states });
    } catch (e) {
      rec({ scenario: 's3', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's3').catch(() => {}); }
  }

  // ---------------- S4: detach an EMPTY placeholder tab ----------------
  if (scenario === 's4' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s4'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(600);
      await origin.locator('[data-new-tab]').click();
      await origin.waitForTimeout(800);
      const before = await tabState(origin);

      const secondP = app.waitForEvent('window', { timeout: 8000 }).catch(() => null);
      await tearOut(origin, 'last');
      const second = await secondP;
      await origin.waitForTimeout(2500);
      const after = await tabState(origin);
      rec({ scenario: 's4-detach-empty', before, newWindowOpened: second !== null, after, windows: app.windows().filter((w) => !w.isClosed()).length });
    } catch (e) {
      rec({ scenario: 's4', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's4').catch(() => {}); }
  }

  // ---------------- S5: detach while Multi Mode is on ----------------
  if (scenario === 's5' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s5'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(600);
      await origin.locator('[data-header-multi-mode]').first().click();
      await origin.waitForTimeout(800);
      const secondP = app.waitForEvent('window', { timeout: 8000 }).catch(() => null);
      const g = await tearOut(origin).catch((e) => ({ error: String(e.message) }));
      const second = await secondP;
      await origin.waitForTimeout(2000);
      rec({ scenario: 's5-multimode', gesture: g, newWindowOpened: second !== null, tabs: await tabState(origin) });
    } catch (e) {
      rec({ scenario: 's5', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's5').catch(() => {}); }
  }

  // ---------------- S6: detach a document with a hostile filename --------
  if (scenario === 's6' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s6'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      const dir = path.join(os.tmpdir(), 'tflex-adv-p58-names');
      fs.mkdirSync(dir, { recursive: true });
      const names = [
        'a'.repeat(180) + '.pdf',
        'spaces  and   tabs   name.pdf',
        '\u4e2d\u6587\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u0416.pdf',
        '.pdf',
      ];
      const results = [];
      for (const n of names) {
        try {
          const p = path.join(dir, n);
          fs.copyFileSync(path.join(REPO, 'assets', 'samples', 'report.pdf'), p);
          await openSamplePath(origin, app, p);
          await origin.waitForTimeout(1200);
          const t = await tabState(origin);
          const secondP = app.waitForEvent('window', { timeout: 12000 }).catch(() => null);
          await tearOut(origin, 'last');
          const second = await secondP;
          await origin.waitForTimeout(1500);
          let adopted = null;
          if (second) { await second.waitForTimeout(800); adopted = await tabState(second); }
          results.push({ name: n, tabTitles: t.titles, newWindow: second !== null, adoptedTitles: adopted && adopted.titles, originTitles: (await tabState(origin)).titles });
        } catch (e) {
          results.push({ name: n, error: String(e.message) });
        }
      }
      rec({ scenario: 's6-hostile-names', results });
    } catch (e) {
      rec({ scenario: 's6', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's6').catch(() => {}); }
  }

  // ---------------- S7: detach a MODIFIED doc, then close the detached window
  if (scenario === 's7' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s7'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(900);

      // Mark the doc modified: rotate page 1 via the PAGES dock verb.
      let modHow = 'rotate-tool';
      try { await runTool(origin, 'rotate'); } catch (e) { modHow = 'rotate-err:' + e.message; }
      await origin.waitForTimeout(1500);
      const modBefore = await origin.evaluate(() => ({ mod: window.tflexDiagnostics().modified, tab: window.tflexDiagnostics().tabModified, dialogs: document.querySelectorAll('[role="dialog"]').length, how: null }));

      const secondP = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await tearOut(origin);
      const second = await secondP;
      if (!second) { rec({ scenario: 's7', modBefore, modHow, error: 'no detached window' }); return; }
      await second.waitForSelector('[data-tab-id]', { timeout: 30000 }).catch(() => {});
      const poll = [];
      for (let i = 0; i < 10; i += 1) {
        poll.push(await second.evaluate(() => ({ m: window.tflexDiagnostics().modified, t: window.tflexDiagnostics().tabModified, tabs: document.querySelectorAll('[data-tab-id]').length })).catch(() => null));
        await sleep(250);
      }
      const detachedState = await second.evaluate(() => ({ mod: window.tflexDiagnostics().modified, tab: window.tflexDiagnostics().tabModified, tabs: document.querySelectorAll('[data-tab-id]').length }));
      const originAfter = await tabState(origin);

      // Close the DETACHED window through its own titlebar close control.
      const closeP = second.waitForEvent('close', { timeout: 8000 }).catch(() => null);
      await second.locator('[data-window-close]').first().click().catch((e) => { closeP.__err = String(e.message); });
      await sleep(1500);
      let promptSeen = false;
      try { promptSeen = (await second.locator('[data-close-tab-prompt]').count()) > 0; } catch { /* page gone */ }
      const closed = second.isClosed();
      const closedEvt = (await closeP) !== null;
      rec({ scenario: 's7', modHow, modBefore, poll, detachedState, originAfter, promptSeen, closed, closedEvt, windows: app.windows().filter((w) => !w.isClosed()).length });
    } catch (e) {
      rec({ scenario: 's7', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's7').catch(() => {}); }
  }

  // ---------------- S8: modify IN the detached window, then close it ------
  if (scenario === 's8' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s8'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(900);

      const secondP = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await tearOut(origin);
      const second = await secondP;
      if (!second) { rec({ scenario: 's8', error: 'no detached window' }); return; }
      const secondUrl = second.url();
      const hadTab = await second.waitForSelector('[data-tab-id]', { timeout: 15000 }).then(() => true).catch(() => false);
      const originWhileDetached = await tabState(origin);
      if (!hadTab) { await second.screenshot({ path: REPO + '\\screenshots\\adv-p58-s8-blank-detached.png' }).catch(() => {}); }
      // Wait for the document to actually be loaded in the detached window.
      let loaded = false;
      for (let i = 0; i < 40 && hadTab; i += 1) {
        const pc = await second.evaluate(() => window.tflexDiagnostics().pageCount).catch(() => 0);
        if (pc > 0) { loaded = true; break; }
        await sleep(500);
      }
      await second.waitForTimeout(800);

      // Modify INSIDE the detached window.
      const preMod = await second.evaluate(() => ({ verbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')), mod: window.tflexDiagnostics().modified, tab: window.tflexDiagnostics().tabModified, pages: window.tflexDiagnostics().pageCount }));
      let modErr = null;
      try { await runTool(second, 'rotate'); } catch (e) { modErr = String(e.message); }
      await second.waitForTimeout(2000);
      const beforeClose = await second.evaluate(() => ({ mod: window.tflexDiagnostics().modified, tab: window.tflexDiagnostics().tabModified, dialogs: document.querySelectorAll('[role="dialog"]').length }));

      // Close through the detached window's own titlebar control.
      const closeP = second.waitForEvent('close', { timeout: 8000 }).catch(() => null);
      await second.locator('[data-window-close]').first().click().catch(() => {});
      await sleep(1500);
      let promptSeen = false;
      try { promptSeen = (await second.locator('[data-close-tab-prompt]').count()) > 0; } catch { /* gone */ }
      const closedEvt = (await closeP) !== null;
      rec({ scenario: 's8', secondUrl, hadTab, originWhileDetached, loaded, preMod, modErr, beforeClose, promptSeen, closed: second.isClosed(), closedEvt, windows: app.windows().filter((w) => !w.isClosed()).length });
    } catch (e) {
      rec({ scenario: 's8', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's8').catch(() => {}); }
  }

  // ---------------- S9: does the detached window actually LOAD the doc? ----
  if (scenario === 's9' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('s9'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openSamplePath(origin, app, getSamplePath('report.pdf'));
      await origin.waitForSelector('.workspace', { timeout: 30000 });
      await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
      await origin.waitForTimeout(1000);

      const secondP = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await tearOut(origin);
      const second = await secondP;
      if (!second) { rec({ scenario: 's9', error: 'no detached window' }); return; }
      const poll = [];
      for (let i = 0; i < 20; i += 1) {
        const d = await second.evaluate(() => ({ tabs: document.querySelectorAll('[data-tab-id]').length, pages: window.tflexDiagnostics().pageCount, mod: window.tflexDiagnostics().modified, verbs: document.querySelectorAll('[data-dock-verb]').length, workspace: document.querySelectorAll('.workspace').length, welcome: document.querySelectorAll('.welcome').length })).catch(() => null);
        poll.push(d);
        await sleep(500);
      }
      const originState = await tabState(origin);
      await second.screenshot({ path: REPO + '\\screenshots\\adv-p58-s9-detached.png' }).catch(() => {});
      rec({ scenario: 's9', poll, originState });
    } catch (e) {
      rec({ scenario: 's9', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 's9').catch(() => {}); }
  }

  // ---------------- X1: detach an encrypted (password-bearing) document ----
  if (scenario === 'x1' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUserData('x1'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.join(REPO, 'test-fixtures', 'encrypted.pdf'));
      await origin.locator('button:has-text("Open PDF")').first().click();
      await origin.waitForTimeout(3000);
      const pwPrompt = await origin.evaluate(() => ({ prompt: document.querySelectorAll('[data-password-prompt], [data-encrypt-password], .password-prompt').length, dialogs: document.querySelectorAll('[role="dialog"], .sheet-backdrop').length, workspace: document.querySelectorAll('.workspace').length, welcome: document.querySelectorAll('.welcome').length, body: document.body.innerText.slice(0, 160) }));
      const workspace = pwPrompt.workspace > 0;
      const tabs = await tabState(origin);
      let detach = null;
      if (workspace) {
        const secondP = app.waitForEvent('window', { timeout: 12000 }).catch(() => null);
        await tearOut(origin, 'last');
        const second = await secondP;
        await sleep(2500);
        detach = { newWindow: second !== null, detachedTabs: second && !second.isClosed() ? await tabState(second) : 'closed', originTabs: await tabState(origin) };
      }
      rec({ scenario: 'x1-encrypted', pwPrompt, tabs, detach });
    } catch (e) {
      rec({ scenario: 'x1', error: String((e && e.stack) || e) });
    } finally { await hardClose(app, 'x1').catch(() => {}); }
  }

  console.log('DONE ' + scenario);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
