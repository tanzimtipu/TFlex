// Attack group 5: create-from-images routing through the REAL dialog.
// Run: node a5-routing.cjs
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, close, fix, out } = require('./lib-adv.cjs');

async function createFlow(win, app, files, label, timeoutMs = 120000) {
  const t0 = Date.now();
  await win.locator('[data-welcome-create]').click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  let rowsRendered = -1;
  try {
    await win.waitForFunction(
      (n) => document.querySelectorAll('[data-create-image-row]').length === n,
      files.length,
      { timeout: 20000 },
    );
    rowsRendered = files.length;
  } catch {
    rowsRendered = await win.locator('[data-create-image-row]').count();
  }
  const renderMs = Date.now() - t0;
  await win.locator('[data-create-confirm]').click();
  // Settle: either a conversion notice appears, or the dialog shows an error, or timeout.
  let outcome = 'timeout';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) { outcome = 'notice'; break; }
    const dialogGone = (await win.locator('[data-create-from-images-dialog]').count()) === 0;
    const errText = await win.locator('[data-create-from-images-dialog]').innerText().catch(() => '');
    if (dialogGone && errText === '') { outcome = 'dialog-closed-no-notice'; break; }
    await win.waitForTimeout(250);
  }
  const result = {
    label,
    files: files.length,
    rowsRendered,
    renderMs,
    outcome,
    totalMs: Date.now() - t0,
  };
  const diag = await win.evaluate(() => window.tflexDiagnostics()).catch((e) => ({ error: e.message }));
  result.diag = { openTabs: diag.openTabs, pageCount: diag.pageCount };
  result.noticeWarnings = await win
    .locator('[data-conversion-notice] [data-conversion-warning]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-conversion-warning')))
    .catch(() => []);
  result.dialogText = (await win.locator('[data-create-from-images-dialog]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  result.bodyHasError = await win
    .evaluate(() => {
      const t = document.body.innerText;
      return /not supported|could not|failed|error|unsupported/i.test(t);
    })
    .catch(() => null);
  return result;
}

(async () => {
  const { app, win } = await launch();
  try {
    // (25) non-image bytes named .png
    out(await createFlow(win, app, [fix('text-as-png.png')], 'non-image-as-png'));
    await win.screenshot({ path: path.join(__dirname, 'shots', 'a5-nonimage.png') }).catch(() => {});
    // Reset: close any dialog left open.
    if ((await win.locator('[data-create-from-images-dialog]').count()) > 0) {
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    }
    // (25b) another non-image .png
    out(await createFlow(win, app, [fix('pdf-as-png.png')], 'pdf-as-png'));
    if ((await win.locator('[data-create-from-images-dialog]').count()) > 0) {
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    }
    // (26) 500 real image files
    const manyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-p54-many-'));
    const tiny = fs.readFileSync(fix('png-phys-zero.png'));
    const many = [];
    for (let i = 0; i < 500; i += 1) {
      const p = path.join(manyDir, `img-${i}.png`);
      fs.writeFileSync(p, tiny);
      many.push(p);
    }
    out(await createFlow(win, app, many, '500-images', 240000));
    await win.screenshot({ path: path.join(__dirname, 'shots', 'a5-500.png') }).catch(() => {});
    const u = await win.evaluate(() => document.querySelector('.sample-card') !== null || document.querySelector('.workspace') !== null).catch((e) => 'dead: ' + e.message);
    out({ phase: 'usable-after-500', u });
  } catch (e) {
    out({ phase: 'a5-crash', error: String(e && e.stack ? e.stack : e).slice(0, 400) });
  } finally {
    await close({ app }, 'a5-routing');
  }
})();
