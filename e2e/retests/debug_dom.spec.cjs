const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

test('Check DOM for DEF-095', async () => {
  const electronApp = await launchApp([], 'default', EXE_PATH);
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const sample = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, sample);
  await window.locator('.btn-primary:has-text("Open"), button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace');

  await window.click('[data-tool="textbox"]');
  const page = window.locator('.pdf-page').first();
  await page.click({ position: { x: 50, y: 50 } });

  const html = await window.evaluate(() => {
    const el = document.querySelector('[data-annotation-editor-wrap="textbox"]');
    return el ? el.outerHTML : 'NOT FOUND';
  });
  console.log('Textbox HTML:', html);

  await hardClose(electronApp);
});
