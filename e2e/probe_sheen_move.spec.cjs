// PROBE: the acrylic-sheen band must MOVE - sample the ::after transform
// twice, 1.5s apart, and capture two toolbar crops for the record.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test('PROBE: reflection band moves', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2200);

    const t1 = await win.evaluate(() => getComputedStyle(document.querySelector('.toolbar'), '::after').transform);
    await win.screenshot({ path: path.join(SHOTS, 'probe-sheen-t1.png'), clip: { x: 305, y: 100, width: 900, height: 60 } });
    await win.waitForTimeout(1500);
    const t2 = await win.evaluate(() => getComputedStyle(document.querySelector('.toolbar'), '::after').transform);
    await win.screenshot({ path: path.join(SHOTS, 'probe-sheen-t2.png'), clip: { x: 305, y: 100, width: 900, height: 60 } });
    console.log(`[sheen] transform t1=${t1}`);
    console.log(`[sheen] transform t2=${t2}`);
    console.log(`[sheen] moving = ${t1 !== t2}`);
  } finally {
    await hardClose(electronApp);
  }
});
