// TFL-1315 probe v4 - CLASS 3 error-toast durability + CLASS 5 a11y.
// Run: env -u ELECTRON_RUN_AS_NODE node test-fixtures/tfl1315/probe4.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(os.tmpdir(), 'tfl1315-fixtures');
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const rec = (n, d) => { results.push({ probe: n, ...d }); console.log(`PROBE ${n}: ${JSON.stringify(d)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readToasts(win) {
  return win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((e) => ({
    cls: e.className, text: (e.querySelector('.toast-text') || {}).textContent || null,
  })));
}

async function main() {
  const app = await launchApp([path.join(ROOT, 'test-fixtures', 'report.pdf')]);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });

    // ---- CLASS 5: search-index a11y while determinate ----------------------
    await win.keyboard.press('Control+f');
    await win.waitForSelector('[aria-label="Search query"]', { timeout: 8000 });
    await win.locator('[aria-label="Search query"]').fill('the');
    await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
    const a11y = await win.evaluate(() => {
      const summary = document.querySelector('[data-activity-shelf-summary]');
      const active = document.querySelector('[data-activity-shelf-active]');
      const hiddenCounter = active ? active.querySelector('[aria-hidden="true"]') : null;
      const mark = document.querySelector('[data-activity-shelf-role]');
      return {
        summaryRole: summary ? summary.getAttribute('role') : null,
        summaryLive: summary ? summary.getAttribute('aria-live') : null,
        activeVisibleText: active ? active.textContent : null,
        determinateCounterAriaHidden: hiddenCounter ? hiddenCounter.textContent : null,
        markAriaHidden: mark ? mark.getAttribute('aria-hidden') : null,
        runningRowHasAlert: document.querySelector('[data-activity-row][data-activity-state="running"] [role="alert"]') !== null,
      };
    });
    rec('class5-a11y-searchindex', a11y);
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');

    // ---- CLASS 3a: error toast durability ---------------------------------
    let badPath = path.join('C:', 'tfl1315-missing-dir-' + Date.now(), 'out.pdf');
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, badPath);
    await win.keyboard.press('Control+Shift+S');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await sleep(2500);
    const errT1 = await readToasts(win);
    await sleep(8000);
    const errT2 = await readToasts(win);
    rec('class3a-error-toast-durability', { after2_5s: errT1, after10_5s: errT2, persisted: JSON.stringify(errT1) === JSON.stringify(errT2) && errT1.length > 0 });
    await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c3-error-toast.png') });
    // dismiss
    for (const b of await win.locator('.toast-close').all()) { try { await b.click({ timeout: 1500 }); } catch (_) {} }

    // ---- CLASS 3b: success/info toast auto-dismiss ------------------------
    const goodPath = path.join(TMP, `saved-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, goodPath);
    await win.keyboard.press('Control+Shift+S');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await sleep(2500);
    const okT1 = await readToasts(win);
    await sleep(6500);
    const okT2 = await readToasts(win);
    rec('class3b-success-toast-autodismiss', { after2_5s: okT1, after9s: okT2, savedFileExists: fs.existsSync(goodPath) });
    await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c3-success-toast.png') });
  } catch (e) {
    rec('probe4', { error: String(e) });
  } finally {
    await hardClose(app, 'probe4');
  }
  fs.writeFileSync(path.join(ROOT, 'tfl1315_probe4_results.json'), JSON.stringify(results, null, 2));
  console.log('WROTE tfl1315_probe4_results.json');
}
main().catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : String(e))); }).finally(() => process.exit(0));
