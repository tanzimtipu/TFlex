// TFL-1259 diag3: hostile sequence during an in-flight print - resize the
// window (compact<->wide), hammer the primary action (repeat-storm), then let
// the run finish. Asserts one job, no crash, clean state.
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const REPO = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, openStandalonePrintWindow, hardClose } = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));
const REPORT = path.join(REPO, 'test-fixtures', 'report.pdf');

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const x = BrowserWindow.getAllWindows().find((y) => y.webContents.getURL().includes('tfWindow=print'));
    if (x) x.setSize(s.w, s.h);
  }, { w, h });
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const saved = path.join(os.tmpdir(), `tfl1259-storm-${Date.now()}.pdf`);
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(500);
    const p = await openStandalonePrintWindow(app, win);
    await p.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await p.waitForTimeout(400);

    await p.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await p.waitForTimeout(150);
    await p.click('[data-print-range-all]');
    await app.evaluate(({ dialog }, out) => {
      globalThis.__saveCalls = 0;
      dialog.showSaveDialog = async () => { globalThis.__saveCalls += 1; return { canceled: false, filePath: out }; };
    }, saved);

    // start the run, then immediately resize and hammer the primary action.
    await p.click('[data-print-confirm]');
    await p.waitForSelector('[data-print-progress]', { timeout: 10000 });
    await setSize(app, 560, 860);
    await p.waitForTimeout(120);
    await setSize(app, 1000, 860);
    await p.waitForTimeout(120);
    // repeat-storm: several activations while running.
    for (let i = 0; i < 4; i += 1) { await p.click('[data-print-confirm]', { force: true }).catch(() => {}); }
    await p.waitForTimeout(150);

    const during = await p.evaluate(() => ({
      running: !!document.querySelector('[data-print-progress]'),
      mode: document.querySelector('.print-body')?.getAttribute('data-print-layout-mode'),
      error: document.querySelector('[data-print-error]')?.textContent?.trim() ?? null,
      success: document.querySelector('[data-print-success]')?.textContent?.trim() ?? null,
    }));
    console.log(`[diag3] during = ${JSON.stringify(during)}`);

    await p.waitForSelector('[data-print-success], [data-print-error]', { timeout: 120000 });
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({
      running: !!document.querySelector('[data-print-progress]'),
      success: document.querySelector('[data-print-success]')?.textContent?.trim() ?? null,
      error: document.querySelector('[data-print-error]')?.textContent?.trim() ?? null,
      confirmDisabled: document.querySelector('[data-print-confirm]')?.disabled,
      mode: document.querySelector('.print-body')?.getAttribute('data-print-layout-mode'),
    }));
    const saveCalls = await app.evaluate(() => globalThis.__saveCalls);
    const fileOk = fs.existsSync(saved) && fs.readFileSync(saved).slice(0, 5).toString('latin1') === '%PDF-';
    console.log(`[diag3] after = ${JSON.stringify(after)} saveCalls=${saveCalls} fileOk=${fileOk}`);
    const docAlive = await win.evaluate(() => !!document.querySelector('.pdf-page canvas'));
    console.log(`[diag3] source-doc-alive = ${docAlive}`);
  } finally {
    try { if (fs.existsSync(saved)) fs.unlinkSync(saved); } catch { /* ignore */ }
    await hardClose(app, 'tfl1259-diag3');
  }
  process.exit(0);
})();
