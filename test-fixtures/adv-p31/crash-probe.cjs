// ADV Phase 31 - crash probe. Each payload gets a FRESH launch so the blast
// radius and recoverability of a malformed update:statusChanged payload can be
// measured cleanly. Nothing is normalised here: this exercises the renderer's
// boundary handling of the UpdateState it receives over IPC.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(ROOT, 'screenshots');
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

async function runCase(label, state, shotName) {
  const app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openAbout(app, win);
    await sendState(app, state);
    await win.waitForTimeout(800);
    // dismiss the by-design update prompt if it opened
    const prompt = win.locator('[data-update-prompt], .sheet-update-prompt').first();
    if (await prompt.isVisible().catch(() => false)) {
      await win.locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]').first().click().catch(() => {});
      await prompt.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
    }
    const after = await win.evaluate(() => ({
      aboutPresent: document.querySelector('[data-about-dialog]') !== null,
      sampleCardPresent: document.querySelector('.sample-card') !== null,
      rootChildren: document.getElementById('root') ? document.getElementById('root').childElementCount : -1,
      bodyText: document.body.innerText.slice(0, 120),
    }));
    // recovery attempt: ask for About again
    await sendState(app, { kind: 'checking' });
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, IPC.menuAction);
    await win.waitForTimeout(1200);
    const recovered = await win.evaluate(() => document.querySelector('[data-about-dialog]') !== null);
    if (shotName) await win.screenshot({ path: path.join(SHOTS, shotName) }).catch(() => {});
    console.log(`CASE ${label}: aboutAfterCrashPresent=${after.aboutPresent} sampleCard=${after.sampleCardPresent} rootKids=${after.rootChildren} reopensAbout=${recovered} pageErrors=${JSON.stringify(pageErrors)}`);
    console.log(`   body="${after.bodyText.replace(/\n/g, ' | ')}"`);
  } catch (e) {
    console.log(`CASE ${label}: HARNESS THREW ${e.message}`);
  } finally {
    await hardClose(app, 'adv-p31-crash');
  }
}

(async () => {
  await runCase('notes-mixed-nonstring', { kind: 'available', version: '99.0.0', notes: [null, 123, { a: 1 }, 'kept string'] }, 'adv-p31-crash-mixed.png');
  await runCase('notes-as-string', { kind: 'available', version: '99.0.0', notes: 'just a string' }, 'adv-p31-crash-string.png');
  await runCase('version-as-object', { kind: 'available', version: { a: 1 }, notes: ['ok'] }, null);
  await runCase('control-notes-as-object', { kind: 'available', version: '99.0.0', notes: { note: 'x' } }, null);
  await runCase('control-version-number', { kind: 'available', version: 123, notes: ['ok'] }, null);
})();