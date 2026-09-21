// QA retest of DEF-276. Same technique as empty-state-probe.cjs (override
// app:getInfo before About opens, then read the What's New DOM) but covers the
// versions the acceptance criteria name: '1.2' (no entry), '1.22.0' (mid-list
// entry) and the real running version from package.json. No screenshots.
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

async function runCase(label, version) {
  const app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    if (version !== null) {
      await app.evaluate(({ ipcMain }, v) => {
        ipcMain.removeHandler('app:getInfo');
        ipcMain.handle('app:getInfo', () => ({
          version: v, electronVersion: 'x', nodeVersion: 'y',
          storagePaths: { userData: 'u', settings: 's', signatures: 'g', cache: 'c' },
        }));
      }, version);
    }
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, 'menu:action');
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
    await win.waitForSelector('[data-whats-new]', { timeout: 5000 });
    const res = await win.evaluate(() => ({
      versionShown: document.querySelector('[data-about-version]') ? document.querySelector('[data-about-version]').textContent : null,
      emptyShown: document.querySelector('[data-whats-new-empty]') !== null,
      currentItems: document.querySelectorAll('[data-whats-new-highlight]').length,
      historyHead: document.querySelector('.about-whats-new-history-head') ? document.querySelector('.about-whats-new-history-head').textContent.trim() : null,
      historyVersions: Array.from(document.querySelectorAll('.about-whats-new-history-version')).map((e) => e.textContent),
    }));
    console.log(`DEF276 ${label}: running=${JSON.stringify(version)} -> ${JSON.stringify(res)}`);
  } catch (e) {
    console.log(`DEF276 ${label} THREW ${e.message}`);
  } finally {
    await hardClose(app, 'def276');
  }
}

(async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  console.log(`package.json version = ${JSON.stringify(pkg.version)}`);
  await runCase('no-entry-1.2', '1.2');
  await runCase('mid-list-1.22.0', '1.22.0');
  await runCase('real-running', null);
})();
