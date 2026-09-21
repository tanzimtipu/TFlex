// ADV P30 attack 4: preview/raster contract on hostile pages.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(ROOT, 'screenshots');

async function previewInfo(win) {
  return win.evaluate(() => {
    const img = document.querySelector('[data-print-preview] img');
    const sheet = document.querySelector('[data-print-preview-sheet]');
    return {
      naturalWidth: img ? img.naturalWidth : null,
      naturalHeight: img ? img.naturalHeight : null,
      srcLen: img ? img.getAttribute('src').length : 0,
      landscape: sheet ? sheet.getAttribute('data-landscape') : null,
      meta: (document.querySelector('[data-print-preview-meta]') || {}).textContent,
    };
  });
}

async function runFixture(app, win, label, fixture, opts = {}) {
  const pageErrors = [];
  const onErr = (e) => pageErrors.push(e.message);
  win.on('pageerror', onErr);
  const t0 = Date.now();
  try {
    await openSamplePath(win, app, fixture);
    await win.waitForSelector('.workspace, .pdf-page canvas', { timeout: 30000 }).catch(() => {});
    await win.waitForSelector('.pdf-page canvas', { timeout: 40000 }).catch(() => {});
    const openedMs = Date.now() - t0;
    const diag = await win.evaluate(() => {
      try { return window.tflexDiagnostics(); } catch (e) { return { err: String(e) }; }
    });
    await win.click('[data-print]');
    await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
    const previewSeen = await win.waitForSelector('[data-print-preview] img', { timeout: 30000 })
      .then(() => true).catch(() => false);
    await win.waitForTimeout(1200);
    const info = await previewInfo(win);
    console.log(`${label}: openedMs=${openedMs} pageCount=${diag.pageCount} previewSeen=${previewSeen} ${JSON.stringify(info)}`);
    if (opts.shot) await win.screenshot({ path: path.join(SHOTS, opts.shot) });
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    // close the tab so the next fixture opens clean
    await win.locator('[data-tab-id] button.tab-close').first().click({ timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(500);
  } catch (e) {
    console.log(`${label}: THREW ${e.message}`);
  } finally {
    win.off('pageerror', onErr);
    if (pageErrors.length > 0) console.log(`${label}: PAGE_ERRORS ${JSON.stringify(pageErrors)}`);
  }
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await runFixture(app, win, 'GIANT', path.join(ROOT, 'test-fixtures', 'adv-giant-page.pdf'), { shot: 'adv-p30-giant-preview.png' });
  await runFixture(app, win, 'HUGEPIX', path.join(ROOT, 'test-fixtures', 'huge-images.pdf'), { shot: 'adv-p30-hugeimages-preview.png' });
  await runFixture(app, win, 'ROTATED', path.join(ROOT, 'test-fixtures', 'adv-rotated-90.pdf'), { shot: 'adv-p30-rotated-preview.png' });
  await runFixture(app, win, 'ZEROSIZE', path.join(ROOT, 'test-fixtures', 'adv-zero-size-page.pdf'), { shot: 'adv-p30-zero-preview.png' });

  await hardClose(app, 'adv-p30-raster');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });