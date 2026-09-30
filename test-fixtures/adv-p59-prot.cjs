// Focused protection-notice probe, scoped to the ACTIVE pane.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const TMP = path.join(os.tmpdir(), 'adv-p59-prot-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log('###', ...a);

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  else await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  await win.waitForTimeout(2500);
}

(async () => {
  const app = await launchApp([], path.join(TMP, 'ud'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const state = () => win.evaluate(() => {
    const pane = '.tab-pane[aria-hidden="false"]';
    const r = document.querySelector(pane + ' .protection-notice-region');
    return {
      region: r ? r.getAttribute('data-protection-notice-state') : null,
      notice: !!document.querySelector(pane + ' [data-protection-notice]'),
      icon: !!document.querySelector(pane + ' [data-protection-icon]'),
      activeTab: document.querySelector('[data-tab-id][aria-selected="true"] .tab-title')?.textContent,
      regionsInDoc: document.querySelectorAll('.protection-notice-region').length,
    };
  });
  const a = path.join(TMP, 'p1.pdf');
  fs.copyFileSync(path.join(REPO, 'test-fixtures', 'adv-p59', 'encrypted-owner.pdf'), a);
  await openPath(app, win, a);
  log('after-open-A', JSON.stringify(await state()));
  // collapse it
  await win.locator('.tab-pane[aria-hidden="false"] [data-protection-collapse]').click({ timeout: 5000 }).catch((e) => log('collapse-err', String(e.message).split('\n')[0]));
  await win.waitForTimeout(600);
  log('after-collapse-A', JSON.stringify(await state()));
  // open a DIFFERENT protected document
  const b = path.join(TMP, 'p2.pdf');
  fs.copyFileSync(path.join(REPO, 'test-fixtures', 'adv-p59', 'encrypted-owner.pdf'), b);
  await openPath(app, win, b);
  log('after-open-B', JSON.stringify(await state()));
  await app.close().catch(() => {});
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
