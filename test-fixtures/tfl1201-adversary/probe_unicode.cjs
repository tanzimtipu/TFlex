// TFL-1201 adversary probe — export truthfulness under a hostile source name
// (spaces + unicode), the filesystem-abuse class for a file operation. Verifies
// the displayed naming scheme equals the filenames the real save flow writes.
// Run: node test-fixtures/tfl1201-adversary/probe_unicode.cjs

delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { getSamplePath, gotoStage, hardClose } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const OUT = path.join(DIR, 'out-unicode');
const LOG = path.join(DIR, 'probe_unicode.log');
const lines = [];
const writeLog = () => fs.writeFileSync(LOG, lines.join('\n') + '\n');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); process.stdout.write(s + '\n'); try { writeLog(); } catch (_) {} };

const G = { app: null };
async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Hostile source name: spaces + unicode + an extra dot.
  const src = getSamplePath('report.pdf');
  const hostile = path.join(OUT, 'Adversary R\u00ebport \u00dcn\u00efcode v1.2.pdf');
  fs.copyFileSync(src, hostile);

  const app = await launchApp();
  G.app = app;
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, hostile);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });

  // Observe the real write primitive.
  await win.evaluate(() => {
    window.__advWrites = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try { if (this.download) window.__advWrites.push(this.download); } catch (_) {}
      return orig.apply(this, arguments);
    };
  });

  await win.locator('[data-export-config-format-option="png"]').first().check();
  await win.locator('[data-export-config-scope="custom"]').first().check();
  await win.locator('[data-export-config-range]').first().fill('1,3');
  await win.waitForTimeout(400);
  const display = await win.evaluate(() => ({
    value: document.querySelector('[data-export-config-output-value]')?.textContent.trim(),
    scheme: document.querySelector('[data-export-config-output-scheme]')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  log(`display ${JSON.stringify(display)}`);

  await win.locator('[data-inspector-action="export"]').first().click();
  await win.waitForSelector('[data-export-dialog]', { timeout: 10000 });
  await win.locator('[data-export-confirm]').first().click();
  await win.waitForSelector('[data-export-dialog]', { state: 'detached', timeout: 120000 }).catch(() => {});
  await win.waitForTimeout(2000);
  const writes = await win.evaluate(() => window.__advWrites.splice(0, window.__advWrites.length));
  log(`actual ${JSON.stringify(writes)}`);

  const displayFirst = display.scheme ? display.scheme.split(' \u2026 ')[0] : null;
  const displayLast = display.scheme ? display.scheme.split(' \u2026 ')[1] : null;
  log(`verdict: countDisplay="${display.value}" actual=${writes.length} firstMatch=${writes[0] === displayFirst} lastMatch=${writes[writes.length - 1] === displayLast} scheme="${display.scheme}"`);

  await hardClose(app, 'tfl1201-unicode');
  G.app = null;
  log('DONE');
}
main().catch(async (e) => {
  log(`PROBE ERROR: ${e && e.stack ? e.stack : e}`);
  try { if (G.app) await hardClose(G.app, 'tfl1201-unicode-err'); } catch (_) {}
  writeLog();
  process.exitCode = 1;
});
