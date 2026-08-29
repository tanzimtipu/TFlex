// Verify the Undo button multi-step bug deterministically
const { _electron: electron } = require('@playwright/test');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'file://C:/Users/tanzi/OneDrive/App%20Development/TFlex/dist/renderer/index.html' },
  });
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 20000 });
  await win.evaluate(() => {
    Array.from(document.querySelectorAll('.sample-card')).find((c) => c.textContent.includes('report.pdf')).click();
  });
  await win.waitForFunction(() => window.tflexDiagnostics()?.pageCount === 34, null, { timeout: 20000 }).catch(() => {});

  await win.evaluate(async () => {
    const select = () => {
      const t = document.querySelector('.thumb[data-page="1"]');
      if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    };
    const cw = () => document.querySelector('button[aria-label="Rotate clockwise"]')?.click();
    select(); await new Promise((r) => setTimeout(r, 120));
    cw(); await new Promise((r) => setTimeout(r, 120));
    cw(); await new Promise((r) => setTimeout(r, 120));
    cw(); await new Promise((r) => setTimeout(r, 120));
    cw(); await new Promise((r) => setTimeout(r, 250));
  });
  let a = await win.evaluate(() => window.tflexDiagnostics());
  console.log('after 4 rotations: rot0=' + a.engineState.rotations[0] + ' canUndo=' + a.canUndo);

  await win.evaluate(() => document.querySelector('button[aria-label="Undo last change"]')?.click());
  await sleep(400);
  a = await win.evaluate(() => window.tflexDiagnostics());
  const b1 = await win.evaluate(() => {
    const b = document.querySelector('button[aria-label="Undo last change"]');
    return b ? b.disabled : null;
  });
  console.log('after 1st undo: rot0=' + a.engineState.rotations[0] + ' canUndo=' + a.canUndo + ' btnDisabled=' + b1);

  await win.evaluate(() => document.querySelector('button[aria-label="Undo last change"]')?.click());
  await sleep(400);
  a = await win.evaluate(() => window.tflexDiagnostics());
  console.log('after 2nd undo CLICK: rot0=' + a.engineState.rotations[0] + ' canUndo=' + a.canUndo + ' (DISABLED button suppresses click)');

  await win.keyboard.press('Control+z');
  await sleep(400);
  a = await win.evaluate(() => window.tflexDiagnostics());
  console.log('after Ctrl+Z: rot0=' + a.engineState.rotations[0] + ' canUndo=' + a.canUndo + ' (keyboard bypasses disabled button)');

  await electronApp.close();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message.split('\n')[0]);
  process.exit(1);
});