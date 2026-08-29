// Verify the main-process dialog patch works and when the page dies.
const { _electron: electron } = require('@playwright/test');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('[' + new Date().toISOString().substring(11, 23) + '] ' + s);

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'file://C:/Users/tanzi/OneDrive/App%20Development/TFlex/dist/renderer/index.html' },
  });
  const win = await electronApp.firstWindow();
  win.on('close', () => log('PAGE CLOSED event'));
  win.on('crash', () => log('PAGE CRASH event'));
  await win.waitForSelector('.sample-card', { timeout: 20000 });
  log('welcome ok');

  // Patch and directly verify
  const patchResult = await electronApp.evaluate(async ({ dialog }) => {
    const orig = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['C:/FAKE/PATH.pdf'] });
    const testCall = await dialog.showOpenDialog();
    return { testCall };
  });
  log('patch testCall: ' + JSON.stringify(patchResult));

  // Now call the app's IPC-open (the renderer's openFileDialog) and see if it returns the fake path
  const rendererRes = await win.evaluate(async () => {
    try {
      return await window.tflex.openFileDialog();
    } catch (e) {
      return 'RENDERER THREW ' + e.message;
    }
  });
  log('renderer openFileDialog -> ' + JSON.stringify(rendererRes));

  await sleep(1000);
  try { log('alive check: ' + await win.evaluate(() => 7)); }
  catch (e) { log('DEAD: ' + e.message.split('\n')[0]); }
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  log('FATAL: ' + e.message.split('\n')[0]);
  process.exit(1);
});