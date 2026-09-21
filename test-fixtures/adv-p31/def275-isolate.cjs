// QA isolation for DEF-275 case 3: push `{kind:'available', version:{a:1}}`
// WITHOUT ever opening About. If the renderer still blanks, the crash is in the
// always-mounted update surface (UpdateIndicator / UpdatePromptDialog), not the
// About sheet the fix normalised.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

async function runCase(label, state) {
  const app = await launchApp(['--host-resolver-rules=MAP * 127.0.0.1']);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }, st) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send('update:statusChanged', st);
    }, state);
    await win.waitForTimeout(900);
    const res = await win.evaluate(() => ({
      aboutOpened: document.querySelector('[data-about-dialog]') !== null,
      promptPresent: document.querySelector('[data-update-prompt]') !== null,
      indicatorVersionAttr: document.querySelector('[data-update-indicator]') ? document.querySelector('[data-update-indicator]').getAttribute('data-update-indicator-version') : null,
      indicatorText: document.querySelector('[data-update-indicator]') ? document.querySelector('[data-update-indicator]').innerText : null,
      sampleCard: document.querySelector('.sample-card') !== null,
      rootKids: document.getElementById('root') ? document.getElementById('root').childElementCount : -1,
    }));
    console.log(`ISOLATE ${label}: ${JSON.stringify(res)} pageErrors=${JSON.stringify(pageErrors)}`);
  } catch (e) {
    console.log(`ISOLATE ${label} THREW ${e.message}`);
  } finally {
    await hardClose(app, 'def275-isolate');
  }
}

(async () => {
  await runCase('version-object-no-about', { kind: 'available', version: { a: 1 }, notes: ['ok'] });
  await runCase('version-number-no-about', { kind: 'available', version: 123, notes: ['ok'] });
})();
