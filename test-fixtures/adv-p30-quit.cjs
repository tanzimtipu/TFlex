// ADV P30 attack 7: consequence of the hidden-window leak - does the app quit
// normally when the visible window is closed while a leaked hidden window lives?
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // Leak one hidden window (call never settles).
  await win.evaluate(async ({ img }) => {
    await Promise.race([
      window.tflex.printJob({ images: [img], settings: { deviceName: '' } }),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
  }, { img: IMG });

  const windowsNow = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('AFTER_LEAK windows', windowsNow);

  // Close the visible window like a user would.
  await win.close().catch((e) => console.log('win.close err', e.message));
  await new Promise((r) => setTimeout(r, 5000));

  let alive = true;
  let windowCountAfter = -1;
  try {
    windowCountAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  } catch (e) {
    alive = false;
    console.log('evaluate failed after close (app likely quit):', e.message);
  }
  console.log(`AFTER_VISIBLE_CLOSE appAlive=${alive} windows=${windowCountAfter}`);

  await hardClose(app, 'adv-p30-quit');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });