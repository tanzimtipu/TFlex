// ADV P30 attack 6: silence attack - Print affordances with no document open.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(ROOT, 'screenshots');

async function ctrlKey(app, win, key) {
  await win.bringToFront();
  await app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] });
  }, key);
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(500);

  const tabs = await win.locator('[data-tab-id]').count();
  const printBtn = await win.locator('[data-print]').count();
  const visible = printBtn ? await win.locator('[data-print]').isVisible() : false;
  const disabled = printBtn ? await win.locator('[data-print]').isDisabled() : null;
  console.log(`NO_DOC headerPrint: count=${printBtn} visible=${visible} disabled=${disabled} tabs=${tabs}`);
  await win.screenshot({ path: path.join(SHOTS, 'adv-p30-nodoc-welcome.png') });

  // Click the header Print button (if present).
  if (printBtn) {
    await win.click('[data-print]').catch((e) => console.log('NO_DOC header click err', e.message));
    await win.waitForTimeout(800);
    console.log(`NO_DOC after header-click dialogCount=${await win.locator('[data-print-printer]').count()}`);
  }

  // Ctrl+P.
  await ctrlKey(app, win, 'P');
  await win.waitForTimeout(900);
  console.log(`NO_DOC after Ctrl+P dialogCount=${await win.locator('[data-print-printer]').count()}`);

  // Open the File menu and click Print... to exercise the menu path.
  await win.evaluate(async () => {
    // Best-effort: no DOM menu; native menu only reachable via accelerator/click.
  });

  console.log(`NO_DOC pageErrors=${JSON.stringify(pageErrors)}`);
  await hardClose(app, 'adv-p30-nodoc');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });