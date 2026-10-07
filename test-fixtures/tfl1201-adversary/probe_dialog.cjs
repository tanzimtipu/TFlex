// TFL-1201 adversary probe — image-dialog content-driven height (TFL-1197 grow)
// + boundary reopen / no stale state (attacks 4 and 5).
// Run: node test-fixtures/tfl1201-adversary/probe_dialog.cjs

delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const LOG = path.join(DIR, 'probe_dialog.log');
const lines = [];
const writeLog = () => fs.writeFileSync(LOG, lines.join('\n') + '\n');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); process.stdout.write(s + '\n'); try { writeLog(); } catch (_) {} };

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const G = { app: null };
async function main() {
  const app = await launchApp();
  G.app = app;
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const setSize = async (w, h) => {
    await app.evaluate(({ BrowserWindow }) => {
      const bw = BrowserWindow.getAllWindows()[0];
      if (bw.isMaximized()) bw.unmaximize();
    });
    await win.waitForTimeout(300);
    await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]); }, [w, h]);
    await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(400);
  };

  const readDialog = () => win.evaluate(() => {
    const d = document.querySelector('[data-create-from-images-dialog]');
    const body = d ? d.querySelector('.modal-body, .sheet-body, .preview-task-body') : null;
    const list = d ? d.querySelector('[data-create-list]') : null;
    const confirm = d ? d.querySelector('[data-create-confirm]') : null;
    const cr = confirm ? confirm.getBoundingClientRect() : null;
    const dw = d ? d.getBoundingClientRect() : null;
    let overflowX = 0;
    if (d) for (const el of d.querySelectorAll('*')) if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) overflowX += 1;
    return {
      present: d !== null,
      dialogH: dw ? Math.round(dw.height) : null,
      dialogBottom: dw ? Math.round(dw.bottom) : null,
      bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
      listPresent: list !== null,
      hasFiles: d ? d.getAttribute('data-create-has-files') !== null : null,
      growClass: d ? d.classList.contains('task-dialog-preview-grow') : null,
      confirmPresent: confirm !== null,
      confirmVisible: cr ? cr.width > 0 && cr.height > 0 : false,
      confirmBottom: cr ? Math.round(cr.bottom) : null,
      confirmInView: cr ? cr.right <= window.innerWidth + 1 && cr.bottom <= window.innerHeight + 1 && cr.top >= 0 : false,
      overflowXCount: overflowX,
      innerW: window.innerWidth, innerH: window.innerHeight,
    };
  });

  const tabs = () => win.evaluate(() => ({
    tabCount: document.querySelectorAll('[data-tab-id]').length,
    homeVisible: !!document.querySelector('.welcome, .sample-card'),
    toastCount: document.querySelectorAll('.toast-stack .toast').length,
  }));

  // Compact window first.
  await setSize(985, 645);
  const tab0 = await tabs();
  log(`[0] initial ${JSON.stringify(tab0)}`);

  // Open Create-from-images at compact height.
  await win.locator('[data-home-tool="createFromImages"]').first().click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  const empty = await readDialog();
  log(`[1] compact empty ${JSON.stringify(empty)}`);

  // Populate: two images.
  const chooserP = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserP;
  await chooser.setFiles([
    { name: 'adv-a.png', mimeType: 'image/png', buffer: PNG_1x1 },
    { name: 'adv-b.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await win.waitForFunction(() => document.querySelectorAll('[data-create-image-row]').length === 2, null, { timeout: 10000 });
  await win.waitForTimeout(500);
  const filled = await readDialog();
  log(`[2] compact filled ${JSON.stringify(filled)}`);

  // Resize while open: tall narrow, then wide short, then back.
  await setSize(640, 1392);
  const tall = await readDialog();
  log(`[3] resized 640x1392 ${JSON.stringify(tall)}`);
  await setSize(1024, 768);
  const mid = await readDialog();
  log(`[4] resized 1024x768 ${JSON.stringify(mid)}`);

  // Cancel leaves no document mutation and no stray toast.
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-create-from-images-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(1200);
  const afterCancel = await tabs();
  log(`[5] after cancel ${JSON.stringify(afterCancel)}`);

  // Reopen -> no stale state (list gone again), no stray toast/flash.
  await win.locator('[data-home-tool="createFromImages"]').first().click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  const reopened = await readDialog();
  const tabReopen = await tabs();
  log(`[6] reopened ${JSON.stringify(reopened)} tabs=${JSON.stringify(tabReopen)}`);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-create-from-images-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});

  await hardClose(app, 'tfl1201-dialog');
  G.app = null;
  log('DONE');
}
main().catch(async (e) => {
  log(`PROBE ERROR: ${e && e.stack ? e.stack : e}`);
  try { if (G.app) await hardClose(G.app, 'tfl1201-dialog-err'); } catch (_) {}
  writeLog();
  process.exitCode = 1;
});
