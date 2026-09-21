// ADV Phase 31 - explicit empty state + history labelling, on a fresh launch.
// Overrides app:getInfo BEFORE the About dialog first opens, so the running
// version has no bundled entry. This is the by-design path criterion 3 calls
// out ("a running version with no changelog entry"), reachable on unreleased
// / mis-versioned builds. It also exposes how the "Earlier releases" history
// is computed relative to the running version.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(ROOT, 'screenshots');

async function runCase(version) {
  const app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(({ ipcMain }, v) => {
      ipcMain.removeHandler('app:getInfo');
      ipcMain.handle('app:getInfo', () => ({
        version: v, electronVersion: 'x', nodeVersion: 'y',
        storagePaths: { userData: 'u', settings: 's', signatures: 'g', cache: 'c' },
      }));
    }, version);
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, 'menu:action');
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
    await win.waitForSelector('[data-whats-new]', { timeout: 5000 });
    const res = await win.evaluate(() => ({
      versionShown: document.querySelector('[data-about-version]') ? document.querySelector('[data-about-version]').textContent : null,
      emptyShown: document.querySelector('[data-whats-new-empty]') !== null,
      emptyText: document.querySelector('[data-whats-new-empty]') ? document.querySelector('[data-whats-new-empty]').textContent.trim() : null,
      currentItems: document.querySelectorAll('[data-whats-new-highlight]').length,
      historyHead: document.querySelector('.about-whats-new-history-head') ? document.querySelector('.about-whats-new-history-head').textContent.trim() : null,
      historyVersions: Array.from(document.querySelectorAll('.about-whats-new-history-version')).map((e) => e.textContent),
    }));
    console.log(`EMPTY version=${JSON.stringify(version)} -> ${JSON.stringify(res)}`);
    await win.screenshot({ path: path.join(SHOTS, `adv-p31-empty-${String(version).replace(/[^0-9a-z]/gi, '_')}.png`) }).catch(() => {});
  } catch (e) {
    console.log(`EMPTY ${version} THREW ${e.message}`);
  } finally {
    await hardClose(app, 'adv-p31-empty');
  }
}

(async () => {
  await runCase('1.2');       // prefix of 1.23.1 / 1.23.0
  await runCase('1.23.1 ');   // trailing whitespace
  await runCase('9.9.9');     // far future
})();