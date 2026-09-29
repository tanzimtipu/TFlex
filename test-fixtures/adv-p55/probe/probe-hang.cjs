// Phase-55 adversary hang probe: open the declared-max-range XLSX in the real
// app and observe. Bounded; always tree-kills Electron on exit.
const path = require('node:path');
const { execSync } = require('node:child_process');
const { launchApp } = require('../../../e2e/lib/launch.cjs');
const { hardClose } = require('../../../e2e/lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..');
const file = path.join(FIX, process.argv[2] || 'xlsx-maxrange.xlsx');
const observeMs = Number(process.argv[3] || 150000);

function rss(pid) {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`, { encoding: 'utf8' }).trim();
    const n = Number(out);
    return Number.isFinite(n) && n > 0 ? Math.round(n / (1024 * 1024)) : null;
  } catch { return null; }
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const mainPid = app.process() && app.process().pid;
  console.log(`[hang] launched, main pid=${mainPid}`);

  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
  const t0 = Date.now();
  await win.locator('[aria-label="Open PDF document"]').first().click();
  console.log(`[hang] clicked Open for ${path.basename(file)}`);

  let notice = 0;
  let lastRss = null;
  let died = null;
  app.on('close', () => { died = died || 'electronApp:close'; });
  win.on('close', () => { died = died || 'window:close'; });
  win.on('crash', () => { died = died || 'window:crash'; });
  while (Date.now() - t0 < observeMs) {
    try {
      notice = await win.locator('[data-conversion-notice]').count().catch(() => -1);
    } catch (e) { died = died || `count threw: ${e.message}`; break; }
    const m = rss(mainPid);
    if (m !== lastRss) { lastRss = m; console.log(`[hang] t=${Math.round((Date.now() - t0) / 1000)}s mainRSS=${m}MB notice=${notice}`); }
    if (m === null) { died = died || 'main process gone (RSS unreadable)'; break; }
    if (notice > 0) break;
    try { await win.waitForTimeout(5000); } catch (e) { died = died || `waitForTimeout threw: ${e.message}`; break; }
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`[hang] RESULT after ${elapsed}s: notice=${notice}, mainRSS=${lastRss}MB, died=${died}`);
  // Get an error/notice text if one appeared.
  if (notice > 0) {
    const txt = await win.locator('[data-conversion-notice]').first().innerText().catch(() => '');
    console.log(`[hang] notice text: ${JSON.stringify(txt.slice(0, 300))}`);
  }
  await hardClose(app, 'probe-hang');
  process.exit(0);
})().catch(async (e) => {
  console.log(`[hang] HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
