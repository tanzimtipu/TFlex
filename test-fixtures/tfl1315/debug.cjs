const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const file = process.argv[2] || path.join(ROOT, 'test-fixtures', 'report.pdf');
  console.log('launching with arg', file, fs.existsSync(file));
  const app = await launchApp([file]);
  const win = await app.firstWindow();
  await sleep(6000);
  console.log('AFTER:', await win.evaluate(() => ({
    pdfPage: document.querySelectorAll('.pdf-page').length,
    canvases: document.querySelectorAll('canvas').length,
    toasts: Array.from(document.querySelectorAll('.toast .toast-text')).map((e) => e.textContent),
    toastKinds: Array.from(document.querySelectorAll('.toast')).map((e) => e.className),
    shelf: document.querySelectorAll('[data-activity-shelf-summary]').length,
    activeTitle: document.querySelector('[data-active-title]')?.textContent ?? null,
    intake: document.querySelectorAll('[data-intake-row]').length,
  })));
  await win.screenshot({ path: path.join(ROOT, 'screenshots', 'tfl1315-debug-argv.png') });
  await hardClose(app, 'dbg');
  process.exit(0);
}
main().catch((e) => { console.log('FATAL', e && e.stack || e); process.exit(1); });
