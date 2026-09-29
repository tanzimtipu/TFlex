// Phase-55 adversary end-to-end probe (clean: closes all tabs between cases so
// notices do not contaminate one another). Launches ONLY through
// e2e/lib/launch.cjs. Native Open dialog stubbed, the repo's standard pattern.
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../../e2e/lib/launch.cjs');
const { hardClose } = require('../../../e2e/lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..');
const F = (n) => path.join(FIX, n);
const cases = process.argv.slice(2);

let app = null;
let win = null;
const consoleLog = [];

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}
async function clickOpen() { await win.locator('[aria-label="Open PDF document"]').first().click(); }
async function tabCount() { return win.locator('[data-tab-id]').count().catch(() => -1); }

async function closeAllTabs() {
  for (let i = 0; i < 60; i += 1) {
    const n = await win.locator('.tab-close').count().catch(() => 0);
    if (n === 0) return;
    await win.locator('.tab-close').first().click({ force: true }).catch(() => {});
    await win.waitForTimeout(200);
  }
}

async function waitOutcome(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await win.locator('[data-conversion-notice]').count().catch(() => 0)) > 0) return 'notice';
    const alertCount = await win.locator('[role="alert"]').count().catch(() => 0);
    if (alertCount > 0) {
      const t = (await win.locator('[role="alert"]').first().innerText().catch(() => '')).trim();
      if (t) return `alert:${t.slice(0, 220)}`;
    }
    const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]'));
    if (pageErr) return pageErr;
    await win.waitForTimeout(250);
  }
  return 'timeout';
}

async function inspectNotice() {
  const notice = win.locator('[data-conversion-notice]');
  const n = await notice.count().catch(() => 0);
  if (n !== 1) return { count: n };
  const inner = (await notice.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  return {
    source: await notice.locator('[data-conversion-source]').innerText().catch(() => null),
    fidelity: await notice.getAttribute('data-conversion-fidelity').catch(() => null),
    warnings: await notice.locator('[data-conversion-warning]').evaluateAll((els) => els.map((e) => e.getAttribute('data-conversion-warning'))).catch(() => []),
    text: inner.slice(0, 300),
  };
}

(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  for (const name of cases) {
    consoleLog.length = 0;
    const file = F(name);
    console.log(`\n[app] === ${name} ===`);
    await closeAllTabs();

    if (name.endsWith('.pdf')) {
      await stubOpen(file);
      await clickOpen();
      await win.waitForTimeout(6000);
      const diag = await win.evaluate(() => (window.tflexDiagnostics ? window.tflexDiagnostics() : null));
      const docId = diag && diag.engineDocId;
      console.log(`[app] pdf loaded pageCount=${diag && diag.pageCount} docId=${docId}`);
      if (docId) {
        const r = await win.evaluate(async (id) => {
          try {
            const res = await window.tflex.export.xlsx(id, {});
            return { resolved: true, ok: res && res.ok, err: res && res.error ? res.error : null, bytes: res && res.ok ? res.value.bytes.length : null };
          } catch (e) { return { resolved: false, threw: String(e && e.message ? e.message : e) }; }
        }, docId);
        console.log(`[app] export.xlsx => ${JSON.stringify(r)}`);
      }
      continue;
    }

    const before = await tabCount();
    await stubOpen(file);
    await clickOpen();
    const outcome = await waitOutcome(60000);
    const info = await inspectNotice();
    const after = await tabCount();
    console.log(`[app] outcome=${outcome} tabsBefore=${before} tabsAfter=${after}`);
    console.log(`[app] notice=${JSON.stringify(info)}`);
    const errs = consoleLog.filter((l) => l.startsWith('[pageerror]'));
    if (errs.length) console.log(`[app] pageErrors=${JSON.stringify(errs)}`);
  }

  // Final usability check.
  await closeAllTabs();
  const samples = path.resolve(__dirname, '../../../assets/samples');
  const sample = fs.readdirSync(samples).find((f) => f.toLowerCase().endsWith('.pdf'));
  await stubOpen(path.join(samples, sample));
  await clickOpen();
  await win.waitForTimeout(5000);
  console.log(`\n[app] FINAL usability: tabCount=${await tabCount()} (sample ${sample})`);

  await hardClose(app, 'probe-app');
  app = null;
  process.exit(0);
})().catch(async (e) => {
  console.log(`[app] HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  if (app) await hardClose(app, 'probe-app');
  process.exit(1);
});
