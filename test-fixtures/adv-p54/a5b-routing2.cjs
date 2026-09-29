// Attack group 5b: create-from-images error/edge routing with toast capture.
// Run: node a5b-routing2.cjs
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, close, fix, out } = require('./lib-adv.cjs');

async function snapshot(win) {
  return win
    .evaluate(() => ({
      dialog: document.querySelector('[data-create-from-images-dialog]') !== null,
      notice: document.querySelectorAll('[data-conversion-notice]').length,
      toasts: Array.from(document.querySelectorAll('.toast-text')).map((e) => e.textContent),
      openTabs: window.tflexDiagnostics().openTabs,
      pageCount: window.tflexDiagnostics().pageCount,
    }))
    .catch((e) => ({ error: String(e && e.message) }));
}

async function flow(win, files, label) {
  await win.locator('[data-welcome-create]').click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  await win.waitForFunction(
    (n) => document.querySelectorAll('[data-create-image-row]').length === n,
    files.length,
    { timeout: 20000 },
  );
  const t0 = Date.now();
  await win.locator('[data-create-confirm]').click();
  // Poll quickly and capture the first observable outcome.
  let snap = await snapshot(win);
  while (Date.now() - t0 < 20000) {
    if (snap.notice > 0 || snap.toasts.length > 0) break;
    if (!snap.dialog && snap.openTabs > 0) break;
    await win.waitForTimeout(120);
    snap = await snapshot(win);
  }
  return { label, ms: Date.now() - t0, ...snap };
}

(async () => {
  const { app, win } = await launch();
  try {
    out(await flow(win, [fix('text-as-png.png')], 'non-image-as-png'));
    await win.screenshot({ path: path.join(__dirname, 'shots', 'a5b-nonimage.png') }).catch(() => {});
    // Drain toasts so the next case starts clean.
    await win.evaluate(() => document.querySelectorAll('.toast-close').forEach((b) => b.click())).catch(() => {});
    await win.waitForTimeout(400);

    out(await flow(win, [fix('random-bin-as-jpg.jpg')], 'random-bin-as-jpg'));
    await win.evaluate(() => document.querySelectorAll('.toast-close').forEach((b) => b.click())).catch(() => {});
    await win.waitForTimeout(400);

    // Deleted-before-confirm: a path that no longer exists at confirm time.
    const tmp = path.join(os.tmpdir(), `adv-p54-vanish-${Date.now()}.png`);
    fs.copyFileSync(fix('png-phys-zero.png'), tmp);
    await win.locator('[data-welcome-create]').click();
    await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
    const chooserPromise = win.waitForEvent('filechooser');
    await win.locator('[data-create-pick]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles([tmp]);
    await win.waitForFunction(() => document.querySelectorAll('[data-create-image-row]').length === 1, null, { timeout: 15000 });
    fs.unlinkSync(tmp); // the path no longer exists
    const t0 = Date.now();
    await win.locator('[data-create-confirm]').click();
    let snap = await snapshot(win);
    while (Date.now() - t0 < 20000) {
      if (snap.toasts.length > 0 || snap.notice > 0) break;
      await win.waitForTimeout(120);
      snap = await snapshot(win);
    }
    out({ label: 'deleted-before-confirm', ms: Date.now() - t0, ...snap });

    out({ phase: 'usable', u: await win.evaluate(() => document.querySelector('.sample-card') !== null).catch((e) => 'dead: ' + e.message) });
  } catch (e) {
    out({ phase: 'a5b-crash', error: String(e && e.stack ? e.stack : e).slice(0, 400) });
  } finally {
    await close({ app }, 'a5b');
  }
})();
