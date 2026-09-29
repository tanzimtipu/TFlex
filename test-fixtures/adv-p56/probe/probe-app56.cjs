// Phase-56 adversary app-level probe. Launches ONLY through e2e/lib/launch.cjs.
// Calls the real convert IPC from the renderer (no UI clicks) so a wedged main
// process is observable. Cases are `mode:file` with mode read|doc.
const path = require('node:path');
const { execSync } = require('node:child_process');
const { launchApp } = require('../../../e2e/lib/launch.cjs');
const { hardClose } = require('../../../e2e/lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..');
const cases = process.argv.slice(2).map((s) => {
  const i = s.indexOf(':');
  return { mode: s.slice(0, i), name: s.slice(i + 1) };
});
const PER_CASE_TIMEOUT = Number(process.env.ADV_TIMEOUT || 60000);

function rssOf(pid) {
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`, { encoding: 'utf8' }).trim();
    const n = Number(out);
    return Number.isFinite(n) && n > 0 ? Math.round(n / (1024 * 1024)) : null;
  } catch { return null; }
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const consoleLog = [];
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const mainPid = app.process() && app.process().pid;
  console.log(`[app56] launched main pid=${mainPid} rss=${rssOf(mainPid)}MB`);

  for (const c of cases) {
    const file = path.join(FIX, c.name);
    consoleLog.length = 0;
    console.log(`\n[app56] === ${c.mode}:${c.name} (size=${require('fs').statSync(file).size}) ===`);
    const before = await win.locator('[data-tab-id]').count().catch(() => -1);

    let peak = rssOf(mainPid) || 0;
    const sampler = setInterval(() => { const r = rssOf(mainPid); if (r && r > peak) peak = r; }, 2000);
    const t0 = Date.now();
    let result;
    try {
      const call = win.evaluate(async ({ mode, p }) => {
        const docId = crypto.randomUUID();
        if (mode === 'read') {
          const r = await window.tflex.convert.readingDocument(p);
          return r.ok ? { ok: true, chapters: r.value.chapters.length, title: r.value.title, warnings: r.value.warnings.map((w) => w.code) }
            : { ok: false, code: r.error.code, message: r.error.message };
        }
        const r = await window.tflex.convert.toDocument(docId, p, {});
        return r.ok ? { ok: true, pageCount: r.value.pageCount, sourceFormat: r.value.sourceFormat, warnings: r.value.warnings.map((w) => w.code) }
          : { ok: false, code: r.error.code, message: r.error.message };
      }, { mode: c.mode, p: file });
      result = await Promise.race([
        call,
        new Promise((res) => setTimeout(() => res({ timeout: true }), PER_CASE_TIMEOUT)),
      ]);
    } catch (e) {
      result = { threw: String(e && e.message ? e.message : e) };
    }
    clearInterval(sampler);
    const elapsed = Date.now() - t0;
    const after = await win.locator('[data-tab-id]').count().catch(() => -1);
    const errs = consoleLog.filter((l) => l.startsWith('[pageerror]'));
    console.log(`[app56] result=${JSON.stringify(result)} elapsed=${elapsed}ms peakMainRSS=${peak}MB tabsBefore=${before} tabsAfter=${after} pageErrors=${JSON.stringify(errs)}`);

    // Clean up any tab this case opened.
    for (let i = 0; i < 40; i += 1) {
      const n = await win.locator('.tab-close').count().catch(() => 0);
      if (n === 0) break;
      await win.locator('.tab-close').first().click({ force: true }).catch(() => {});
      await win.waitForTimeout(150);
    }
  }

  // Usability: a normal sample still opens.
  const samples = path.resolve(__dirname, '../../../assets/samples');
  const fs = require('fs');
  const sample = fs.readdirSync(samples).find((f) => f.toLowerCase().endsWith('.pdf'));
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.join(samples, sample));
  await win.locator('[aria-label="Open PDF document"]').first().click().catch(() => {});
  await win.waitForTimeout(5000);
  console.log(`\n[app56] FINAL usability tabCount=${await win.locator('[data-tab-id]').count().catch(() => -1)}`);
  await hardClose(app, 'probe-app56');
  process.exit(0);
})().catch(async (e) => {
  console.log(`[app56] HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
