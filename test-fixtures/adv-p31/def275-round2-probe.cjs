// QA round-2 retest of DEF-275. Fresh launch per payload, real main->renderer
// channels, NO screenshots (the recorded failure images in screenshots/ must
// not be clobbered). Covers the three original lethal shapes, the three newly
// hardened shapes (error.message / unsupported.reason / downloading.progress),
// and the two controls. For every case it reads #root child count, welcome
// screen + About survival, About reopen, page errors, and the indicator/prompt
// text so a coerced label can be judged sane.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const IPC = { menuAction: 'menu:action', updateStatusChanged: 'update:statusChanged' };

async function openAbout(app, win) {
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, IPC.menuAction);
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
}

async function sendState(app, state) {
  await app.evaluate(({ BrowserWindow }, { channel, st }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, st);
  }, { channel: IPC.updateStatusChanged, st: state });
}

async function runCase(label, state) {
  const app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openAbout(app, win);
    await sendState(app, state);
    await win.waitForTimeout(800);
    const prompt = win.locator('[data-update-prompt], .sheet-update-prompt').first();
    if (await prompt.isVisible().catch(() => false)) {
      await win.locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]').first().click().catch(() => {});
      await prompt.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    }
    const after = await win.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const ind = q('[data-update-indicator]');
      const pr = q('[data-update-prompt]');
      return {
        aboutPresent: q('[data-about-dialog]') !== null,
        sampleCardPresent: q('.sample-card') !== null,
        rootChildren: document.getElementById('root') ? document.getElementById('root').childElementCount : -1,
        bodyText: document.body.innerText.slice(0, 160),
        incomingPresent: q('[data-whats-new-incoming]') !== null,
        incomingVersion: q('[data-whats-new-incoming-version]') ? q('[data-whats-new-incoming-version]').textContent : null,
        incomingEmpty: q('[data-whats-new-incoming-empty]') !== null,
        incomingHighlights: Array.from(document.querySelectorAll('[data-whats-new-incoming-highlight]')).map((e) => e.textContent),
        emptyStateShown: q('[data-whats-new-empty]') !== null,
        indicatorKind: ind ? ind.getAttribute('data-update-indicator-kind') : null,
        indicatorVersionAttr: ind ? ind.getAttribute('data-update-indicator-version') : null,
        indicatorProgressAttr: ind ? ind.getAttribute('data-update-indicator-progress') : null,
        indicatorText: ind ? ind.innerText : null,
        promptKind: pr ? pr.getAttribute('data-update-prompt-kind') : null,
        promptProgressAttr: q('[data-update-prompt-progress]') ? q('[data-update-prompt-progress]').getAttribute('data-update-prompt-progress') : null,
        promptText: pr ? pr.innerText.slice(0, 200) : null,
      };
    });
    await sendState(app, { kind: 'checking' });
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, IPC.menuAction);
    await win.waitForTimeout(1200);
    const recovered = await win.evaluate(() => document.querySelector('[data-about-dialog]') !== null);
    console.log(`CASE ${label}: about=${after.aboutPresent} sampleCard=${after.sampleCardPresent} rootKids=${after.rootChildren} reopensAbout=${recovered} pageErrors=${JSON.stringify(pageErrors)}`);
    console.log(`   incoming present=${after.incomingPresent} version=${JSON.stringify(after.incomingVersion)} empty=${after.incomingEmpty} highlights=${JSON.stringify(after.incomingHighlights)} installedEmpty=${after.emptyStateShown}`);
    console.log(`   indicator kind=${after.indicatorKind} versionAttr=${JSON.stringify(after.indicatorVersionAttr)} progressAttr=${JSON.stringify(after.indicatorProgressAttr)} text=${JSON.stringify(after.indicatorText)}`);
    console.log(`   prompt kind=${after.promptKind} progressAttr=${JSON.stringify(after.promptProgressAttr)} text=${JSON.stringify(after.promptText)}`);
    console.log(`   body="${after.bodyText.replace(/\n/g, ' | ')}"`);
  } catch (e) {
    console.log(`CASE ${label}: HARNESS THREW ${e.message}`);
  } finally {
    await hardClose(app, 'def275-round2');
  }
}

(async () => {
  // 1. Original lethal shapes
  await runCase('lethal-notes-mixed-nonstring', { kind: 'available', version: '99.0.0', notes: [null, 123, { a: 1 }, 'kept string'] });
  await runCase('lethal-notes-as-string', { kind: 'available', version: '99.0.0', notes: 'just a string' });
  await runCase('lethal-version-as-object', { kind: 'available', version: { a: 1 }, notes: ['ok'] });
  // 2. Newly hardened shapes
  await runCase('hardened-error-message-object', { kind: 'error', message: { a: 1 } });
  await runCase('hardened-unsupported-reason-object', { kind: 'unsupported', reason: { a: 1 } });
  await runCase('hardened-downloading-progress-NaN', { kind: 'downloading', progress: NaN });
  await runCase('hardened-downloading-progress-Infinity', { kind: 'downloading', progress: Infinity });
  await runCase('hardened-downloading-progress-negative', { kind: 'downloading', progress: -5 });
  // 3. Controls
  await runCase('control-notes-as-object', { kind: 'available', version: '99.0.0', notes: { note: 'x' } });
  await runCase('control-version-number', { kind: 'available', version: 123, notes: ['ok'] });
})();