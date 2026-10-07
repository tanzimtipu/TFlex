// Quick mechanism check: do Playwright 'download' events fire for the anchor
// download in this Electron build, and can we observe the real write via an
// anchor-click instrumentation? 1-page export only.
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { openSample, gotoStage, hardClose } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const log = [];
const L = (...a) => { const s = a.join(' '); log.push(s); process.stdout.write(s + '\n'); };

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Instrument the real save primitive: record every anchor download the
  // product triggers (filename + blob byte length) without preventing it.
  await win.evaluate(() => {
    window.__advDownloads = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        if (this.download) {
          const href = this.href || '';
          const rec = { name: this.download, hrefKind: href.slice(0, 12), bytes: null };
          window.__advDownloads.push(rec);
          fetch(href).then((r) => r.arrayBuffer()).then((b) => { rec.bytes = b.byteLength; }).catch(() => {});
        }
      } catch (_) {}
      return orig.apply(this, arguments);
    };
  });

  const seen = [];
  win.on('download', (d) => {
    seen.push(d.suggestedFilename());
    L(`[download-event] ${d.suggestedFilename()}`);
  });

  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
  await win.locator('[data-export-config-format-option="png"]').first().check();
  await win.locator('[data-export-config-scope="custom"]').first().check();
  await win.locator('[data-export-config-range]').first().fill('1');
  await win.waitForTimeout(300);
  L(`display: ${JSON.stringify(await win.evaluate(() => document.querySelector('[data-export-config-output-value]').textContent))}`);

  await win.locator('[data-inspector-action="export"]').first().click();
  await win.waitForSelector('[data-export-dialog]', { timeout: 10000 });
  await win.locator('[data-export-confirm]').first().click();
  await win.waitForSelector('[data-export-dialog]', { state: 'detached', timeout: 60000 }).catch(() => {});
  await win.waitForTimeout(2500);

  const captured = await win.evaluate(() => window.__advDownloads);
  L(`[anchor-captured] ${JSON.stringify(captured)}`);
  L(`[download-events] ${JSON.stringify(seen)}`);
  await hardClose(app, 'mechanism');
  fs.writeFileSync(path.join(DIR, 'mechanism_check.log'), log.join('\n') + '\n');
}
main().catch((e) => { L('ERR ' + (e.stack || e)); fs.writeFileSync(path.join(DIR, 'mechanism_check.log'), log.join('\n') + '\n'); process.exitCode = 1; });
