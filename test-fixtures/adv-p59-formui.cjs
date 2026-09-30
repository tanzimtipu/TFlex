// Focused forms UI probe: does the renderer expose a signature / orphan field
// as an editable text box?
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const TMP = path.join(os.tmpdir(), 'adv-p59-formui-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log('###', ...a);

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  else await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  await win.waitForSelector('.workspace', { timeout: 30000 });
}

(async () => {
  const app = await launchApp([], path.join(TMP, 'ud'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  for (const name of ['signed.pdf', 'orphan.pdf', 'multiwidget.pdf', 'readonly.pdf']) {
    const p = path.join(TMP, name);
    fs.copyFileSync(path.join(REPO, 'test-fixtures', 'adv-p59', name), p);
    await openPath(app, win, p);
    await win.waitForTimeout(2500);
    const r = await win.evaluate(() => {
      const pane = '.tab-pane[aria-hidden="false"]';
      const eds = Array.from(document.querySelectorAll(pane + ' [data-form-field]')).map((e) => ({
        id: e.getAttribute('data-form-field'),
        kind: e.getAttribute('data-form-kind'),
        readonly: e.getAttribute('data-form-readonly'),
        tag: e.tagName,
        disabled: e.disabled === true,
        aria: e.getAttribute('aria-label'),
      }));
      return { editors: eds, count: eds.length, workspace: !!document.querySelector('.workspace') };
    });
    log(name, JSON.stringify(r));
    // close the tab to avoid stacking
  }
  await app.close().catch(() => {});
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
