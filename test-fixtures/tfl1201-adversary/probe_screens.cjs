// TFL-1201 adversary probe — evidence screenshots for the changed surfaces.
// Run: node test-fixtures/tfl1201-adversary/probe_screens.cjs
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { openSample, gotoStage, clickDockVerb, hardClose } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const SHOTS = path.resolve(DIR, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const G = { app: null };

async function main() {
  const app = await launchApp();
  G.app = app;
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // ER18 image dialog empty + populated at compact height.
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0]; if (bw.isMaximized()) bw.unmaximize(); bw.setSize(985, 645);
  });
  await win.waitForTimeout(500);
  await win.locator('[data-home-tool="createFromImages"]').first().click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'adv-1201-er18-image-dialog-empty.png') });
  const cp = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const ch = await cp;
  await ch.setFiles([
    { name: 'adv-a.png', mimeType: 'image/png', buffer: PNG_1x1 },
    { name: 'adv-b.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await win.waitForFunction(() => document.querySelectorAll('[data-create-image-row]').length === 2, null, { timeout: 10000 });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'adv-1201-er18-image-dialog-filled.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  // Deliver export surface: PNG all pages (ER20 count + scheme) and txt.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await win.waitForTimeout(400);
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
  await win.locator('[data-export-config-format-option="png"]').first().check();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'adv-1201-er20-deliver-png-all.png') });
  await win.locator('[data-export-config-format-option="txt"]').first().check();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'adv-1201-er20-deliver-txt.png') });

  // Stamp dialog.
  await gotoStage(win, 3);
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'adv-1201-er24-stamp-dialog.png') });
  await win.keyboard.press('Escape');

  await hardClose(app, 'tfl1201-screens');
  G.app = null;
  console.log('DONE screenshots');
}
main().catch(async (e) => { console.log('ERR ' + (e.stack || e)); try { if (G.app) await hardClose(G.app, 'tfl1201-screens-err'); } catch (_) {} process.exitCode = 1; });
