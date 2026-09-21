// DEF-271 retest: with no document open the header Print button must be
// disabled, the File > Print menu item (id 'menu.print') must be disabled in
// the MAIN process, and neither a header click nor Ctrl+P may open the
// dialog. With a document open all three must be live and Ctrl+P must open
// the dialog.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');

async function ctrlKey(app, win, key) {
  await win.bringToFront();
  await app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] });
  }, key);
}

const menuEnabled = (app) => app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu().getMenuItemById('menu.print');
  return item ? item.enabled : 'MISSING';
});

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(500);

  const tabs = await win.locator('[data-tab-id]').count();
  const disabled = await win.locator('[data-print]').isDisabled();
  const menu0 = await menuEnabled(app);
  console.log(`DEF271 NO_DOC tabs=${tabs} headerDisabled=${disabled} menuEnabled=${menu0}`);

  await win.locator('[data-print]').click({ force: true, timeout: 3000 })
    .catch((e) => console.log('DEF271 header click err', e.message));
  await win.waitForTimeout(800);
  const d1 = await win.locator('[data-print-printer]').count();
  await ctrlKey(app, win, 'P');
  await win.waitForTimeout(900);
  const d2 = await win.locator('[data-print-printer]').count();
  console.log(`DEF271 NO_DOC afterHeaderClick dialog=${d1} afterCtrlP dialog=${d2}`);

  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
  const disabled2 = await win.locator('[data-print]').isDisabled();
  const menu1 = await menuEnabled(app);
  console.log(`DEF271 WITH_DOC headerDisabled=${disabled2} menuEnabled=${menu1}`);
  await ctrlKey(app, win, 'P');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  console.log(`DEF271 WITH_DOC afterCtrlP dialog=${await win.locator('[data-print-printer]').count()}`);
  await win.click('[data-print-cancel]').catch(() => {});

  await hardClose(app, 'adv-p30-def271');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });