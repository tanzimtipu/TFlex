// ADV P30 probe (temporary): confirm launch, tflex surface, writability.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const info = await win.evaluate(() => {
    const t = window.tflex;
    const desc = Object.getOwnPropertyDescriptor(t, 'printJob');
    return {
      hasPrintJob: typeof t.printJob,
      hasListPrinters: typeof t.listPrinters,
      hasOnPrintRequest: typeof t.onPrintRequest,
      frozen: Object.isFrozen(t),
      sealed: Object.isSealed(t),
      printJobDesc: desc ? { writable: desc.writable, configurable: desc.configurable, enumerable: desc.enumerable } : null,
      keys: Object.keys(t).length,
    };
  });
  console.log('PROBE', JSON.stringify(info, null, 2));
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('WINDOW_COUNT', wins);
  await hardClose(app, 'probe');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });