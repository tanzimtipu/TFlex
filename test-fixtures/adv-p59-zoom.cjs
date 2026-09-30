// Focused zoom/tab-activation probe.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const TMP = path.join(os.tmpdir(), 'adv-p59-zoom-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log('###', ...a);

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  else await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
}

(async () => {
  const app = await launchApp([], path.join(TMP, 'ud'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const cp = (n, t) => { const d = path.join(TMP, t + '-' + n); fs.copyFileSync(path.join(REPO, 'assets', 'samples', n), d); return d; };
  await openPath(app, win, cp('report.pdf', 'a'));
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  const snap = async (label) => {
    const r = await win.evaluate(() => {
      const pane = '.tab-pane[aria-hidden="false"]';
      const q = (s) => document.querySelector(pane + ' ' + s);
      return {
      pillTotal: (q('.page-total') || {}).textContent,
      percent: (q('.zoom-percent') || {}).textContent,
      fitPage: q('[aria-label="Fit page"]')?.getAttribute('aria-pressed'),
      activeTab: document.querySelector('[data-tab-id][aria-selected="true"] .tab-title')?.textContent,
      pdfPages: document.querySelectorAll(pane + ' .pdf-page').length,
      diag: (() => { try { return window.tflexDiagnostics ? { pageCount: window.tflexDiagnostics().pageCount, modified: window.tflexDiagnostics().modified } : null; } catch (e) { return { err: String(e) }; } })(),
      };
    });
    log(label, JSON.stringify(r));
    return r;
  };
  await snap('after-open-report');
  await win.locator('[aria-label="Zoom in"]').click();
  await win.locator('[aria-label="Zoom in"]').click();
  await win.waitForTimeout(400);
  await snap('after-zoom');
  await openPath(app, win, cp('long.pdf', 'b'));
  await win.waitForTimeout(2000);
  await snap('after-open-long-2s');
  await win.waitForTimeout(4000);
  await snap('after-open-long-6s');
  // explicitly activate the long tab
  await win.locator('[data-tab-id]').nth(1).click();
  await win.waitForTimeout(1500);
  await snap('after-click-long-tab');
  await app.close().catch(() => {});
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
