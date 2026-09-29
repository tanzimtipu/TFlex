// Adversary single-case investigation: open one file and dump the observable
// UI after a wait, plus the main-process stderr. Launches via launch.cjs.
const path = require('node:path');
const { launchApp } = require('../../../e2e/lib/launch.cjs');
const { hardClose } = require('../../../e2e/lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..');
const name = process.argv[2];
const file = path.join(FIX, name);

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  let stderr = '';
  try { app.process().stderr && app.process().stderr.on('data', (d) => { stderr += d.toString(); }); } catch {}
  const winLogs = [];
  win.on('console', (m) => winLogs.push(`[${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => winLogs.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
  console.log(`[one] opener filters before: ${JSON.stringify(await app.evaluate(() => globalThis.__x || null))}`);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  const t0 = Date.now();
  const observed = [];
  while (Date.now() - t0 < 40000) {
    const toasts = await win.locator('.toast-text').allInnerTexts().catch(() => []);
    const notice = await win.locator('[data-conversion-notice]').count().catch(() => 0);
    const tabs = await win.locator('[data-tab-id]').count().catch(() => 0);
    const sig = JSON.stringify({ toasts, notice, tabs });
    if (observed.length === 0 || observed[observed.length - 1].sig !== sig) {
      observed.push({ t: Math.round((Date.now() - t0) / 1000), sig });
    }
    if (notice > 0 || tabs > 0) break;
    await win.waitForTimeout(150);
  }
  console.log(`[one] observation=${JSON.stringify(observed.slice(0, 20), null, 1)}`);
  await win.waitForTimeout(500);

  const dump = await win.evaluate(() => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 5);
    return {
      tabs: document.querySelectorAll('[data-tab-id]').length,
      notices: pick('[data-conversion-notice]'),
      alerts: pick('[role="alert"]'),
      toasts: pick('.toast, [data-toast], .notification, [class*="toast"]'),
      dialogs: pick('[role="dialog"]'),
      bodySnippet: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
      diag: window.tflexDiagnostics ? window.tflexDiagnostics() : null,
    };
  });
  console.log(`[one] dump=${JSON.stringify(dump, null, 1)}`);
  console.log(`[one] windowLogs=${JSON.stringify(winLogs.slice(-20))}`);
  console.log(`[one] mainStderr tail=${JSON.stringify(stderr.slice(-1500))}`);

  await hardClose(app, 'probe-one');
  process.exit(0);
})().catch(async (e) => {
  console.log(`[one] HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
